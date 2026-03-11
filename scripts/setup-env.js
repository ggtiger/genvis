#!/usr/bin/env node

/**
 * Development environment bootstrapper.
 * - Ensures .env and .env.local exist
 * - Finds an available localhost port for the Next.js dev server
 * - Syncs NEXT_PUBLIC_APP_URL, PORT, and WEB_PORT across env files
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const rootDir = path.join(__dirname, '..');
const envFile = path.join(rootDir, '.env');
const envLocalFile = path.join(rootDir, '.env.local');
const rootDataDir = path.join(rootDir, 'data');
// Note: projectsDir removed - will be determined from PROJECTS_DIR env var
const prismaDataDir = path.join(rootDir, 'prisma', 'data');
const sqlitePath = path.join(rootDataDir, 'cc.db');

const MAX_PORT = 65_535;
// Preview servers (per-project) dynamic pool
const FALLBACK_PORT_START = 3_135;
const FALLBACK_PORT_END = 3_999;
const DEFAULT_RANGE_SPAN = FALLBACK_PORT_END - FALLBACK_PORT_START;
// Claudable (root web app) default port and small scan span to avoid preview pool
const DEFAULT_WEB_PORT = 3_035;
const DEFAULT_WEB_SCAN_SPAN = 64; // scan up to 3099 at most
const DEFAULT_WEB_MAX = DEFAULT_WEB_PORT + DEFAULT_WEB_SCAN_SPAN;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function writeFileSafe(filePath, contents) {
  if (!contents.endsWith('\n')) {
    contents += '\n';
  }
  fs.writeFileSync(filePath, contents, 'utf8');
}

function upsertEnvValue(contents, key, value) {
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
  if (pattern.test(contents)) {
    return contents.replace(pattern, `${key}=${value}`);
  }

  if (contents.length && !contents.endsWith('\n')) {
    contents += '\n';
  }

  return contents + `${key}=${value}\n`;
}

function hasEnvKey(contents, key) {
  if (!contents) return false;
  const pattern = new RegExp(`^${escapeRegExp(key)}=`, 'm');
  return pattern.test(contents);
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '');
  }
}

function extractPort(contents, keys) {
  for (const key of keys) {
    const pattern = new RegExp(
      `^${escapeRegExp(key)}=["']?([0-9]{2,5})["']?$`,
      'm'
    );
    const match = contents.match(pattern);
    if (match) {
      const port = Number.parseInt(match[1], 10);
      if (!Number.isNaN(port) && port > 0 && port <= MAX_PORT) {
        return port;
      }
    }
  }
  return null;
}

function parsePortValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric) || numeric <= 0 || numeric > MAX_PORT) {
    return null;
  }
  return numeric;
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;

    const cleanup = (available) => {
      if (resolved) return;
      resolved = true;
      try {
        server.close();
      } catch (_) {
        // no-op
      }
      resolve(available);
    };

    server.once('error', () => cleanup(false)); // 端口被占用
    server.once('listening', () => cleanup(true)); // 端口可用

    // 超时保护
    setTimeout(() => cleanup(false), 500);

    try {
      server.listen(port, host);
    } catch (_) {
      cleanup(false);
    }
  });
}

async function isPortAvailable(port) {
  const results = await Promise.allSettled([
    checkPort('0.0.0.0', port),   // IPv4 通配
    checkPort('::', port),         // IPv6 通配
    checkPort('127.0.0.1', port), // IPv4 回环
    checkPort('::1', port),        // IPv6 回环
  ]);

  // IPv4 必须都可用，IPv6 失败忽略
  return results[0].status === 'fulfilled' && results[0].value &&
         results[2].status === 'fulfilled' && results[2].value;
}

async function findAvailablePort(rangeStart, rangeEnd, preferredPort) {
  if (rangeStart > rangeEnd) {
    throw new Error(
      `Invalid port range: start ${rangeStart} is greater than end ${rangeEnd}.`
    );
  }

  const normalizedPreferred = Math.min(
    Math.max(preferredPort ?? rangeStart, rangeStart),
    rangeEnd
  );

  for (let port = normalizedPreferred; port <= rangeEnd; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }

  for (let port = rangeStart; port < normalizedPreferred; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }

  throw new Error(
    `Could not find an available port between ${rangeStart} and ${rangeEnd}.`
  );
}

async function ensureEnvironment(options = {}) {
  console.log('🔧 Setting up development environment...');

  const { preferredPort: preferredOverride } = options ?? {};

  let envContents = readFileSafe(envFile);
  const envLocalContentsRaw = readFileSafe(envLocalFile);

  // Ensure required directories/files exist
  ensureDirectory(rootDataDir);
  ensureDirectory(prismaDataDir);
  ensureFile(sqlitePath);

  const envDefaults = {};
  if (!hasEnvKey(envContents, 'DATABASE_URL')) {
    envDefaults.DATABASE_URL = '"file:./data/prod.db"';
  }
  if (!hasEnvKey(envContents, 'PROJECTS_DIR')) {
    // Default to ./data/projects if not set
    envDefaults.PROJECTS_DIR = '"./data/projects"';
  }
  if (!hasEnvKey(envContents, 'ENCRYPTION_KEY')) {
    envDefaults.ENCRYPTION_KEY = `"${crypto.randomBytes(32).toString('hex')}"`;
  }

  const portStartCandidates = [
    parsePortValue(process.env.PREVIEW_PORT_START),
    extractPort(envContents, ['PREVIEW_PORT_START']),
  ];

  let portRangeStart =
    portStartCandidates.find((value) => value !== null) ?? FALLBACK_PORT_START;

  const portEndCandidates = [
    parsePortValue(process.env.PREVIEW_PORT_END),
    extractPort(envContents, ['PREVIEW_PORT_END']),
  ];

  let portRangeEnd =
    portEndCandidates.find((value) => value !== null) ?? FALLBACK_PORT_END;

  if (portRangeEnd < portRangeStart) {
    portRangeEnd = Math.min(
      MAX_PORT,
      portRangeStart + DEFAULT_RANGE_SPAN
    );
  }

  const overridePreferred =
    preferredOverride !== undefined && preferredOverride !== null
      ? parsePortValue(String(preferredOverride))
      : null;

  const sanitizeWebCandidate = (val) => {
    if (val === null || val === undefined) return null;
    if (val >= portRangeStart && val <= portRangeEnd) return null;
    if (val < DEFAULT_WEB_PORT || val > DEFAULT_WEB_MAX) {
      return DEFAULT_WEB_PORT;
    }
    return val;
  };

  const preferredPortCandidates = [
    sanitizeWebCandidate(overridePreferred),
    sanitizeWebCandidate(parsePortValue(process.env.WEB_PORT)),
    sanitizeWebCandidate(parsePortValue(process.env.PORT)),
    sanitizeWebCandidate(extractPort(envContents, ['PORT', 'WEB_PORT'])),
  ];

  let preferredPort =
    preferredPortCandidates.find((value) => value !== null) ?? DEFAULT_WEB_PORT;

  // Compute scan window for WEB app: stay below preview range when possible
  let webRangeStart = preferredPort;
  let webRangeEnd = Math.min(
    preferredPort + DEFAULT_WEB_SCAN_SPAN,
    portRangeStart > preferredPort ? portRangeStart - 1 : preferredPort + DEFAULT_WEB_SCAN_SPAN
  );
  if (webRangeEnd < webRangeStart) {
    webRangeEnd = webRangeStart;
  }

  const port = await findAvailablePort(webRangeStart, webRangeEnd, preferredPort);
  const url = `http://localhost:${port}`;

  if (port !== preferredPort) {
    console.log(
      `⚠️  Port ${preferredPort} is busy. Switching to available port ${port} within ${webRangeStart}-${webRangeEnd}.`
    );
  } else {
    console.log(
      `✅ Using port ${port} (range ${webRangeStart}-${webRangeEnd}).`
    );
  }

  const envUpdates = {
    PORT: String(port),
    WEB_PORT: String(port),
    NEXT_PUBLIC_APP_URL: `"${url}"`,
    PREVIEW_PORT_START: String(portRangeStart),
    PREVIEW_PORT_END: String(portRangeEnd),
  };

  let updatedEnv = envContents || '# Auto-generated defaults - customize as needed\n';
  for (const [key, value] of Object.entries(envDefaults)) {
    updatedEnv = upsertEnvValue(updatedEnv, key, value);
  }
  for (const [key, value] of Object.entries(envUpdates)) {
    updatedEnv = upsertEnvValue(updatedEnv, key, value);
  }
  writeFileSafe(envFile, updatedEnv);
  console.log(`📝 Updated ${path.relative(rootDir, envFile)}`);

  let envLocalContents = envLocalContentsRaw;
  if (!envLocalContents.trim()) {
    envLocalContents = '# Auto-generated by scripts/setup-env.js\n';
  }

  const envLocalUpdates = {
    NEXT_PUBLIC_APP_URL: url,
    PORT: String(port),
    WEB_PORT: String(port),
    PREVIEW_PORT_START: String(portRangeStart),
    PREVIEW_PORT_END: String(portRangeEnd),
  };

  for (const [key, value] of Object.entries(envLocalUpdates)) {
    envLocalContents = upsertEnvValue(envLocalContents, key, value);
  }
  writeFileSafe(envLocalFile, envLocalContents);
  console.log(`📝 Updated ${path.relative(rootDir, envLocalFile)}`);

  console.log('✅ Environment ready!');
  return { port, url };
}

if (require.main === module) {
  ensureEnvironment().catch((error) => {
    console.error('❌ Failed to set up environment.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { ensureEnvironment };
