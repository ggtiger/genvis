/**
 * Context Files Service
 *
 * Tracks recently operated Office/PDF files (upload, generate, create).
 * Stored as a JSON file. Supports pin, delete, and file-existence check.
 *
 * Storage: {SETTINGS_DIR}/context-files.json or {cwd}/data/context-files.json
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export interface ContextFileRecord {
  id: string;
  name: string;           // display name (original filename)
  absolutePath: string;    // actual file path on disk
  mimeType: string;
  size: number;            // bytes
  type: 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'md' | 'other';
  pinned: boolean;
  createdAt: string;       // ISO timestamp when recorded
  exists?: boolean;        // populated at read-time, not persisted
}

interface ContextFilesData {
  files: Omit<ContextFileRecord, 'exists'>[];
}

const OFFICE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.md',
]);

function getDataDir(): string {
  return process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
}

function getFilePath(): string {
  return path.join(getDataDir(), 'context-files.json');
}

function extToType(ext: string): ContextFileRecord['type'] {
  const map: Record<string, ContextFileRecord['type']> = {
    '.pdf': 'pdf', '.doc': 'doc', '.docx': 'docx',
    '.xls': 'xls', '.xlsx': 'xlsx', '.ppt': 'ppt', '.pptx': 'pptx', '.md': 'md',
  };
  return map[ext.toLowerCase()] || 'other';
}

export function isOfficeOrPdf(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return OFFICE_EXTENSIONS.has(ext);
}

async function loadData(): Promise<ContextFilesData> {
  try {
    const raw = await fs.readFile(getFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.files)) return parsed;
  } catch { /* file missing or corrupt */ }
  return { files: [] };
}

async function saveData(data: ContextFilesData): Promise<void> {
  const dir = getDataDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getFilePath(), JSON.stringify(data, null, 2), 'utf-8');
}

async function checkExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Get all context files, with existence check */
export async function listContextFiles(): Promise<ContextFileRecord[]> {
  const data = await loadData();
  // Check existence in parallel
  const results = await Promise.all(
    data.files.map(async (f) => ({
      ...f,
      exists: await checkExists(f.absolutePath),
    }))
  );
  // Sort: pinned first, then by createdAt desc
  results.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return results;
}

/** Add a file record. Deduplicates by absolutePath. */
export async function addContextFile(info: {
  name: string;
  absolutePath: string;
  mimeType: string;
  size: number;
}): Promise<ContextFileRecord> {
  const data = await loadData();
  // Deduplicate
  const existing = data.files.find((f) => f.absolutePath === info.absolutePath);
  if (existing) {
    existing.name = info.name;
    existing.size = info.size;
    existing.createdAt = new Date().toISOString();
    await saveData(data);
    return { ...existing, exists: true };
  }
  const ext = path.extname(info.name);
  const record: Omit<ContextFileRecord, 'exists'> = {
    id: randomUUID(),
    name: info.name,
    absolutePath: info.absolutePath,
    mimeType: info.mimeType,
    size: info.size,
    type: extToType(ext),
    pinned: false,
    createdAt: new Date().toISOString(),
  };
  data.files.unshift(record);
  await saveData(data);
  return { ...record, exists: true };
}

/** Remove a context file record by id */
export async function removeContextFile(id: string): Promise<boolean> {
  const data = await loadData();
  const idx = data.files.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  data.files.splice(idx, 1);
  await saveData(data);
  return true;
}

/** Toggle pin status */
export async function togglePinContextFile(id: string): Promise<boolean> {
  const data = await loadData();
  const file = data.files.find((f) => f.id === id);
  if (!file) return false;
  file.pinned = !file.pinned;
  await saveData(data);
  return true;
}
