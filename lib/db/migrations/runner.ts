import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function runMigrations(db: Database.Database, migrationsDir: string) {
  // Fast path: check if there are pending migrations BEFORE acquiring lock.
  // This avoids the expensive file-lock dance when no migrations are needed,
  // which is the common case on every worker process startup.
  const hasPending = checkPendingMigrations(db, migrationsDir);
  if (!hasPending) {
    console.log('[Migration] No pending migrations');
    return;
  }

  // Slow path: there are pending migrations, acquire file lock and run them.
  runMigrationsWithLock(db, migrationsDir);
}

/**
 * Quick check for pending migrations without acquiring any lock.
 * Returns true if there are migrations to apply.
 */
function checkPendingMigrations(db: Database.Database, migrationsDir: string): boolean {
  try {
    // Check if schema_migrations table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get();

    if (!tableExists) {
      // Table doesn't exist — need to run initial migration
      return true;
    }

    const current = db.prepare(
      'SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations'
    ).get() as { version: number };

    const migrations = loadMigrations(migrationsDir);
    return migrations.some(m => m.version > current.version);
  } catch {
    // If anything fails, fall through to the locked path
    return true;
  }
}

/**
 * Run migrations with file-lock protection (only called when pending migrations exist).
 */
function runMigrationsWithLock(db: Database.Database, migrationsDir: string) {
  const dbPath = db.name;
  const dataDir = path.dirname(dbPath);
  const lockFile = path.join(dataDir, '.migration.lock');
  let lockAcquired = false;
  let lockFd: number | null = null;

  try {
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts && !lockAcquired) {
      try {
        lockFd = fs.openSync(lockFile, 'wx');

        const lockData = {
          pid: process.pid,
          timestamp: new Date().toISOString(),
          hostname: require('os').hostname()
        };
        fs.writeSync(lockFd, JSON.stringify(lockData, null, 2));
        lockAcquired = true;
        console.log(`[Migration] Lock acquired by PID ${process.pid}`);
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          if (attempts === 0) {
            console.log('[Migration] Another process is running migrations, waiting...');
          }

          try {
            const lockStat = fs.statSync(lockFile);
            const lockAge = Date.now() - lockStat.mtimeMs;

            if (lockAge > 180000) {
              console.warn(`[Migration] Stale lock file detected (age: ${Math.round(lockAge/1000)}s), removing...`);
              fs.unlinkSync(lockFile);
              continue;
            }
          } catch {
            continue;
          }

          const start = Date.now();
          while (Date.now() - start < 500) {
            // Busy wait
          }

          attempts++;
          if (attempts % 5 === 0) {
            console.log(`[Migration] Still waiting... (${attempts}/${maxAttempts})`);
          }
        } else {
          throw error;
        }
      }
    }

    if (!lockAcquired) {
      console.warn('[Migration] Timeout waiting for lock, assuming migrations are handled by other process');
      return;
    }

    // Ensure schema_migrations table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL
      )
    `);

    const current = db.prepare(
      'SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations'
    ).get() as { version: number };

    const migrations = loadMigrations(migrationsDir);
    const pending = migrations.filter(m => m.version > current.version);

    if (pending.length === 0) {
      // Another process may have already applied them while we waited for the lock
      console.log('[Migration] No pending migrations (resolved by another process)');
      return;
    }

    console.log(`[Migration] Current schema version: ${current.version}, pending: ${pending.length}`);

    const runInTransaction = db.transaction((migrations: Migration[]) => {
      for (const migration of migrations) {
        console.log(`[Migration] Applying ${migration.version}: ${migration.name}`);

        try {
          db.exec(migration.sql);
          db.prepare(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
          ).run(migration.version, migration.name, new Date().toISOString());

          console.log(`[Migration] ✓ Applied ${migration.version}`);
        } catch (error) {
          console.error(`[Migration] ✗ Failed ${migration.version}:`, error);
          throw error;
        }
      }
    });

    runInTransaction(pending);
    console.log(`[Migration] Successfully applied ${pending.length} migration(s)`);
  } catch (error) {
    console.error('[Migration] Error during migration:', error);
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        if (lockFd !== null) {
          fs.closeSync(lockFd);
        }
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log(`[Migration] Lock released by PID ${process.pid}`);
        }
      } catch (unlinkError) {
        console.warn('[Migration] Failed to remove lock file:', unlinkError);
      }
    }
  }
}

function loadMigrations(migrationsDir: string): Migration[] {
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[Migration] Migrations directory not found: ${migrationsDir}`);
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}`);
    }

    return {
      version: parseInt(match[1]),
      name: match[2],
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    };
  });
}
