import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { GitFileStatus, GitCommit, GitStatusResult, DiffLine, DiffHunk, FileDiffResult, DiffSummaryEntry } from '@/types/shared/git';

class GitError extends Error {
  constructor(message: string, readonly output?: string) {
    super(message);
    this.name = 'GitError';
  }
}

const DEFAULT_GITIGNORE_ENTRIES = [
  '# Dependencies',
  'node_modules/',
  '',
  '# Next.js build output',
  '.next/',
  'out/',
  '',
  '# Build artifacts',
  'dist/',
  'build/',
  '.turbo/',
  '',
  '# Environment files',
  '.env',
  '.env.*',
  '',
  '# Misc',
  '.DS_Store',
  '.git-backup-*',
  '.vercel/',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  'pnpm-debug.log*',
];

function ensureGitignore(repoPath: string) {
  const gitignorePath = path.join(repoPath, '.gitignore');
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${DEFAULT_GITIGNORE_ENTRIES.join('\n')}\n`, 'utf8');
    return;
  }

  const existing = fs.readFileSync(gitignorePath, 'utf8');
  const existingLines = existing.split(/\r?\n/);
  const normalized = new Set(existingLines.map((line) => line.trim()));

  const additions = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      // always allow blank lines to keep grouping but avoid duplicating consecutive blanks
      return (
        existingLines.length === 0 ||
        existingLines[existingLines.length - 1].trim().length !== 0
      );
    }
    return !normalized.has(trimmed);
  });

  if (additions.length === 0) {
    return;
  }

  const trimmedExisting = existing.replace(/\s+$/u, '');
  const separator = trimmedExisting.length > 0 ? '\n\n' : '';
  const nextContents = `${trimmedExisting}${separator}${additions.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, nextContents, 'utf8');
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 20, // allow larger git output before hitting ENOBUFS
  });

  if (result.error) {
    throw new GitError(`Git command failed: ${result.error.message}`, result.stderr || result.stdout || undefined);
  }

  if (result.status !== 0) {
    const output =
      (typeof result.stderr === 'string' && result.stderr.trim().length > 0
        ? result.stderr
        : typeof result.stdout === 'string'
        ? result.stdout
        : undefined);
    throw new GitError(`Git command failed: git ${args.join(' ')}`, output);
  }

  return result.stdout.trim();
}

function untrackIgnoredPaths(repoPath: string) {
  const pathsToUntrack = ['node_modules', '.next', 'dist', 'build', 'out', '.turbo', '.vercel'];
  for (const entry of pathsToUntrack) {
    runGit(['rm', '-r', '--cached', '--ignore-unmatch', entry], repoPath);
  }
}

export function ensureGitConfig(repoPath: string, name: string, email: string) {
  runGit(['config', '--local', 'user.name', name], repoPath);
  runGit(['config', '--local', 'user.email', email], repoPath);
}

export function initializeMainBranch(repoPath: string) {
  try {
    runGit(['rev-parse', 'HEAD'], repoPath);
  } catch {
    try {
      runGit(['commit', '--allow-empty', '-m', 'Initial commit'], repoPath);
    } catch (error) {
      throw error;
    }
  }

  try {
    const currentBranch = runGit(['branch', '--show-current'], repoPath);
    if (currentBranch !== 'main') {
      runGit(['branch', '-M', 'main'], repoPath);
    }
  } catch {
    try {
      runGit(['checkout', '-b', 'main'], repoPath);
    } catch {
      // ignore
    }
  }
}

export function addOrUpdateRemote(repoPath: string, remoteName: string, remoteUrl: string) {
  try {
    const existing = runGit(['remote', 'get-url', remoteName], repoPath);
    if (existing !== remoteUrl) {
      runGit(['remote', 'set-url', remoteName, remoteUrl], repoPath);
    }
  } catch {
    runGit(['remote', 'add', remoteName, remoteUrl], repoPath);
  }
}

export function commitAll(repoPath: string, message: string) {
  try {
    untrackIgnoredPaths(repoPath);
    runGit(['add', '-A'], repoPath);
    runGit(['commit', '-m', message], repoPath);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.output && error.output.includes('nothing to commit')) {
      return false;
    }
    throw error;
  }
}

export function pushToRemote(repoPath: string, remoteName = 'origin', branch = 'main') {
  try {
    runGit(['push', '-u', remoteName, branch], repoPath);
  } catch (error) {
    if (error instanceof GitError) {
      runGit(['push', '-u', '--force', remoteName, branch], repoPath);
    } else {
      throw error;
    }
  }
}

export function ensureGitRepository(repoPath: string) {
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    runGit(['init'], repoPath);
  }
  ensureGitignore(repoPath);
}

// ==================== New Git operations ====================

/**
 * Check whether a directory is a git repository
 */
export function isGitRepository(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git'));
}

/**
 * Decode git quoted filenames.
 * Git wraps non-ASCII filenames in double quotes with octal escape sequences:
 *   "doc/\344\273\243\347\240\201.md" → doc/代码.md
 * Also handles trailing/leading quotes.
 */
function decodeGitPath(raw: string): string {
  // If the path is quoted, strip quotes and decode octal escapes
  if (raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1);
  }
  // Replace octal escape sequences \NNN with actual bytes
  if (raw.includes('\\')) {
    const bytes: number[] = [];
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 3 < raw.length) {
        const oct = raw.substring(i + 1, i + 4);
        if (/^[0-3][0-7]{2}$/.test(oct)) {
          bytes.push(parseInt(oct, 8));
          i += 4;
          continue;
        }
      }
      bytes.push(raw.charCodeAt(i));
      i++;
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return raw;
}

/**
 * Parse git status --porcelain output into GitFileStatus
 */
function parseStatusCode(x: string, y: string): GitFileStatus {
  if (x === '?' && y === '?') return '?';
  if (x === 'A' && y === 'M') return 'AM';
  if (x === 'M' && y === 'M') return 'MM';
  if (x === 'A' || y === 'A') return 'A';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'R' || y === 'R') return 'R';
  if (x === 'M' || y === 'M') return 'M';
  return 'clean';
}

/**
 * Get git status for the repository
 */
export function getGitStatus(repoPath: string): GitStatusResult {
  if (!isGitRepository(repoPath)) {
    return { initialized: false, branch: '', hasRemote: false, files: [], stagedCount: 0, unstagedCount: 0, untrackedCount: 0 };
  }

  let branch = '';
  try {
    branch = runGit(['branch', '--show-current'], repoPath);
  } catch {
    branch = '';
  }

  let hasRemote = false;
  try {
    const remotes = runGit(['remote'], repoPath);
    hasRemote = remotes.trim().length > 0;
  } catch {
    hasRemote = false;
  }

  let output = '';
  try {
    output = runGit(['status', '--porcelain'], repoPath);
  } catch {
    return { initialized: true, branch, hasRemote, files: [], stagedCount: 0, unstagedCount: 0, untrackedCount: 0 };
  }

  const files: Array<{ path: string; status: GitFileStatus; indexStatus: string; workTreeStatus: string }> = [];
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;

  if (output.trim()) {
    for (const line of output.split('\n')) {
      if (line.length < 3) continue;
      const x = line[0];
      const y = line[1];
      // Handle renamed files: "R  old -> new"
      let filePath = line.substring(3);
      filePath = decodeGitPath(filePath);
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ')[1];
      }
      const status = parseStatusCode(x, y);
      files.push({ path: filePath, status, indexStatus: x, workTreeStatus: y });

      if (x === '?' && y === '?') {
        untrackedCount++;
      } else {
        if (x !== ' ' && x !== '?') stagedCount++;
        if (y !== ' ' && y !== '?') unstagedCount++;
      }
    }
  }

  return { initialized: true, branch, hasRemote, files, stagedCount, unstagedCount, untrackedCount };
}

/**
 * Stage a single file
 */
export function gitStage(repoPath: string, filePath: string): void {
  runGit(['add', '--', filePath], repoPath);
}

/**
 * Discard working tree changes for a file
 */
export function gitRestore(repoPath: string, filePath: string): void {
  runGit(['checkout', '--', filePath], repoPath);
}

/**
 * Unstage a file (restore from staging area)
 */
export function gitRestoreStaged(repoPath: string, filePath: string): void {
  try {
    runGit(['restore', '--staged', '--', filePath], repoPath);
  } catch {
    // Fallback for older git versions
    runGit(['reset', 'HEAD', '--', filePath], repoPath);
  }
}

/**
 * Get diff for a single file against HEAD
 */
export function getGitFileDiff(repoPath: string, filePath: string, staged?: boolean, contextLines?: number): string {
  const ctxArg = contextLines !== undefined ? [`-U${contextLines}`] : [];
  const args = staged
    ? ['diff', ...ctxArg, '--cached', 'HEAD', '--', filePath]
    : ['diff', ...ctxArg, 'HEAD', '--', filePath];
  try {
    return runGit(args, repoPath);
  } catch (err) {
    // File might be new (untracked) — diff against empty
    if (!staged) {
      try {
        return runGit(['diff', ...ctxArg, '--no-index', '/dev/null', filePath], repoPath);
      } catch (e) {
        // git diff --no-index returns exit code 1 when there are differences
        if (e instanceof GitError && e.output) return e.output;
        throw e;
      }
    }
    throw err;
  }
}

/**
 * Get diff between two commits/branches, optionally for a specific file
 */
export function getGitDiff(repoPath: string, from: string, to: string, filePath?: string, contextLines?: number): string {
  const ctxArg = contextLines !== undefined ? [`-U${contextLines}`] : [];
  const args = ['diff', ...ctxArg, from, to];
  if (filePath) args.push('--', filePath);
  return runGit(args, repoPath);
}

/**
 * Get file content at a specific commit
 */
export function getGitFileAtCommit(repoPath: string, hash: string, filePath: string): string {
  return runGit(['show', `${hash}:${filePath}`], repoPath);
}

/**
 * Get commit log
 */
export function getGitLog(repoPath: string, maxCount = 20): GitCommit[] {
  let output: string;
  try {
    output = runGit(['log', `--pretty=format:%H|%s|%an|%ar`, `-n`, String(maxCount)], repoPath);
  } catch {
    return [];
  }
  if (!output.trim()) return [];
  return output.split('\n').map(line => {
    const [hash, message, author, relativeTime] = line.split('|');
    return {
      hash,
      shortHash: hash?.substring(0, 7) || '',
      message: message || '',
      author: author || '',
      relativeTime: relativeTime || '',
    };
  });
}

/**
 * Get current branch name
 */
export function getCurrentBranch(repoPath: string): string {
  try {
    return runGit(['branch', '--show-current'], repoPath);
  } catch {
    return '';
  }
}

/**
 * List all branches
 */
export function listBranches(repoPath: string): string[] {
  try {
    const output = runGit(['branch', '-a', '--format=%(refname:short)'], repoPath);
    if (!output.trim()) return [];
    return output.split('\n').map(b => b.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Checkout a branch
 */
export function checkoutBranch(repoPath: string, branch: string, create?: boolean): void {
  if (create) {
    runGit(['checkout', '-b', branch], repoPath);
  } else {
    runGit(['checkout', branch], repoPath);
  }
}

/**
 * Commit staged changes with a message
 */
export function commitStaged(repoPath: string, message: string): { committed: boolean; hash?: string } {
  try {
    runGit(['commit', '-m', message], repoPath);
    const hash = runGit(['rev-parse', '--short', 'HEAD'], repoPath);
    return { committed: true, hash };
  } catch (error) {
    if (error instanceof GitError && error.output && error.output.includes('nothing to commit')) {
      return { committed: false };
    }
    throw error;
  }
}

/**
 * Undo the last commit (git reset --soft HEAD~1)
 * Keeps changes staged so the user can re-commit or edit.
 */
export function undoLastCommit(repoPath: string): { undone: boolean; previousHash?: string } {
  try {
    const hash = runGit(['rev-parse', '--short', 'HEAD'], repoPath);
    runGit(['reset', '--soft', 'HEAD~1'], repoPath);
    return { undone: true, previousHash: hash };
  } catch (error) {
    if (error instanceof GitError) {
      throw new Error(`撤销提交失败: ${error.message}`);
    }
    throw error;
  }
}

// ==================== Diff parsing ====================

/**
 * Parse unified diff output into structured FileDiffResult
 */
export function parseUnifiedDiff(diffText: string, filePath: string, from: string, to: string): FileDiffResult {
  const result: FileDiffResult = {
    filePath,
    from,
    to,
    addedLines: 0,
    removedLines: 0,
    hunks: [],
    isBinary: false,
    isNew: false,
    isDeleted: false,
  };

  if (!diffText.trim()) return result;

  const lines = diffText.split('\n');
  const MAX_LINES = 10000;
  if (lines.length > MAX_LINES) {
    result.truncated = true;
    // Only parse first MAX_LINES lines
    lines.length = MAX_LINES;
  }

  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of lines) {
    // Binary file detection
    if (line.startsWith('Binary files')) {
      result.isBinary = true;
      return result;
    }

    // New/deleted file detection
    if (line.startsWith('--- /dev/null')) {
      result.isNew = true;
    }
    if (line.startsWith('+++ /dev/null')) {
      result.isDeleted = true;
    }

    // Hunk header
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLineNo = match ? parseInt(match[1], 10) : 1;
      newLineNo = match ? parseInt(match[2], 10) : 1;
      currentHunk = { header: line, lines: [] };
      result.hunks.push(currentHunk);
      currentHunk.lines.push({ type: 'header', content: line });
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', content: line.substring(1), oldLineNo: oldLineNo++ });
      result.removedLines++;
    } else if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.substring(1), newLineNo: newLineNo++ });
      result.addedLines++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNo: oldLineNo++, newLineNo: newLineNo++ });
    }
    // skip other lines (diff --git, index, ---, +++)
  }

  return result;
}

/**
 * Parse git diff --stat style output for summary
 */
export function getGitDiffSummary(repoPath: string): DiffSummaryEntry[] {
  const status = getGitStatus(repoPath);
  const result: DiffSummaryEntry[] = [];

  for (const file of status.files) {
    let addedLines = 0;
    let removedLines = 0;
    try {
      const diffOutput = file.status === '?'
        ? '' // untracked files don't have diff yet
        : runGit(['diff', 'HEAD', '--numstat', '--', file.path], repoPath);
      if (diffOutput.trim()) {
        const parts = diffOutput.trim().split('\t');
        addedLines = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        removedLines = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      }
    } catch {
      // ignore
    }
    result.push({ path: file.path, status: file.status, addedLines, removedLines });
  }

  return result;
}
