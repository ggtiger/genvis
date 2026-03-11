/**
 * POST /api/permissions/confirm
 * Confirm or deny a permission request
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePermission, getPermissionById } from '@/lib/services/permissions';
import { createMessage } from '@/lib/services/message';
import { streamManager } from '@/lib/services/stream';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { permissionId, approved } = body;

    if (!permissionId) {
      return NextResponse.json(
        { success: false, error: 'permissionId is required' },
        { status: 400 }
      );
    }

    if (typeof approved !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'approved must be a boolean' },
        { status: 400 }
      );
    }

    const permission = getPermissionById(permissionId);
    if (!permission) {
      return NextResponse.json(
        { success: false, error: 'Permission not found' },
        { status: 404 }
      );
    }

    if (permission.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Permission already ${permission.status}` },
        { status: 400 }
      );
    }

    const resolved = resolvePermission(permissionId, approved);

    if (!resolved) {
      return NextResponse.json(
        { success: false, error: 'Failed to resolve permission' },
        { status: 500 }
      );
    }

    // Save permission decision to message history
    try {
      const status = approved ? 'approved' : 'denied';
      await createMessage({
        id: `perm-${permissionId}`,
        projectId: permission.projectId,
        role: 'system',
        messageType: 'permission',
        content: `${permission.toolName}: ${status}`,
        metadata: {
          permissionId: permission.id,
          toolName: permission.toolName,
          toolInput: permission.toolInput,
          inputPreview: permission.inputPreview,
          status,
          createdAt: permission.createdAt,
          resolvedAt: Date.now(),
        },
        requestId: permission.requestId,
      });
    } catch (msgError) {
      // Log but don't fail the request if message saving fails
      console.error('[API] Failed to save permission message:', msgError);
    }

    // Broadcast permission resolved event to all windows
    try {
      streamManager.publish(permission.projectId, {
        type: 'status',
        data: {
          status: 'permission_resolved',
          requestId: permission.requestId,
          metadata: {
            permissionId,
            approved,
            toolName: permission.toolName,
          },
        },
      });
    } catch (broadcastError) {
      console.error('[API] Failed to broadcast permission resolved:', broadcastError);
    }

    return NextResponse.json({
      success: true,
      data: {
        permissionId,
        status: approved ? 'approved' : 'denied',
      },
    });
  } catch (error) {
    console.error('[API] Failed to confirm permission:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to confirm permission',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
