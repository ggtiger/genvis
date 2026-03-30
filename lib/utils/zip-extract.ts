/**
 * Zip extraction utility using adm-zip.
 * Used by skill-market direct download to extract skill packages.
 */

import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

/**
 * Extract a zip buffer to a target directory.
 * If the zip contains a single root folder, its contents are extracted directly
 * to targetDir (i.e., the wrapper folder is stripped).
 */
export async function extractZipBuffer(
  buffer: Buffer,
  targetDir: string,
): Promise<void> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    throw new Error('Zip archive is empty');
  }

  // Detect if there's a single root directory wrapping all entries
  const rootDirs = new Set<string>();
  for (const entry of entries) {
    const firstPart = entry.entryName.split('/')[0];
    if (firstPart) rootDirs.add(firstPart);
  }

  const singleRoot = rootDirs.size === 1 ? [...rootDirs][0] : null;
  const stripPrefix = singleRoot ? `${singleRoot}/` : '';

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of entries) {
    let entryPath = entry.entryName;

    // Strip single root directory prefix if present
    if (stripPrefix && entryPath.startsWith(stripPrefix)) {
      entryPath = entryPath.slice(stripPrefix.length);
    }

    if (!entryPath || entryPath === '/') continue;

    const fullPath = path.join(targetDir, entryPath);

    // Security: ensure path doesn't escape target directory
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(targetDir))) {
      console.warn(`[zip-extract] Skipping entry with path traversal: ${entry.entryName}`);
      continue;
    }

    if (entry.isDirectory) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, entry.getData());
    }
  }
}
