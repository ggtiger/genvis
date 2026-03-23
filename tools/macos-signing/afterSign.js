/**
 * electron-builder afterSign hook
 * 1. Sign node-runtime Mach-O binaries missed by electron-builder
 * 2. Notarize the app bundle if NOTARIZE=true
 *
 * Signing identity resolution order:
 *   1. CSC_NAME  - explicit identity name (e.g. "Developer ID Application: ...")
 *   2. APPLE_IDENTITY - alternative env var
 *   3. Auto-detect from keychain (first Developer ID Application cert found)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/** Resolve signing identity from env or keychain */
function resolveIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  if (process.env.APPLE_IDENTITY) return process.env.APPLE_IDENTITY;

  // Auto-detect from keychain
  try {
    const output = execSync(
      'security find-identity -v -p codesigning | grep "Developer ID Application"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const match = output.match(/"(Developer ID Application:[^"]+)"/);
    if (match) {
      console.log(`[afterSign] Auto-detected signing identity: ${match[1]}`);
      return match[1];
    }
  } catch (e) {
    // no cert found
  }
  return null;
}

/** Sign a single file, return true on success */
function signFile(filePath, identity, entitlements) {
  try {
    execSync(
      `codesign --force --options runtime --timestamp --entitlements "${entitlements}" --sign "${identity}" "${filePath}"`,
      { stdio: 'inherit' }
    );
    return true;
  } catch (error) {
    console.warn(`[afterSign] Failed to sign ${path.basename(filePath)}: ${error.message}`);
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

exports.default = async function afterSign(context) {
  const { appOutDir, packager } = context;

  if (process.platform !== 'darwin') {
    console.log('[afterSign] Not macOS, skipping');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const entitlements = path.join(__dirname, 'entitlements', 'inherit.plist');
  const arch = packager.packagerOptions.arch || process.arch;

  // ── Step 1: Sign node-runtime binaries ──
  const identity = resolveIdentity();
  const nodeRuntimeDir = path.join(resourcesPath, 'node-runtime', `darwin-${arch}`);

  if (identity && fs.existsSync(nodeRuntimeDir)) {
    console.log(`[afterSign] Signing node-runtime binaries in: ${nodeRuntimeDir}`);
    console.log(`[afterSign] Identity: ${identity}`);

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
          console.log(`[afterSign] Signing: ${path.relative(nodeRuntimeDir, fullPath)}`);
          if (signFile(fullPath, identity, entitlements)) signedCount++;
        }
      }
    }

    walkAndSign(nodeRuntimeDir);
    console.log(`[afterSign] node-runtime signing done. Signed: ${signedCount}, Skipped symlinks: ${skippedCount}`);
  } else if (!identity) {
    console.log('[afterSign] No signing identity, skipping node-runtime signing');
  } else {
    console.log(`[afterSign] node-runtime not found at: ${nodeRuntimeDir}, skipping`);
  }

  // ── Step 2: Notarize (only when NOTARIZE=true) ──
  if (process.env.NOTARIZE !== 'true') {
    console.log('[afterSign] Notarization skipped (NOTARIZE != true)');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('[afterSign] Notarization skipped: missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID');
    return;
  }

  console.log(`[afterSign] Notarizing: ${appPath}`);
  console.log(`[afterSign] Apple ID: ${appleId}, Team: ${teamId}`);

  try {
    // @electron/notarize is a dep of electron-builder, always available
    const { notarize } = require('@electron/notarize');
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('[afterSign] Notarization complete!');
  } catch (err) {
    console.error('[afterSign] Notarization failed:', err.message);
    throw err;
  }
};
