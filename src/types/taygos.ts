export type Language = 'ar' | 'en';

export type ProviderCategory = 'llm' | 'image' | 'video' | 'audio' | 'documents';

export type ImageSpecialty = 'all' | 'bg_removal' | 'bg_edit' | 'generate';

export type ProviderAdapter =
  | 'gemini'
  | 'openai-compatible'
  | 'anthropic'
  | 'custom-rest'
  | 'sandbox-simulator';

export type SimulatorBehavior =
  | 'healthy'
  | 'rate_limit_429'
  | 'server_error_503'
  | 'latency_spike';

export type RoutingStrategy =
  | 'priority_failover'
  | 'round_robin'
  | 'lowest_latency';

export type KeyStatus = 'active' | 'revoked';

export type ProviderHealth =
  | 'healthy'
  | 'degraded'
  | 'circuit_open'
  | 'needs_key';

export interface AccessKeyPublicView {
  id: string;
  name: string;
  description: string;
  publicKey: string;
  secretMasked: string;
  perpetual: boolean;
  expiresAt: string | null;
  scopes: string[];
  requireHmac: boolean;
  hmacReady: boolean;
  status: KeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  failoverCount: number;
}

export interface UpstreamProviderPublicView {
  id: string;
  slug?: string;
  name: string;
  category?: ProviderCategory;
  specialty?: string;
  adapter: ProviderAdapter;
  baseUrl: string;
  apiKeyUrl?: string;
  model: string;
  authHeader: string;
  apiKeyMasked: string;
  usesServerEnv: boolean;
  requiresApiKey: boolean;
  keyConfigured: boolean;
  freeModelsCount?: number;
  maxContext?: number;
  tagline?: string;
  verifiedProtocols?: string[];
  priority: number;
  weight: number;
  timeoutMs: number;
  enabled: boolean;
  health: ProviderHealth;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  simulatorBehavior: SimulatorBehavior;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  lastError: string | null;
  lastCheckedAt?: string | null;
}

export interface RoutingConfig {
  strategy: RoutingStrategy;
  maxRetries: number;
  circuitBreakerThreshold: number;
  cooldownSeconds: number;
  roundRobinCursor: number;
}

export interface FailoverAttempt {
  providerId: string;
  providerName: string;
  adapter: ProviderAdapter;
  statusCode: number;
  latencyMs: number;
  outcome: 'success' | 'failed' | 'skipped_circuit' | 'skipped_unconfigured';
  errorMessage?: string;
}

export interface GatewayLogEntry {
  id: string;
  timestamp: string;
  keyId: string;
  keyName: string;
  publicKey: string;
  authMethod: 'key_pair' | 'hmac_sha256' | 'bearer_pair';
  strategyUsed: RoutingStrategy;
  attempts: FailoverAttempt[];
  finalProviderId: string | null;
  finalProviderName: string | null;
  status: 'success' | 'failed';
  statusCode: number;
  totalLatencyMs: number;
  failoverTriggered: boolean;
  payloadPreview: string;
  responsePreview: string;
}

export interface GatewayOverviewResponse {
  keys: AccessKeyPublicView[];
  providers: UpstreamProviderPublicView[];
  routing: RoutingConfig;
  logs: GatewayLogEntry[];
  stats: {
    activeKeys: number;
    healthyProviders: number;
    configuredProviders: number;
    totalProviders: number;
    totalFreeModels: number;
    totalRequests: number;
    failoverRecoveries: number;
    successRate: number;
  };
  gatewayEndpointUrl: string;
  hasMasterEncryptionKey: boolean;
  hasGeminiEnvKey: boolean;
  bootId?: string;
}

export interface AuthStatusResponse {
  requiresSetup: boolean;
  envPasscodeActive: boolean;
  authenticated: boolean;
  firebaseEnabled?: boolean;
}

export interface CreatedKeySecretResponse {
  key: AccessKeyPublicView;
  secretKey: string;
}

export interface RevealKeyResponse {
  id: string;
  name: string;
  publicKey: string;
  secretKey: string | null;
  requiresRotation: boolean;
  message?: string;
}

export interface GatewayExecutionResponse {
  ok: boolean;
  requestId: string;
  provider?: {
    id: string;
    name: string;
    adapter: ProviderAdapter;
    model: string;
  };
  failoverTriggered: boolean;
  totalLatencyMs: number;
  attempts: FailoverAttempt[];
  data?: unknown;
  error?: string;
}
