import fs from 'fs/promises';
import path from 'path';
import { getDefaultModelForCli, normalizeModelId } from '@/lib/constants/cliModels';
import type { AIServicesConfig } from '@/lib/config/prompts/ai-services';
import type { IMChannelsSettings, IMChannelConfig, IMPlatform } from './im/types';
import type { LanPeerSettings } from './lan-peer/types';

const DATA_DIR = process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'global-settings.json');

export type CLISettings = Record<string, Record<string, unknown>>;

export interface GlobalSettings {
  default_cli: string;
  cli_settings: CLISettings;
  ai_services?: AIServicesConfig;
  server?: {
    allow_remote_access: boolean;
  };
  theme?: 'light' | 'dark';
  im_channels?: IMChannelsSettings;
  lan_peer?: LanPeerSettings;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  default_cli: 'claude',
  cli_settings: {
    claude: {
      model: getDefaultModelForCli('claude'),
    },
    codex: {
      model: getDefaultModelForCli('codex'),
    },
    cursor: {
      model: getDefaultModelForCli('cursor'),
    },
    qwen: {
      model: getDefaultModelForCli('qwen'),
    },
    glm: {
      model: getDefaultModelForCli('glm'),
    },
  },
};

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readSettingsFile(): Promise<GlobalSettings | null> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as GlobalSettings;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const defaultCli = typeof parsed.default_cli === 'string'
      ? parsed.default_cli
      : DEFAULT_SETTINGS.default_cli;

    const cliSettings =
      typeof parsed.cli_settings === 'object' && parsed.cli_settings !== null
        ? parsed.cli_settings
        : {};

    // Parse ai_services if present
    const aiServices = parsed.ai_services && typeof parsed.ai_services === 'object'
      ? parsed.ai_services
      : undefined;

    // Parse server config if present
    const server = parsed.server && typeof parsed.server === 'object'
      ? parsed.server
      : undefined;

    // Parse theme if present
    const theme = parsed.theme === 'light' || parsed.theme === 'dark'
      ? parsed.theme
      : undefined;

    // Parse im_channels if present
    const imChannels = parsed.im_channels && typeof parsed.im_channels === 'object'
      ? parsed.im_channels
      : undefined;

    // Parse lan_peer if present
    const lanPeer = parsed.lan_peer && typeof parsed.lan_peer === 'object'
      ? parsed.lan_peer
      : undefined;

    return {
      default_cli: typeof parsed.default_cli === 'string' ? parsed.default_cli : DEFAULT_SETTINGS.default_cli,
      cli_settings: {
        ...DEFAULT_SETTINGS.cli_settings,
        ...cliSettings,
      },
      ai_services: aiServices,
      server,
      theme,
      im_channels: imChannels,
      lan_peer: lanPeer,
    };
  } catch (error) {
    return null;
  }
}

async function writeSettings(settings: GlobalSettings): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  const existing = await readSettingsFile();
  if (existing) {
    const merged: GlobalSettings = {
      default_cli: existing.default_cli ?? DEFAULT_SETTINGS.default_cli,
      cli_settings: {
        ...DEFAULT_SETTINGS.cli_settings,
        ...(existing.cli_settings ?? {}),
      },
      ai_services: existing.ai_services,
      server: existing.server,
      theme: existing.theme,
      im_channels: existing.im_channels,
      lan_peer: existing.lan_peer,
    };
    return merged;
  }

  await writeSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export function normalizeCliSettings(settings: unknown): CLISettings | undefined {
  if (!settings || typeof settings !== 'object') {
    return undefined;
  }

  const normalized: CLISettings = {};
  for (const [cli, config] of Object.entries(settings)) {
    if (config && typeof config === 'object') {
      normalized[cli] = {
        ...(config as Record<string, unknown>),
      };
      const model = normalized[cli].model as string | undefined;
      if (model) {
        normalized[cli].model = normalizeModelId(cli, model);
      }
    }
  }
  return normalized;
}

export async function updateGlobalSettings(partial: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const current = await loadGlobalSettings();

  const cliSettings = normalizeCliSettings(partial.cli_settings);

  const next: GlobalSettings = {
    default_cli: partial.default_cli ?? current.default_cli,
    cli_settings: { ...current.cli_settings },
    ai_services: partial.ai_services !== undefined ? partial.ai_services : current.ai_services,
    server: partial.server !== undefined ? partial.server : current.server,
    theme: partial.theme !== undefined ? partial.theme : current.theme,
    im_channels: partial.im_channels !== undefined ? partial.im_channels : current.im_channels,
    lan_peer: partial.lan_peer !== undefined ? partial.lan_peer : current.lan_peer,
  };

  if (cliSettings) {
    for (const [cli, config] of Object.entries(cliSettings)) {
      // Use replace strategy instead of merge to ensure deleted fields are removed
      next.cli_settings[cli] = config;
    }
  }

  await writeSettings(next);
  return next;
}

export async function loadChannelConfig(platform: IMPlatform): Promise<IMChannelConfig | undefined> {
  const settings = await loadGlobalSettings();
  return settings.im_channels?.[platform];
}

export async function saveChannelConfig(platform: IMPlatform, config: IMChannelConfig): Promise<void> {
  const current = await loadGlobalSettings();
  const imChannels: IMChannelsSettings = { ...current.im_channels, [platform]: config };
  await updateGlobalSettings({ im_channels: imChannels });
}

