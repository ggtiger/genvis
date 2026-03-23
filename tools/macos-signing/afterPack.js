/**
 * electron-builder afterPack hook
 * Runs BEFORE code signing — sign node-runtime Mach-O binaries here
 * so they are included in the main app signature.
 *
 * Signing identity resolution order:
 *   1. APPLE_IDENTITY - full name (e.g. "Developer ID Application: hu wang (...)")
 *   2. CSC_NAME - may not have prefix, auto-prepended
 *   3. Auto-detect from keychain
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/** Resolve signing identity from env or keychain */
function resolveIdentity() {
  if (process.env.APPLE_IDENTITY) return process.env.APPLE_IDENTITY;
  if (process.env.CSC_NAME) {
    const name = process.env.CSC_NAME;
    return name.startsWith('Developer ID') ? name : `Developer ID Application: ${name}`;
  }

  try {
    const output = execSync(
      'security find-identity -v -p codesigning | grep "Developer ID Application"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const match = output.match(/"(Developer ID Application:[^"]+)"/);
    if (match) {
      console.log(`[afterPack] Auto-detected signing identity: ${match[1]}`);
      return match[1];
    }
  } catch (e) {
    // no cert found
  }
  return null;
}

/** Sign a single file */
function signFile(filePath, identity, entitlements) {
  try {
    execSync(
      `codesign --force --options runtime --timestamp --entitlements "${entitlements}" --sign "${identity}" "${filePath}"`,
      { stdio: 'inherit' }
    );
    return true;
  } catch (error) {
    console.warn(`[afterPack] Failed to sign ${path.basename(filePath)}: ${error.message}`);
    return false;
  }
}

/** Check if a file is a Mach-O binary */
function isMachO(filePath) {
  try {
    const output = execSync(`file "${filePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return output.includes('Mach-O');
  } catch {
    return false;
  }
}

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;

  if (process.platform !== 'darwin') {
    console.log('[afterPack] Not macOS, skipping');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const entitlements = path.join(__dirname, 'entitlements', 'inherit.plist');
  const arch = packager.packagerOptions.arch || process.arch;

  const identity = resolveIdentity();
  const nodeRuntimeDir = path.join(resourcesPath, 'node-runtime', `darwin-${arch}`);

  if (identity && fs.existsSync(nodeRuntimeDir)) {
    console.log(`[afterPack] Signing node-runtime binaries in: ${nodeRuntimeDir}`);
    console.log(`[afterPack] Identity: ${identity}`);

    let signedCount = 0;
    let skippedCount = 0;

    function walkAndSign(dir) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.lstatSync(fullPath);

        if (stat.isSymbolicLink()) { skippedCount++; continue; }
        if (stat.isDirectory()) { walkAndSign(fullPath); continue; }
        if (!stat.isFile()) continue;

        if (isMachO(fullPath)) {
          console.log(`[afterPack] Signing: ${path.relative(nodeRuntimeDir, fullPath)}`);
          if (signFile(fullPath, identity, entitlements)) signedCount++;
        }
      }
    }

    walkAndSign(nodeRuntimeDir);
    console.log(`[afterPack] node-runtime signing done. Signed: ${signedCount}, Skipped symlinks: ${skippedCount}`);
  } else if (!identity) {
    console.log('[afterPack] No signing identity, skipping node-runtime signing');
  } else {
    console.log(`[afterPack] node-runtime not found at: ${nodeRuntimeDir}, skipping`);
  }
};
