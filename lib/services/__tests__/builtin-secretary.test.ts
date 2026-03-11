import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Unit tests for builtin-secretary employee configuration.
 * Validates: Requirements 1.2
 *
 * Verifies that the builtin-secretary employee entry in builtin-employees.json
 * has the correct id, name, category, mode, is_builtin, and system_prompt fields.
 */

interface BuiltinEmployee {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: string;
  first_prompt: string;
  system_prompt: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

interface BuiltinEmployeesFile {
  categories: { key: string; name: string }[];
  employees: BuiltinEmployee[];
}

describe('builtin-secretary employee configuration', () => {
  const filePath = path.resolve(__dirname, '../../../builtin-employees.json');
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const data: BuiltinEmployeesFile = JSON.parse(fileContent);
  const secretary = data.employees.find((e) => e.id === 'builtin-secretary');

  it('should exist in builtin-employees.json', () => {
    expect(secretary).toBeDefined();
  });

  it('should have id "builtin-secretary"', () => {
    expect(secretary!.id).toBe('builtin-secretary');
  });

  it('should have name "秘书"', () => {
    expect(secretary!.name).toBe('秘书');
  });

  it('should have category "admin"', () => {
    expect(secretary!.category).toBe('admin');
  });

  it('should have mode "secretary"', () => {
    expect(secretary!.mode).toBe('secretary');
  });

  it('should have is_builtin set to true', () => {
    expect(secretary!.is_builtin).toBe(true);
  });

  it('should have a non-empty system_prompt', () => {
    expect(secretary!.system_prompt).toBeDefined();
    expect(typeof secretary!.system_prompt).toBe('string');
    expect(secretary!.system_prompt.length).toBeGreaterThan(0);
  });
});
