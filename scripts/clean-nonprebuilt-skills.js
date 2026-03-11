#!/usr/bin/env node
/**
 * Clean .next/ and node_modules/ from skills that were NOT pre-built.
 * 
 * Pre-built skills have a `.prebuild-manifest.json` file.
 * This script runs before electron-builder packaging to ensure only
 * pre-built skills include their build artifacts.
 * 
 * For pre-built skills, node_modules is still stripped (standalone .next
 * doesn't need it at runtime — `npm start` uses the standalone server).
 * Instead, we keep only the .next/standalone directory which is self-contained.
 */

const path = require('path');
const fs = require('fs');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('[clean-skills] No skills directory found, nothing to do');
    return;
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);
    const manifestPath = path.join(skillDir, '.prebuild-manifest.json');
    const nextDir = path.join(skillDir, '.next');

    if (fs.existsSync(manifestPath)) {
      console.log(`[clean-skills] ✅ "${entry.name}" is pre-built, keeping .next/`);
    } else {
      // Not pre-built — remove .next/ if it exists
      if (fs.existsSync(nextDir)) {
        console.log(`[clean-skills] 🧹 "${entry.name}" is NOT pre-built, removing .next/`);
        fs.rmSync(nextDir, { recursive: true, force: true });
      }
    }
  }

  console.log('[clean-skills] Done');
}

main();
