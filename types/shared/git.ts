/**
 * Git-related shared types
 * Used by both API routes and frontend components
 */

/** File Git status from `git status --porcelain` */
export type GitFileStatus =
  | 'M'    // Modified (working tree)
  | 'A'    // Staged new file
  | 'D'    // Deleted
  | 'R'    // Renamed
  | '?'    // Untracked
  | 'MM'   // Both staged and working tree changes
  | 'AM'   // Staged new + working tree changes
  | 'clean';

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  relativeTime: string;
}

export interface GitStatusResult {
  initialized: boolean;
  branch: string;
  hasRemote: boolean;
  files: Array<{ path: string; status: GitFileStatus; indexStatus: string; workTreeStatus: string }>;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
}

/** Single line in a unified diff */
export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** A hunk in a unified diff */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** Parsed result of a single file diff */
export interface FileDiffResult {
  filePath: string;
  from: string;
  to: string;
  addedLines: number;
  removedLines: number;
  hunks: DiffHunk[];
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  truncated?: boolean;
}

/** Summary entry for multi-file diff */
export interface DiffSummaryEntry {
  path: string;
  status: GitFileStatus;
  addedLines: number;
  removedLines: number;
}

