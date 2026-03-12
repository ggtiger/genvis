/**
 * GET /api/projects/recent - Get recent projects for sidebar
 * Optimized query with LIMIT 5 to avoid loading all projects
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export async function GET() {
  try {
    // Only fetch the 5 most recent projects - much faster than loading all
    const recentProjects = await db.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      lastActiveAt: projects.lastActiveAt,
      previewUrl: projects.previewUrl,
      previewPort: projects.previewPort,
      dependenciesInstalled: projects.dependenciesInstalled,
    })
    .from(projects)
    .orderBy(desc(projects.lastActiveAt))
    .limit(5);

    return NextResponse.json({
      success: true,
      data: recentProjects,
    });
  } catch (error: any) {
    console.error('[API] Error fetching recent projects:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch recent projects' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
