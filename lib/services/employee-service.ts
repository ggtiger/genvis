/**
 * Employee Service - Manage digital employees
 *
 * Architecture:
 * - Builtin employees: read-only, shipped with app (builtin/employees.json)
 * - User employees: read-write, stored in user data directory
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {
  BUILTIN_EMPLOYEES_PATH,
  getUserEmployeesPath,
} from '@/lib/config/paths';
import type {
  Employee,
  CreateEmployeeInput,
  UpdateEmployeeInput,
  EmployeeCategoryConfig,
} from '@/types/backend/employee';

/**
 * Employee data structure in JSON file
 */
interface EmployeesData {
  categories: EmployeeCategoryConfig[];
  employees: Employee[];
}

/**
 * Cached categories from builtin file
 */
let cachedCategories: EmployeeCategoryConfig[] | null = null;

/**
 * Builtin employee overrides storage path
 */
function getBuiltinOverridesPath(): string {
  const userPath = getUserEmployeesPath();
  return userPath.replace('user-employees.json', 'builtin-overrides.json');
}

/**
 * Load builtin employee overrides
 */
async function loadBuiltinOverrides(): Promise<Record<string, Partial<Employee>>> {
  const filePath = getBuiltinOverridesPath();
  try {
    if (!fsSync.existsSync(filePath)) {
      return {};
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save builtin employee overrides
 */
async function saveBuiltinOverrides(overrides: Record<string, Partial<Employee>>): Promise<void> {
  const filePath = getBuiltinOverridesPath();
  const dir = path.dirname(filePath);
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(filePath, JSON.stringify(overrides, null, 2), 'utf-8');
}

/**
 * Load builtin employees data (read-only base + user overrides)
 */
async function loadBuiltinEmployeesData(): Promise<EmployeesData> {
  try {
    const content = await fs.readFile(BUILTIN_EMPLOYEES_PATH, 'utf-8');
    const data = JSON.parse(content) as EmployeesData;
    // Cache categories from builtin
    cachedCategories = data.categories || [];

    // Load user overrides for builtin employees
    const overrides = await loadBuiltinOverrides();

    // Merge overrides into builtin employees
    const employees = (data.employees || []).map(e => ({
      ...e,
      ...overrides[e.id],
      is_builtin: true,
    }));

    return {
      categories: data.categories || [],
      employees,
    };
  } catch (error) {
    console.error('[EmployeeService] Error loading builtin employees:', error);
    return { categories: [], employees: [] };
  }
}

/**
 * Load user employees data (read-write)
 */
async function loadUserEmployeesData(): Promise<Employee[]> {
  const filePath = getUserEmployeesPath();
  try {
    if (!fsSync.existsSync(filePath)) {
      return [];
    }
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as { employees: Employee[] };
    return (data.employees || []).map(e => ({ ...e, is_builtin: false }));
  } catch (error) {
    console.error('[EmployeeService] Error loading user employees:', error);
    return [];
  }
}

/**
 * Save user employees to file
 */
async function saveUserEmployees(employees: Employee[]): Promise<void> {
  const filePath = getUserEmployeesPath();
  const dir = path.dirname(filePath);

  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }

  const data = { employees };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Generate unique employee ID
 */
function generateId(): string {
  return `emp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Get all employees (builtin + user)
 * User employees with same ID will NOT override builtin (they have different ID patterns)
 */
export async function getAllEmployees(): Promise<Employee[]> {
  const builtinData = await loadBuiltinEmployeesData();
  const userEmployees = await loadUserEmployeesData();

  // Merge: builtin first, then user
  return [...builtinData.employees, ...userEmployees];
}

/**
 * Get employee by ID
 */
export async function getEmployeeById(id: string): Promise<Employee | null> {
  const employees = await getAllEmployees();
  return employees.find((e) => e.id === id) || null;
}

/**
 * Create new employee (always creates in user storage)
 */
export async function createEmployee(
  input: CreateEmployeeInput
): Promise<Employee> {
  const userEmployees = await loadUserEmployeesData();

  const now = new Date().toISOString();
  const newEmployee: Employee = {
    id: generateId(),
    name: input.name,
    description: input.description,
    avatar: input.avatar,
    category: input.category,
    mode: input.mode,
    first_prompt: input.first_prompt,
    system_prompt: input.system_prompt,
    system_prompt_plan: input.system_prompt_plan,
    system_prompt_execution: input.system_prompt_execution,
    is_builtin: false,
    created_at: now,
    updated_at: now,
  };

  userEmployees.push(newEmployee);
  await saveUserEmployees(userEmployees);

  return newEmployee;
}

/**
 * Update employee
 * - Builtin employees: can only modify prompts (stored as overrides)
 * - User employees: can be fully modified
 */
export async function updateEmployee(
  id: string,
  input: UpdateEmployeeInput
): Promise<Employee | null> {
  // Check if it's a builtin employee
  const builtinData = await loadBuiltinEmployeesData();
  const builtinEmployee = builtinData.employees.find(e => e.id === id);

  if (builtinEmployee) {
    // Builtin employees: only allow prompt overrides
    const overrides = await loadBuiltinOverrides();
    overrides[id] = {
      ...overrides[id],
      avatar: input.avatar ?? overrides[id]?.avatar,
      first_prompt: input.first_prompt ?? overrides[id]?.first_prompt,
      system_prompt: input.system_prompt ?? overrides[id]?.system_prompt,
      system_prompt_plan: input.system_prompt_plan ?? overrides[id]?.system_prompt_plan,
      system_prompt_execution: input.system_prompt_execution ?? overrides[id]?.system_prompt_execution,
    };
    await saveBuiltinOverrides(overrides);

    // Return merged employee
    return {
      ...builtinEmployee,
      ...overrides[id],
      updated_at: new Date().toISOString(),
    };
  }

  // Update in user employees
  const userEmployees = await loadUserEmployeesData();
  const index = userEmployees.findIndex((e) => e.id === id);

  if (index === -1) {
    return null;
  }

  const existing = userEmployees[index];
  const updated: Employee = {
    ...existing,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    avatar: input.avatar ?? existing.avatar,
    category: input.category ?? existing.category,
    mode: input.mode ?? existing.mode,
    first_prompt: input.first_prompt ?? existing.first_prompt,
    system_prompt: input.system_prompt ?? existing.system_prompt,
    system_prompt_plan: input.system_prompt_plan ?? existing.system_prompt_plan,
    system_prompt_execution:
      input.system_prompt_execution ?? existing.system_prompt_execution,
    updated_at: new Date().toISOString(),
  };

  userEmployees[index] = updated;
  await saveUserEmployees(userEmployees);

  return updated;
}

/**
 * Delete employee (builtin employees cannot be deleted)
 */
export async function deleteEmployee(id: string): Promise<boolean> {
  // Check if it's a builtin employee
  const builtinData = await loadBuiltinEmployeesData();
  const isBuiltin = builtinData.employees.some(e => e.id === id);

  if (isBuiltin) {
    throw new Error('Cannot delete builtin employee');
  }

  // Delete from user employees
  const userEmployees = await loadUserEmployeesData();
  const employee = userEmployees.find((e) => e.id === id);

  if (!employee) {
    throw new Error(`Employee not found: ${id}`);
  }

  const filtered = userEmployees.filter((e) => e.id !== id);
  await saveUserEmployees(filtered);

  return true;
}

/**
 * Get employee prompts for Claude service
 * Returns the actual prompt content or prompt key for DEFAULT_PROMPTS
 */
export async function getEmployeePrompts(employeeId: string): Promise<{
  mode: 'code' | 'work' | 'secretary';
  systemPrompt?: string;
  planPrompt?: string;
  executionPrompt?: string;
} | null> {
  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    return null;
  }

  if (employee.mode === 'work') {
    return {
      mode: 'work',
      systemPrompt: employee.system_prompt,
    };
  }

  if (employee.mode === 'secretary') {
    return {
      mode: 'secretary',
      systemPrompt: employee.system_prompt,
    };
  }

  return {
    mode: 'code',
    planPrompt: employee.system_prompt_plan,
    executionPrompt: employee.system_prompt_execution,
  };
}

/**
 * Get employee categories configuration
 */
export async function getEmployeeCategories(): Promise<EmployeeCategoryConfig[]> {
  if (cachedCategories) {
    return cachedCategories;
  }
  const data = await loadBuiltinEmployeesData();
  return data.categories;
}
