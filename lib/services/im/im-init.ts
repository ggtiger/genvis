import { loadGlobalSettings } from '@/lib/services/settings';
import { STREAM_PLATFORMS, WEBHOOK_PLATFORMS } from './types';
import { connectionManager } from './connection-manager';

/**
 * 系统启动时调用，初始化所有 IM 渠道连接：
 * - 为已配置且启用的 Stream 平台建立长连接
 * - 验证 Webhook 平台配置完整性并记录日志
 */
export async function initIMChannels(): Promise<void> {
  console.log('[IM Init] 开始初始化 IM 渠道');
  const settings = await loadGlobalSettings();
  const imChannels = settings.im_channels;

  if (!imChannels) {
    console.log('[IM Init] 未找到 IM 渠道配置，跳过初始化');
    return;
  }

  // 启动 Stream 平台连接
  for (const platform of STREAM_PLATFORMS) {
    const config = imChannels[platform];
    if (config?.enabled) {
      try {
        console.log(`[IM Init] 正在连接 Stream 平台: ${platform}, appId=${config.appId?.substring(0, 10)}...`);
        await connectionManager.connect(platform, config);
        // 连接后立即检查 adapter 状态
        const statuses = connectionManager.getStatus();
        const platformStatus = statuses.find(s => s.platform === platform);
        console.log(`[IM Init] Stream 平台 ${platform} 连接已启动, 状态: ${platformStatus?.connectionStatus}`);
      } catch (error) {
        console.error(`[IM Init] Stream 平台 ${platform} 连接失败:`, error);
      }
    }
  }

  // 验证 Webhook 平台配置
  for (const platform of WEBHOOK_PLATFORMS) {
    const config = imChannels[platform];
    if (config?.enabled) {
      console.log(`[IM Init] Webhook 平台 ${platform} 配置已就绪`);
    }
  }

  // 启动健康检查，自动检测断线并重连
  connectionManager.startHealthCheck();
}
