/**
 * electron-builder afterSign hook
 * Runs AFTER code signing — only handles notarization.
 * Node-runtime signing is done in afterPack.js (before signing).
 */

const path = require('path');

exports.default = async function afterSign(context) {
  const { appOutDir, packager } = context;

  if (process.platform !== 'darwin') {
    console.log('[afterSign] Not macOS, skipping');
    return;
  }

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

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[afterSign] Notarizing: ${appPath}`);
  console.log(`[afterSign] Apple ID: ${appleId}, Team: ${teamId}`);

  try {
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
