import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IMChannelsSettings } from '../types';

// Mock dependencies
vi.mock('@/lib/services/settings', () => ({
  loadGlobalSettings: vi.fn(),
}));

vi.mock('../connection-manager', () => ({
  connectionManager: {
    connect: vi.fn(),
  },
}));

import { initIMChannels } from '../im-init';
import { loadGlobalSettings } from '@/lib/services/settings';
import { connectionManager } from '../connection-manager';

const mockLoadGlobalSettings = vi.mocked(loadGlobalSettings);
const mockConnect = vi.mocked(connectionManager.connect);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initIMChannels', () => {
  it('should skip initialization when no im_channels config exists', async () => {
    mockLoadGlobalSettings.mockResolvedValue({
      default_cli: 'claude',
      cli_settings: {},
    });

    await initIMChannels();

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('should connect enabled Stream platforms', async () => {
    const dingtalkConfig = {
      enabled: true,
      receiveMode: 'stream' as const,
      appId: 'dt-app',
      appSecret: 'dt-secret',
      token: 'dt-token',
    };
    const feishuConfig = {
      enabled: true,
      receiveMode: 'stream' as const,
      appId: 'fs-app',
      appSecret: 'fs-secret',
      token: 'fs-token',
    };

    mockLoadGlobalSettings.mockResolvedValue({
      default_cli: 'claude',
      cli_settings: {},
      im_channels: {
        dingtalk: dingtalkConfig,
        feishu: feishuConfig,
      },
    });
    mockConnect.mockResolvedValue(undefined);

    await initIMChannels();

    expect(mockConnect).toHaveBeenCalledWith('dingtalk', dingtalkConfig);
    expect(mockConnect).toHaveBeenCalledWith('feishu', feishuConfig);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('should skip disabled Stream platforms', async () => {
    mockLoadGlobalSettings.mockResolvedValue({
      default_cli: 'claude',
      cli_settings: {},
      im_channels: {
        dingtalk: {
          enabled: false,
          receiveMode: 'stream',
          appId: 'dt-app',
          appSecret: 'dt-secret',
          token: 'dt-token',
        },
      },
    });

    await initIMChannels();

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('should not call connect for Webhook platforms', async () => {
    mockLoadGlobalSettings.mockResolvedValue({
      default_cli: 'claude',
      cli_settings: {},
      im_channels: {
        wechat: {
          enabled: true,
          receiveMode: 'webhook',
          appId: 'wx-app',
          appSecret: 'wx-secret',
          token: 'wx-token',
        },
        wecom: {
          enabled: true,
          receiveMode: 'webhook',
          appId: 'wc-app',
          appSecret: 'wc-secret',
          token: 'wc-token',
        },
      },
    });

    await initIMChannels();

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('should continue initializing other platforms if one Stream platform fails', async () => {
    const dingtalkConfig = {
      enabled: true,
      receiveMode: 'stream' as const,
      appId: 'dt-app',
      appSecret: 'dt-secret',
      token: 'dt-token',
    };
    const feishuConfig = {
      enabled: true,
      receiveMode: 'stream' as const,
      appId: 'fs-app',
      appSecret: 'fs-secret',
      token: 'fs-token',
    };

    mockLoadGlobalSettings.mockResolvedValue({
      default_cli: 'claude',
      cli_settings: {},
      im_channels: {
        dingtalk: dingtalkConfig,
        feishu: feishuConfig,
      },
    });
    mockConnect
      .mockRejectedValueOnce(new Error('Connection failed'))
      .mockResolvedValueOnce(undefined);

    await initIMChannels();

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockConnect).toHaveBeenCalledWith('dingtalk', dingtalkConfig);
    expect(mockConnect).toHaveBeenCalledWith('feishu', feishuConfig);
  });

  it('should handle mixed Stream and Webhook platforms correctly', async () => {
    const dingtalkConfig = {
      enabled: true,
      receiveMode: 'stream' as const,
      appId: 'dt-app',
      appSecret: 'dt-secret',
      token: 'dt-token',
    };

    mockLoadGlobalSettings.mockResolvedValue({
      default_cli: 'claude',
      cli_settings: {},
      im_channels: {
        dingtalk: dingtalkConfig,
        wechat: {
          enabled: true,
          receiveMode: 'webhook',
          appId: 'wx-app',
          appSecret: 'wx-secret',
          token: 'wx-token',
        },
      },
    });
    mockConnect.mockResolvedValue(undefined);

    await initIMChannels();

    // Only Stream platform should trigger connect
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith('dingtalk', dingtalkConfig);
  });
});
