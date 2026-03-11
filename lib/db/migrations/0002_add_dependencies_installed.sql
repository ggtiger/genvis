-- Add dependencies_installed column to projects table
ALTER TABLE projects ADD COLUMN dependencies_installed INTEGER NOT NULL DEFAULT 0;
