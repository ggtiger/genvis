/**
 * electron-builder afterSign hook
 * Runs AFTER code signing — only handles notarization.
 * Node-runtime signing is done in afterPack.js (before signing).
 *
 * Uses async notarization: submits request and continues without waiting.
 * Check notarization status manually using:
 *   xcrun notarytool history --apple-id <id> --password <pwd> --team-id <team>
 */

const path = require('path');
const { execSync } = require('child_process');

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

  console.log(`[afterSign] Submitting for notarization: ${appPath}`);
  console.log(`[afterSign] Apple ID: ${appleId}, Team: ${teamId}`);

  try {
    // Create zip for notarization (notarytool requires zip or dmg)
    const zipPath = appPath.replace('.app', '-notarize.zip');
    execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

    // Submit for notarization without waiting
    const result = execSync(
      `xcrun notarytool submit "${zipPath}" ` +
      `--apple-id "${appleId}" ` +
      `--password "${appleIdPassword}" ` +
      `--team-id "${teamId}" ` +
      `--no-wait`,
      { encoding: 'utf8' }
    );

    console.log('[afterSign] Notarization submitted successfully!');
    console.log('[afterSign] Submission result:', result.trim());
    console.log('[afterSign] Check status with: xcrun notarytool history --apple-id <id> --password <pwd> --team-id <team>');

    // Clean up zip
    try {
      require('fs').unlinkSync(zipPath);
    } catch {}

  } catch (err) {
    // Log error but don't fail the build
    console.error('[afterSign] Notarization submission failed:', err.message);
    console.warn('[afterSign] Continuing build without notarization. You can notarize manually later.');
    // Don't throw - allow build to continue
  }
};
