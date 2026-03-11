import type { MessageMetadata } from '@/types/backend';

export type MessageRole = 'assistant' | 'user' | 'system' | 'tool';

export type MessageKind = 'chat' | 'tool_use' | 'error' | 'info' | 'permission' | string;

export interface RealtimeMessage {
  id: string;
  projectId?: string;
  role: MessageRole;
  messageType: MessageKind;
  content: string;
  metadata?: MessageMetadata | null;
  parentMessageId?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  cliSource?: string | null;
  requestId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isStreaming?: boolean;
  isFinal?: boolean;
  isOptimistic?: boolean; // Flag for optimistically added messages (not yet confirmed by server)
  isDemo?: boolean; // Flag for demo mode messages
}

export type PreviewPhase =
  | 'idle'
  | 'sdk_running'
  | 'sdk_completed'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error';

export type PreviewErrorType =
  | 'dependency'    // npm install 相关
  | 'build'         // 编译/构建错误
  | 'runtime'       // 运行时错误
  | 'network'       // 网络连接错误
  | 'port'          // 端口冲突
  | 'structure'     // 项目结构不符合要求
  | 'unknown';

export interface RealtimeStatus {
  status: string;
  message?: string;
  sessionId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  phase?: PreviewPhase;
  errorType?: PreviewErrorType;
  suggestion?: string;
  planMd?: string;
  deployedUrl?: string; // 演示模式：已部署的 URL
}

export type StreamTransport = 'sse' | 'websocket';

export interface ConnectionInfo {
  projectId: string;
  timestamp: string;
  sessionId?: string;
  transport?: StreamTransport;
  connectionStage?: 'handshake' | 'assistant';
}

export interface HeartbeatInfo {
  timestamp: string;
}

export interface PreviewEventInfo {
  message: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface LogEventInfo {
  level: 'stdout' | 'stderr' | 'info' | 'error' | 'warn';
  content: string;
  source: 'preview' | 'cli' | 'build' | 'system';
  projectId: string;
  timestamp?: string;
  phase?: PreviewPhase;
  errorType?: PreviewErrorType;
  suggestion?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskEventInfo {
  projectId: string;
  requestId?: string;
  timestamp: string;
  message: string;
  error?: string;
}

export interface FileChangeInfo {
  type: 'write' | 'edit';
  filePath: string;
  content?: string;       // Write 操作的完整内容
  oldString?: string;     // Edit 操作的旧内容
  newString?: string;     // Edit 操作的新内容
  timestamp: string;
  requestId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ModelUsageDetail {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

export interface ConversationStatsInfo {
  projectId: string;
  requestId?: string;
  timestamp: string;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  usage?: TokenUsage;
  modelUsage?: Record<string, ModelUsageDetail>;
  num_turns?: number;
}

export interface PermissionRequestInfo {
  id: string;
  projectId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  inputPreview: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  timestamp: string;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionInfo {
  projectId: string;
  requestId?: string;
  toolUseId: string;
  questions: AskUserQuestionItem[];
  timestamp: string;
}

export type RealtimeEvent =
  | { type: 'message'; data: RealtimeMessage }
  | { type: 'status'; data: RealtimeStatus }
  | { type: 'error'; error: string; data?: unknown }
  | { type: 'connected'; data: ConnectionInfo }
  | { type: 'heartbeat'; data: HeartbeatInfo }
  | { type: 'preview_installing'; data: RealtimeStatus }
  | { type: 'preview_starting'; data: RealtimeStatus }
  | { type: 'preview_ready'; data: RealtimeStatus }
  | { type: 'preview_status'; data: RealtimeStatus }
  | { type: 'preview_error'; data: PreviewEventInfo }
  | { type: 'preview_success'; data: PreviewEventInfo }
  | { type: 'sdk_completed'; data: RealtimeStatus }
  | { type: 'log'; data: LogEventInfo }
  | { type: 'request_status'; data: { hasActiveRequests: boolean; activeCount: number } }
  | { type: 'task_started'; data: TaskEventInfo }
  | { type: 'task_completed'; data: TaskEventInfo }
  | { type: 'task_interrupted'; data: TaskEventInfo }
  | { type: 'task_error'; data: TaskEventInfo }
  | { type: 'file_change'; data: FileChangeInfo }
  | { type: 'conversation_stats'; data: ConversationStatsInfo }
  | { type: 'permission_request'; data: PermissionRequestInfo }
  | { type: 'ask_user_question'; data: AskUserQuestionInfo };
