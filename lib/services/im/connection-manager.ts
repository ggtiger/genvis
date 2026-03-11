import type { StreamAdapter } from './adapter';
import type { IMChannelConfig, IMPlatform, ConnectionStatus, ChannelStatus } from './types';
import { STREAM_PLATFORMS } from './types';
import { getStreamAdapter } from './adapter-factory';
import { processIMMessage } from './im-channel';

/** 重连配置 */
interface ReconnectConfig {
  initialDelay: number;  // 1000ms
  maxDelay: number;      // 60000ms
  maxRetries: number;    // 5
}

/** 单个平台的连接状态 */
interface PlatformConnection {
  adapter: StreamAdapter;
  config: IMChannelConfig;
  status: ConnectionStatus;
  retryCount: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  lastConnectedAt?: Date;
  lastError?: string;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialDelay: 1000,
  maxDelay: 60000,
  maxRetries: 5,
};

export class ConnectionManager {
  private connections: Map<IMPlatform, PlatformConnection> = new Map();
  private statusListeners: Set<(status: ChannelStatus) => void> = new Set();
  private reconnectConfig: ReconnectConfig;
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  constructor(reconnectConfig?: Partial<ReconnectConfig>) {
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
  }

  /** 启动所有已配置的 Stream 平台连接 */
  async startAll(configs: Map<IMPlatform, IMChannelConfig>): Promise<void> {
    const connectPromises: Promise<void>[] = [];
    for (const [platform, config] of configs) {
      if (STREAM_PLATFORMS.includes(platform) && config.enabled) {
        connectPromises.push(this.connect(platform, config));
      }
    }
    await Promise.allSettled(connectPromises);
  }

  /** 启动单个平台连接 */
  async connect(platform: IMPlatform, config: IMChannelConfig): Promise<void> {
    // 如果已有连接，先断开
    if (this.connections.has(platform)) {
      await this.disconnect(platform);
    }

    const adapter = await getStreamAdapter(platform);
    const connection: PlatformConnection = {
      adapter,
      config,
      status: 'disconnected',
      retryCount: 0,
    };
    this.connections.set(platform, connection);

    this.updateStatus(platform, 'connecting');

    try {
      await adapter.connect(config, async (msg) => {
        // 将收到的消息交给 im-channel 处理
        await processIMMessage(msg, adapter, config);
      });
      this.updateStatus(platform, 'connected');
      connection.retryCount = 0;
      connection.lastConnectedAt = new Date();
      connection.lastError = undefined;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      connection.lastError = errorMsg;
      this.handleDisconnect(platform);
    }
  }

  /** 优雅关闭单个平台连接 */
  async disconnect(platform: IMPlatform): Promise<void> {
    const connection = this.connections.get(platform);
    if (!connection) return;

    // 清除重连定时器
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = undefined;
    }

    try {
      await connection.adapter.disconnect();
    } catch {
      // 忽略断开时的错误
    }

    this.updateStatus(platform, 'disconnected');
    connection.retryCount = 0;
    this.connections.delete(platform);
  }

  /** 优雅关闭所有连接 */
  async disconnectAll(): Promise<void> {
    const platforms = Array.from(this.connections.keys());
    await Promise.allSettled(platforms.map((p) => this.disconnect(p)));
  }

  /** 使用新凭证重新连接 */
  async reconnect(platform: IMPlatform, newConfig: IMChannelConfig): Promise<void> {
    await this.disconnect(platform);
    await this.connect(platform, newConfig);
  }

  /** 获取所有渠道状态（使用 adapter 实时状态） */
  getStatus(): ChannelStatus[] {
    const statuses: ChannelStatus[] = [];

    for (const platform of STREAM_PLATFORMS) {
      const connection = this.connections.get(platform);
      if (connection) {
        // 用 adapter 的实时连接状态，而不是缓存的 connection.status
        const realConnected = connection.adapter.isConnected();
        // 如果 adapter 报告断开但我们还认为是 connected 或已放弃(error)，触发异步重连
        if (!realConnected && (connection.status === 'connected' || connection.status === 'error')) {
          console.warn(`[ConnectionManager] ${platform} getStatus 检测到连接已断开 (was ${connection.status})，触发重连`);
          this.triggerReconnect(platform, connection);
        }
        const effectiveStatus = realConnected ? 'connected' : 
          (connection.status === 'connected' ? 'reconnecting' : connection.status);
        statuses.push({
          platform,
          receiveMode: 'stream',
          connectionStatus: effectiveStatus,
          configured: true,
          lastConnectedAt: connection.lastConnectedAt?.toISOString(),
          lastError: connection.lastError,
        });
      } else {
        statuses.push({
          platform,
          receiveMode: 'stream',
          connectionStatus: 'disconnected',
          configured: false,
        });
      }
    }

    return statuses;
  }

  /** 获取单个平台状态 */
  getPlatformStatus(platform: IMPlatform): ChannelStatus | undefined {
    const connection = this.connections.get(platform);
    if (!connection) return undefined;

    return {
      platform,
      receiveMode: 'stream',
      connectionStatus: connection.status,
      configured: true,
      lastConnectedAt: connection.lastConnectedAt?.toISOString(),
      lastError: connection.lastError,
    };
  }

  /** 注册状态变更监听器，返回取消注册函数 */
  onStatusChange(listener: (status: ChannelStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** 内部：处理连接断开，触发指数退避重连 */
  private handleDisconnect(platform: IMPlatform): void {
    const connection = this.connections.get(platform);
    if (!connection) return;

    connection.retryCount++;

    if (connection.retryCount > this.reconnectConfig.maxRetries) {
      // 连续失败超过上限，标记为 error
      this.updateStatus(platform, 'error');
      return;
    }

    this.updateStatus(platform, 'reconnecting');

    const delay = this.getReconnectDelay(connection.retryCount - 1);
    connection.reconnectTimer = setTimeout(async () => {
      try {
        this.updateStatus(platform, 'connecting');
        await connection.adapter.connect(connection.config, async (msg) => {
          await processIMMessage(msg, connection.adapter, connection.config);
        });
        this.updateStatus(platform, 'connected');
        connection.retryCount = 0;
        connection.lastConnectedAt = new Date();
        connection.lastError = undefined;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        connection.lastError = errorMsg;
        this.handleDisconnect(platform);
      }
    }, delay);
  }

  /** 计算重连延迟（指数退避）: min(initialDelay × 2^retryCount, maxDelay) */
  getReconnectDelay(retryCount: number): number {
    const delay = this.reconnectConfig.initialDelay * Math.pow(2, retryCount);
    return Math.min(delay, this.reconnectConfig.maxDelay);
  }

  /** 内部：更新状态并通知所有监听器 */
  private updateStatus(platform: IMPlatform, status: ConnectionStatus): void {
    const connection = this.connections.get(platform);
    if (connection) {
      connection.status = status;
    }

    const channelStatus: ChannelStatus = {
      platform,
      receiveMode: 'stream',
      connectionStatus: status,
      configured: !!connection,
      lastConnectedAt: connection?.lastConnectedAt?.toISOString(),
      lastError: connection?.lastError,
    };

    for (const listener of this.statusListeners) {
      try {
        listener(channelStatus);
      } catch {
        // 监听器异常不影响其他监听器
      }
    }
  }

  /** 启动健康检查定时器（15 秒一次），检测断线并自动重连 */
  startHealthCheck(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 15_000);
    console.log('[ConnectionManager] 健康检查已启动 (15s 间隔)');
  }

  /** 停止健康检查 */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /** 触发异步重连（防止重复触发） */
  private triggerReconnect(platform: IMPlatform, connection: PlatformConnection): void {
    // 如果已经在重连中，不重复触发
    if (connection.status === 'reconnecting' || connection.status === 'connecting') return;
    connection.retryCount = 0;
    this.updateStatus(platform, 'reconnecting');
    // 异步执行重连，不阻塞 getStatus 调用
    (async () => {
      try {
        await connection.adapter.disconnect().catch(() => {});
        await connection.adapter.connect(connection.config, async (msg) => {
          await processIMMessage(msg, connection.adapter, connection.config);
        });
        this.updateStatus(platform, 'connected');
        connection.lastConnectedAt = new Date();
        connection.lastError = undefined;
        console.log(`[ConnectionManager] ${platform} 重连成功`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        connection.lastError = errorMsg;
        console.error(`[ConnectionManager] ${platform} 重连失败:`, errorMsg);
        this.handleDisconnect(platform);
      }
    })();
  }

  /** 检查所有连接的健康状态，断线的自动重连 */
  private async checkHealth(): Promise<void> {
    for (const [platform, connection] of this.connections) {
      const alive = connection.adapter.isConnected();
      if (!alive && connection.status === 'connected') {
        // 刚检测到断开
        console.warn(`[ConnectionManager] ${platform} 健康检查发现连接已断开，尝试重连...`);
        this.triggerReconnect(platform, connection);
      } else if (!alive && connection.status === 'error') {
        // 之前重试耗尽进入 error 状态，健康检查继续尝试（网络可能已恢复）
        console.warn(`[ConnectionManager] ${platform} 处于 error 状态，健康检查重新尝试连接...`);
        this.triggerReconnect(platform, connection);
      }
    }
  }
}

/** 全局单例（挂载到 globalThis 防止 Next.js HMR 重建丢失连接状态） */
const globalKey = '__im_connection_manager__';
export const connectionManager: ConnectionManager =
  (globalThis as any)[globalKey] ??
  ((globalThis as any)[globalKey] = new ConnectionManager());
