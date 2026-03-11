#!/usr/bin/env node

/**
 * Next.js development server launcher with automatic port management.
 * Expects scripts/setup-env.js to have been executed beforehand.
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');
const { ensureEnvironment } = require('./setup-env');
const Database = require('better-sqlite3');

const rootDir = path.join(__dirname, '..');
const isWindows = os.platform() === 'win32';

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });

function readServerConfig() {
  try {
    const dataDir = process.env.SETTINGS_DIR || path.join(rootDir, 'data');
    const settingsFile = path.join(dataDir, 'global-settings.json');

    if (fs.existsSync(settingsFile)) {
      const content = fs.readFileSync(settingsFile, 'utf8');
      const settings = JSON.parse(content);
      return settings?.server?.allow_remote_access === true;
    }
  } catch (error) {
    // Ignore errors, default to false
  }
  return false;
}

function parseCliArgs(argv) {
  const passthrough = [];
  let preferredPort;
  let remote = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--remote') {
      remote = true;
      continue;
    }

    if (arg === '--port' || arg === '-p') {
      const value = argv[i + 1];
      if (value && !value.startsWith('-')) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) {
          preferredPort = parsed;
        }
        i += 1;
        continue;
      }
    } else if (arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        preferredPort = parsed;
      }
      continue;
    } else if (arg.startsWith('-p=')) {
      const value = arg.slice('-p='.length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        preferredPort = parsed;
      }
      continue;
    }

    passthrough.push(arg);
  }

  return { preferredPort, passthrough, remote };
}

async function ensureDatabaseSynced() {
  if (process.env.SKIP_DB_SYNC === '1') {
    return;
  }

  // Database will be initialized by lib/db/client.ts on first import
  // The migration runner will automatically run pending migrations
  // We just need to verify the database is accessible

  try {
    const dbUrl = process.env.DATABASE_URL || 'file:./data/prod.db';
    const dbPath = dbUrl.replace(/^file:/, '');
    const resolvedDbPath = path.isAbsolute(dbPath)
      ? dbPath
      : path.resolve(rootDir, dbPath);

    // Ensure database directory exists
    const dbDir = path.dirname(resolvedDbPath);
    const fs = require('fs');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log('🗃️  Database migrations will run automatically on first server start');
  } catch (error) {
    console.warn(
      '⚠️  Database initialization warning:',
      error instanceof Error ? error.message : error
    );
  }
}

async function startWebDevServer({
  preferredPort,
  passthrough = [],
  stdio = 'inherit',
  remote = false,
} = {}) {
  const { port, url } = await ensureEnvironment({
    preferredPort,
  });

  await ensureDatabaseSynced();

  const resolvedPort = port;
  const resolvedUrl = url;

  process.env.PORT = resolvedPort.toString();
  process.env.WEB_PORT = resolvedPort.toString();
  process.env.NEXT_PUBLIC_APP_URL = resolvedUrl;

  // Read config if remote is not explicitly set via CLI
  const allowRemoteFromConfig = readServerConfig();
  const shouldUseRemote = remote || allowRemoteFromConfig;

  const hostname = shouldUseRemote ? '0.0.0.0' : 'localhost';
  console.log(`🚀 Starting Next.js dev server on ${resolvedUrl}${shouldUseRemote ? ' (remote access enabled)' : ''}`);

  const nextArgs = ['next', 'dev', '--hostname', hostname, '--port', resolvedPort.toString(), ...passthrough];
  const child = spawn(
    'npx',
    nextArgs,
    {
      cwd: rootDir,
      stdio,
      shell: isWindows,
      env: {
        ...process.env,
        PORT: resolvedPort.toString(),
        WEB_PORT: resolvedPort.toString(),
        NEXT_PUBLIC_APP_URL: resolvedUrl,
        BROWSER: process.env.BROWSER || 'none',
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_ENV: 'development',
      },
    }
  );

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    child.once('error', handleError);
    child.once('spawn', () => {
      child.removeListener('error', handleError);
      resolve();
    });
  });

  return { child, port: resolvedPort, url: resolvedUrl };
}

async function runFromCli() {
  const argv = process.argv.slice(2);
  const { preferredPort, passthrough, remote } = parseCliArgs(argv);

  const { child } = await startWebDevServer({
    preferredPort,
    passthrough,
    stdio: 'inherit',
    remote,
  });

  child.on('error', (error) => {
    console.error('\n❌ Failed to start Next.js dev server');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (typeof code === 'number' && code !== 0) {
      console.error(`\n❌ Next.js dev server exited with code ${code}`);
      process.exit(code);
    }
  });
}

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error('\n❌ Failed to launch dev server');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  parseCliArgs,
  startWebDevServer,
};
