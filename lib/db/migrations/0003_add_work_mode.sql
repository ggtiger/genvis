-- Add work mode support
-- Add mode column (code or work)
ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'code';

-- Add work_directory column for work mode
ALTER TABLE projects ADD COLUMN work_directory TEXT;
