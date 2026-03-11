import { NextRequest, NextResponse } from 'next/server';
import {
  loadGlobalSettings,
  updateGlobalSettings,
  normalizeCliSettings,
} from '@/lib/services/settings';
import type { AIServicesConfig } from '@/lib/config/prompts/ai-services';

function serialize(settings: Awaited<ReturnType<typeof loadGlobalSettings>>) {
  return {
    ...settings,
    defaultCli: settings.default_cli,
    cliSettings: settings.cli_settings,
  };
}

export async function GET() {
  const settings = await loadGlobalSettings();
  return NextResponse.json(serialize(settings));
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const candidate = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

    const update: Record<string, unknown> = {};

    const defaultCli = candidate.default_cli ?? candidate.defaultCli;
    if (typeof defaultCli === 'string') {
      update.default_cli = defaultCli;
    }

    const cliSettingsRaw = candidate.cli_settings ?? candidate.cliSettings;
    const cliSettings = normalizeCliSettings(cliSettingsRaw as Record<string, unknown> | undefined);
    if (cliSettings) {
      update.cli_settings = cliSettings;
    }

    // Handle ai_services update
    const aiServicesRaw = candidate.ai_services;
    if (aiServicesRaw && typeof aiServicesRaw === 'object') {
      // Merge with existing ai_services
      const current = await loadGlobalSettings();
      const currentAiServices = current.ai_services || {};
      const newAiServices = aiServicesRaw as Partial<AIServicesConfig>;

      update.ai_services = {
        ...currentAiServices,
        ...newAiServices,
      };
    }

    // Handle server config update
    const serverRaw = candidate.server;
    if (serverRaw !== undefined) {
      if (serverRaw && typeof serverRaw === 'object') {
        update.server = serverRaw;
      } else if (serverRaw === null) {
        update.server = undefined;
      }
    }

    // Handle theme update
    const themeRaw = candidate.theme;
    if (themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'spring') {
      update.theme = themeRaw;
    }

    // Handle lan_peer update
    const lanPeerRaw = candidate.lan_peer;
    if (lanPeerRaw && typeof lanPeerRaw === 'object') {
      update.lan_peer = lanPeerRaw;
    }

    const nextSettings = await updateGlobalSettings(update);
    return NextResponse.json(serialize(nextSettings));
  } catch (error) {
    console.error('[API] Failed to update global settings:', error);
    return NextResponse.json(
      {
        error: 'Failed to update global settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
