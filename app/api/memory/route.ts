/**
 * Memory Management API
 *
 * GET  /api/memory — 获取所有记忆
 * PUT  /api/memory — 更新一条记忆 (body: { category, key, value })
 * DELETE /api/memory — 删除记忆 (query: ?category=xxx&key=xxx 删除单条, 无参数清空全部)
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */

import { NextRequest } from 'next/server';
import {
  loadMemory,
  saveMemory,
  upsertEntry,
  deleteEntry,
  clearAllEntries,
  type MemoryCategory,
} from '@/lib/services/secretary-memory';
import { createSuccessResponse, createErrorResponse } from '@/lib/utils/api-response';

const VALID_CATEGORIES: MemoryCategory[] = [
  'user_profile',
  'learned_preference',
  'interaction_pattern',
];

function isValidCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as MemoryCategory);
}

/**
 * GET /api/memory — 获取所有记忆
 * 返回: { success: true, data: MemoryData }
 *
 * Validates: Requirement 7.1
 */
export async function GET() {
  try {
    const memory = await loadMemory();
    return createSuccessResponse(memory);
  } catch (error) {
    console.error('[MemoryAPI] 获取记忆失败:', error);
    return createErrorResponse('获取记忆失败', undefined, 500);
  }
}

/**
 * PUT /api/memory — 更新一条记忆
 * Body: { category: MemoryCategory, key: string, value: string }
 * 返回: { success: true, data: MemoryData }
 *
 * Validates: Requirement 7.2
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const { category, key, value, confidence, channel } = body || {};

    // Validate category
    if (!isValidCategory(category)) {
      return createErrorResponse(
        '无效的记忆类别',
        `category 必须是以下之一: ${VALID_CATEGORIES.join(', ')}`,
        400,
      );
    }

    // Validate key
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return createErrorResponse('缺少记忆键名', 'key 不能为空', 400);
    }

    // Validate value
    if (!value || typeof value !== 'string' || value.trim() === '') {
      return createErrorResponse('缺少记忆值', 'value 不能为空', 400);
    }

    // Validate confidence (optional, must be number 0-1)
    if (confidence !== undefined && (typeof confidence !== 'number' || isNaN(confidence))) {
      return createErrorResponse('无效的置信度', 'confidence 必须是 0 到 1 之间的数值', 400);
    }

    // Validate channel (optional, must be non-empty string)
    if (channel !== undefined && (typeof channel !== 'string' || channel.trim() === '')) {
      return createErrorResponse('无效的渠道标识', 'channel 必须是非空字符串', 400);
    }

    const memory = await loadMemory();
    const updatedMemory = upsertEntry(memory, category, {
      key: key.trim(),
      value: value.trim(),
      source: '用户手动编辑',
      ...(confidence !== undefined ? { confidence: Math.min(1, Math.max(0, confidence)) } : {}),
      ...(channel && typeof channel === 'string' ? { channel: channel.trim() } : {}),
    });
    await saveMemory(updatedMemory);

    return createSuccessResponse(updatedMemory);
  } catch (error) {
    console.error('[MemoryAPI] 更新记忆失败:', error);
    return createErrorResponse('更新记忆失败', undefined, 500);
  }
}

/**
 * DELETE /api/memory — 删除记忆
 * Query: ?category=xxx&key=xxx (删除单条) 或无参数 (清空全部)
 * 返回: { success: true }
 *
 * Validates: Requirements 7.3, 7.4
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const key = searchParams.get('key');

    // If no params provided, clear all memory
    if (!category && !key) {
      const emptyMemory = clearAllEntries();
      await saveMemory(emptyMemory);
      return createSuccessResponse(null);
    }

    // If params are partially provided, return error
    if (!category || !key) {
      return createErrorResponse(
        '参数不完整',
        '删除单条记忆需要同时提供 category 和 key 参数',
        400,
      );
    }

    // Validate category
    if (!isValidCategory(category)) {
      return createErrorResponse(
        '无效的记忆类别',
        `category 必须是以下之一: ${VALID_CATEGORIES.join(', ')}`,
        400,
      );
    }

    const memory = await loadMemory();
    const updatedMemory = deleteEntry(memory, category, key);
    await saveMemory(updatedMemory);

    return createSuccessResponse(null);
  } catch (error) {
    console.error('[MemoryAPI] 删除记忆失败:', error);
    return createErrorResponse('删除记忆失败', undefined, 500);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
