#!/usr/bin/env node
/**
 * Pre-build specified app-type skills before Electron packaging.
 *
 * Usage:
 *   node scripts/prebuild-skills.js [skill1] [skill2] ...
 *
 * If no skill names are provided, reads from PREBUILD_SKILLS env var
 * (comma-separated) or from package.json "prebuildSkills" array.
 *
 * What it does:
 *   1. For each specified skill, runs `npm install` + `npm run build` in the skill directory
 *   2. Writes a `.prebuild-manifest.json` into the skill directory marking it as pre-built
 *   3. The Electron packaging will then include the .next/ build artifacts
 *   4. On first launch, the app detects the manifest and auto-registers the skill as deployed
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function getSkillsToBuild() {
  // Priority 1: CLI arguments
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args;
  }

  // Priority 2: Environment variable
  const envSkills = process.env.PREBUILD_SKILLS;
  if (envSkills) {
    return envSkills.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Priority 3: Auto-detect from template.json "prebuild": true
  console.log('[prebuild] Auto-detecting skills with "prebuild": true in template.json...');
  const detected = [];
  if (fs.existsSync(SKILLS_DIR)) {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const templatePath = path.join(SKILLS_DIR, entry.name, 'template.json');
      if (!fs.existsSync(templatePath)) continue;
      try {
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        if (template.prebuild === true) {
          detected.push(entry.name);
        }
      } catch {
        // skip invalid json
      }
    }
  }

  if (detected.length > 0) {
    console.log(`[prebuild] Found ${detected.length} skill(s) with prebuild=true: ${detected.join(', ')}`);
  }

  return detected;
}

function validateSkill(skillName) {
  const skillDir = path.join(SKILLS_DIR, skillName);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill directory not found: ${skillDir}`);
  }

  const templatePath = path.join(skillDir, 'template.json');
  const packageJsonPath = path.join(skillDir, 'package.json');
  const requirementsPath = path.join(skillDir, 'requirements.txt');

  // Check projectType from template.json or SKILL.md
  let projectType = 'nextjs';
  if (fs.existsSync(templatePath)) {
    try {
      const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
      projectType = template.projectType || 'nextjs';
    } catch {
      // default to nextjs
    }
  }

  // Validate based on project type
  if (projectType === 'nextjs' && !fs.existsSync(packageJsonPath)) {
    throw new Error(`Skill "${skillName}" has no package.json — not a valid Next.js skill`);
  }
  if (projectType === 'python-fastapi' && !fs.existsSync(requirementsPath)) {
    throw new Error(`Skill "${skillName}" has no requirements.txt — not a valid Python skill`);
  }

  return { skillDir, projectType };
}

function buildSkill(skillName) {
  const { skillDir, projectType } = validateSkill(skillName);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[prebuild] Building skill: ${skillName} (${projectType})`);
  console.log(`[prebuild] Path: ${skillDir}`);
  console.log(`${'='.repeat(60)}\n`);

  if (projectType === 'nextjs') {
    buildNextjsSkill(skillName, skillDir);
  } else if (projectType === 'python-fastapi') {
    buildPythonSkill(skillName, skillDir);
  } else {
    console.warn(`[prebuild] Unknown projectType "${projectType}" for "${skillName}", skipping`);
    return false;
  }

  // Write pre-build manifest
  const manifest = {
    prebuilt: true,
    projectType,
    buildTimestamp: new Date().toISOString(),
    skillName,
  };
  fs.writeFileSync(
    path.join(skillDir, '.prebuild-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  console.log(`[prebuild] ✅ Skill "${skillName}" built successfully`);
  return true;
}

function buildNextjsSkill(skillName, skillDir) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  // 1. Install dependencies
  console.log(`[prebuild] Installing dependencies for "${skillName}"...`);
  execSync(`${npmCmd} install`, {
    cwd: skillDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  // 2. Prisma generate if schema exists
  // Generate Prisma Client with multi-platform binary targets for cross-platform deployment
  const prismaSchemaPath = path.join(skillDir, 'prisma', 'schema.prisma');
  if (fs.existsSync(prismaSchemaPath)) {
    console.log(`[prebuild] Running prisma generate for "${skillName}" (multi-platform)...`);
    // Generate engines for all supported platforms (macOS, Windows, Linux)
    // Note: Prisma uses 'darwin' for macOS x64, 'windows' for Windows x64
    const prismaEnv = {
      ...process.env,
      PRISMA_CLI_BINARY_TARGETS: 'darwin,darwin-arm64,windows,linux-static-x64,linux-static-arm64',
    };
    execSync(`npx prisma generate`, {
      cwd: skillDir,
      stdio: 'inherit',
      env: prismaEnv,
    });
  }

  // 3. Build
  console.log(`[prebuild] Building "${skillName}"...`);
  // Clean env to avoid parent Next.js vars leaking
  const buildEnv = { ...process.env, NODE_ENV: 'production' };
  for (const key of Object.keys(buildEnv)) {
    if (key.startsWith('__NEXT_') || key.startsWith('NEXT_PUBLIC_') || key === 'NEXT_RUNTIME') {
      delete buildEnv[key];
    }
  }
  execSync(`${npmCmd} run build`, {
    cwd: skillDir,
    stdio: 'inherit',
    env: buildEnv,
  });

  // Verify .next directory was created
  const nextDir = path.join(skillDir, '.next');
  if (!fs.existsSync(nextDir)) {
    throw new Error(`Build failed: .next directory not created for "${skillName}"`);
  }
}

function buildPythonSkill(skillName, skillDir) {
  // For Python skills, just install dependencies into venv
  console.log(`[prebuild] Setting up Python venv for "${skillName}"...`);
  const requirementsPath = path.join(skillDir, 'requirements.txt');
  if (!fs.existsSync(requirementsPath)) {
    console.log(`[prebuild] No requirements.txt found, skipping dependency install`);
    return;
  }

  // Prefer builtin python-runtime (same one that will be used at runtime)
  let python = null;
  const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  const builtinPython = path.join(__dirname, '..', 'python-runtime', arch, 'bin', 'python3');
  if (fs.existsSync(builtinPython)) {
    python = builtinPython;
    console.log(`[prebuild] Using builtin Python: ${python}`);
  } else {
    python = process.platform === 'win32' ? 'python' : 'python3';
    console.log(`[prebuild] Builtin Python not found, using system: ${python}`);
  }

  const venvDir = path.join(skillDir, '.venv');

  // Always recreate venv to ensure it uses the correct Python
  if (fs.existsSync(venvDir)) {
    console.log(`[prebuild] Removing existing .venv to ensure clean state...`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  execSync(`"${python}" -m venv .venv`, { cwd: skillDir, stdio: 'inherit' });

  const pip = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');

  execSync(`"${pip}" install -r requirements.txt`, {
    cwd: skillDir,
    stdio: 'inherit',
  });
}

// ---- Main ----

const skillNames = getSkillsToBuild();

if (skillNames.length === 0) {
  console.log('[prebuild] No skills specified for pre-building.');
  console.log('[prebuild] Usage: node scripts/prebuild-skills.js skill1 skill2 ...');
  console.log('[prebuild]    or: PREBUILD_SKILLS=skill1,skill2 node scripts/prebuild-skills.js');
  console.log('[prebuild]    or: add "prebuildSkills": ["skill1"] to package.json');
  process.exit(0);
}

console.log(`[prebuild] Skills to build: ${skillNames.join(', ')}`);

let successCount = 0;
let failCount = 0;

for (const name of skillNames) {
  try {
    if (buildSkill(name)) {
      successCount++;
    }
  } catch (err) {
    console.error(`[prebuild] ❌ Failed to build "${name}":`, err.message);
    failCount++;
  }
}

console.log(`\n[prebuild] Done: ${successCount} succeeded, ${failCount} failed`);

if (failCount > 0) {
  process.exit(1);
}
