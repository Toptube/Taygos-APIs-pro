import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AccessKeyPublicView,
  GatewayLogEntry,
  KeyStatus,
  ProviderAdapter,
  ProviderCategory,
  ProviderHealth,
  RoutingConfig,
  SimulatorBehavior,
  UpstreamProviderPublicView,
} from '../src/types/taygos.ts';
import { TAYGOS_GITHUB_CATALOG } from './catalog.ts';
import {
  generateTaygosKeyPair,
  hashSecret,
  maskCredential,
  sealSecret,
  unsealSecret,
  verifySecret,
} from './security.ts';

export interface StoredAccessKey {
  id: string;
  name: string;
  description: string;
  publicKey: string;
  secretMasked: string;
  secretHash: string;
  hmacSealedSecret: string;
  perpetual: boolean;
  expiresAt: string | null;
  scopes: string[];
  requireHmac: boolean;
  status: KeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  failoverCount: number;
}

export interface StoredUpstreamProvider {
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
  apiKeySealed: string;
  usesServerEnv: boolean;
  requiresApiKey: boolean;
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

export interface StoreSchema {
  adminPasswordHash: string | null;
  keys: StoredAccessKey[];
  providers: StoredUpstreamProvider[];
  routing: RoutingConfig;
  logs: GatewayLogEntry[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'taygos-store.json');

function isProviderConfigured(p: StoredUpstreamProvider): boolean {
  if (p.adapter === 'sandbox-simulator') return true;
  if (p.usesServerEnv) return Boolean(process.env.GEMINI_API_KEY?.trim());
  if (p.baseUrl.includes('{account_id}') || p.baseUrl.includes('.example.com')) {
    return false;
  }
  if (!p.requiresApiKey) return true;
  return Boolean(unsealSecret(p.apiKeySealed));
}

function createCatalogProviderEntry(
  spec: (typeof TAYGOS_GITHUB_CATALOG)[number]
): StoredUpstreamProvider {
  const isGeminiSlug =
    spec.slug === 'google-gemini' ||
    spec.slug === 'google-gemini-imagen' ||
    spec.slug === 'google-gemini-veo';
  const hasGeminiEnv =
    isGeminiSlug && Boolean(process.env.GEMINI_API_KEY?.trim());
  const isDisabledByDefault =
    Boolean(spec.disabledByDefault) ||
    spec.slug === 'perch-ai' ||
    spec.slug === 'cline' ||
    spec.slug === 'meta-model-api';

  const configured = hasGeminiEnv || !spec.requiresApiKey;

  return {
    id: `prov_${spec.slug.replace(/[^a-z0-9]/g, '_')}`,
    slug: spec.slug,
    name: spec.name,
    category: spec.category,
    specialty: spec.specialty,
    adapter: spec.adapter,
    baseUrl: spec.baseUrl,
    apiKeyUrl: spec.apiKeyUrl,
    model: spec.model,
    authHeader: spec.authHeader,
    apiKeyMasked: hasGeminiEnv
      ? 'env:GEMINI_API_KEY'
      : !spec.requiresApiKey
        ? 'anonymous-free-tier'
        : 'not-set',
    apiKeySealed: '',
    usesServerEnv: hasGeminiEnv,
    requiresApiKey: spec.requiresApiKey,
    freeModelsCount: spec.freeModelsCount,
    maxContext: spec.maxContext,
    tagline: spec.tagline,
    verifiedProtocols: spec.verifiedProtocols,
    priority: spec.priority,
    weight: Math.max(10, 100 - spec.priority * 3),
    timeoutMs: 12000,
    enabled: !isDisabledByDefault,
    health: configured ? 'healthy' : 'needs_key',
    consecutiveFailures: 0,
    cooldownUntil: null,
    simulatorBehavior: 'healthy',
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgLatencyMs: 0,
    lastError: null,
    lastCheckedAt: null,
  };
}

function createDefaultProviders(): StoredUpstreamProvider[] {
  const catalogEntries = TAYGOS_GITHUB_CATALOG.map(createCatalogProviderEntry);
  catalogEntries.push(
    {
      id: 'prov_sim_primary',
      slug: 'sandbox-primary',
      name: 'Sandbox Failover Node A',
      adapter: 'sandbox-simulator',
      baseUrl: 'sandbox://primary-edge',
      model: 'taygos-edge-v1',
      authHeader: 'Authorization',
      apiKeyMasked: 'sandbox-managed',
      apiKeySealed: '',
      usesServerEnv: false,
      requiresApiKey: false,
      freeModelsCount: 1,
      maxContext: 128000,
      tagline: 'Built-in sandbox node for testing 429/503 automatic failover.',
      verifiedProtocols: ['Taygos Sandbox'],
      priority: 90,
      weight: 20,
      timeoutMs: 5000,
      enabled: true,
      health: 'healthy',
      consecutiveFailures: 0,
      cooldownUntil: null,
      simulatorBehavior: 'healthy',
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      lastError: null,
      lastCheckedAt: null,
    },
    {
      id: 'prov_sim_backup',
      slug: 'sandbox-backup',
      name: 'Sandbox Failover Node B',
      adapter: 'sandbox-simulator',
      baseUrl: 'sandbox://secondary-failover',
      model: 'taygos-backup-v1',
      authHeader: 'Authorization',
      apiKeyMasked: 'sandbox-managed',
      apiKeySealed: '',
      usesServerEnv: false,
      requiresApiKey: false,
      freeModelsCount: 1,
      maxContext: 128000,
      tagline: 'Built-in secondary sandbox node for verifying failover recovery.',
      verifiedProtocols: ['Taygos Sandbox'],
      priority: 91,
      weight: 10,
      timeoutMs: 5000,
      enabled: true,
      health: 'healthy',
      consecutiveFailures: 0,
      cooldownUntil: null,
      simulatorBehavior: 'healthy',
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      lastError: null,
      lastCheckedAt: null,
    }
  );
  return catalogEntries.sort((a, b) => a.priority - b.priority);
}

function createInitialStore(): StoreSchema {
  return {
    adminPasswordHash: null,
    keys: [],
    providers: createDefaultProviders(),
    routing: {
      strategy: 'priority_failover',
      maxRetries: 5,
      circuitBreakerThreshold: 2,
      cooldownSeconds: 30,
      roundRobinCursor: 0,
    },
    logs: [],
  };
}

let memoryStore: StoreSchema | null = null;

function mergeMissingCatalogProviders(store: StoreSchema): boolean {
  let changed = false;
  for (const spec of TAYGOS_GITHUB_CATALOG) {
    const existing = store.providers.find(
      (p) => p.slug === spec.slug || p.name.toLowerCase() === spec.name.toLowerCase()
    );
    if (!existing) {
      store.providers.push(createCatalogProviderEntry(spec));
      changed = true;
    } else {
      if (existing.category !== spec.category) {
        existing.category = spec.category;
        changed = true;
      }
      if (spec.specialty && existing.specialty !== spec.specialty) {
        existing.specialty = spec.specialty;
        changed = true;
      }
      if (existing.requiresApiKey !== spec.requiresApiKey) {
        existing.requiresApiKey = spec.requiresApiKey;
        if (spec.requiresApiKey && !existing.apiKeySealed && !existing.usesServerEnv) {
          existing.apiKeyMasked = 'not-set';
          existing.health = 'needs_key';
          existing.lastError = null;
          existing.consecutiveFailures = 0;
          existing.cooldownUntil = null;
        }
        changed = true;
      }
      if (spec.tagline && existing.tagline !== spec.tagline) {
        existing.tagline = spec.tagline;
        changed = true;
      }
      if (spec.apiKeyUrl && existing.apiKeyUrl !== spec.apiKeyUrl) {
        existing.apiKeyUrl = spec.apiKeyUrl;
        changed = true;
      }
      const syncSlugEndpoints = new Set([
        'pollinations-text',
        'pollinations-audio',
        'pollinations-mai-voice',
        'pollinations-video',
        'pollinations-image-edit',
        'pollinations-sana',
        'llm7-io',
        'huggingface-video',
      ]);
      if (spec.slug && syncSlugEndpoints.has(spec.slug)) {
        if (existing.baseUrl !== spec.baseUrl) {
          existing.baseUrl = spec.baseUrl;
          changed = true;
        }
        if (existing.model !== spec.model) {
          existing.model = spec.model;
          changed = true;
        }
        if (existing.adapter !== spec.adapter) {
          existing.adapter = spec.adapter;
          changed = true;
        }
        if (existing.name !== spec.name) {
          existing.name = spec.name;
          changed = true;
        }
      }
    }
  }
  // Remove legacy duplicate prov_gemini_env if prov_google_gemini already exists without custom sealed key
  const hasCatalogGemini = store.providers.some((p) => p.slug === 'google-gemini');
  if (hasCatalogGemini) {
    const beforeLen = store.providers.length;
    store.providers = store.providers.filter(
      (p) => !(p.id === 'prov_gemini_env' && !p.apiKeySealed)
    );
    if (store.providers.length !== beforeLen) {
      changed = true;
    }
  }
  // Ensure default Gemini providers & category backfill
  const hasGeminiEnv = Boolean(process.env.GEMINI_API_KEY?.trim());
  for (const p of store.providers) {
    if (!p.category) {
      p.category = 'llm';
      changed = true;
    }
    if (typeof p.requiresApiKey !== 'boolean') {
      p.requiresApiKey = p.adapter !== 'sandbox-simulator';
      changed = true;
    }
    if (
      (p.slug === 'google-gemini' ||
        p.slug === 'google-gemini-imagen' ||
        p.slug === 'google-gemini-veo') &&
      hasGeminiEnv &&
      !p.usesServerEnv &&
      !p.apiKeySealed
    ) {
      p.usesServerEnv = true;
      p.apiKeyMasked = 'env:GEMINI_API_KEY';
      p.health = 'healthy';
      changed = true;
    }
  }
  if (changed) {
    store.providers.sort((a, b) => a.priority - b.priority);
  }
  return changed;
}

function ensureStoreLoaded(): StoreSchema {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as StoreSchema;
      memoryStore = {
        adminPasswordHash: parsed.adminPasswordHash ?? null,
        keys: Array.isArray(parsed.keys) ? parsed.keys : [],
        providers: Array.isArray(parsed.providers)
          ? parsed.providers
          : createDefaultProviders(),
        routing: parsed.routing ?? createInitialStore().routing,
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      };
      if (mergeMissingCatalogProviders(memoryStore)) {
        persistStore();
      }
      return memoryStore;
    }
  } catch {
    // Fall back to fresh store if corrupted
  }
  memoryStore = createInitialStore();
  persistStore();
  return memoryStore;
}

export function persistStore(): void {
  const store = ensureStoreLoaded();
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmpPath, STORE_PATH);
  } catch {
    // Ignore disk write failure in read-only runtimes while keeping in-memory store
  }
}

export function getStore(): StoreSchema {
  return ensureStoreLoaded();
}

export function isEnvPasscodeConfigured(): boolean {
  return Boolean(process.env.TAYGOS_ADMIN_PASSCODE?.trim());
}

export function isAdminSetupRequired(): boolean {
  if (isEnvPasscodeConfigured()) return false;
  return !ensureStoreLoaded().adminPasswordHash;
}

export function claimInitialAdminPassword(password: string): boolean {
  const store = ensureStoreLoaded();
  if (isEnvPasscodeConfigured() || store.adminPasswordHash) {
    return false;
  }
  store.adminPasswordHash = hashSecret(password);
  persistStore();
  return true;
}

export function verifyAdminPasscode(candidate: string): boolean {
  const envPass = process.env.TAYGOS_ADMIN_PASSCODE?.trim();
  if (envPass) {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(envPass, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const storedHash = ensureStoreLoaded().adminPasswordHash;
  if (!storedHash) return false;
  return verifySecret(candidate, storedHash);
}

export function toPublicKeyView(k: StoredAccessKey): AccessKeyPublicView {
  return {
    id: k.id,
    name: k.name,
    description: k.description,
    publicKey: k.publicKey,
    secretMasked: k.secretMasked,
    perpetual: k.perpetual,
    expiresAt: k.expiresAt,
    scopes: k.scopes,
    requireHmac: k.requireHmac,
    hmacReady: Boolean(unsealSecret(k.hmacSealedSecret)),
    status: k.status,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    requestCount: k.requestCount,
    failoverCount: k.failoverCount,
  };
}

export function toPublicProviderView(
  p: StoredUpstreamProvider
): UpstreamProviderPublicView {
  const configured = isProviderConfigured(p);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category || 'llm',
    specialty: p.specialty,
    adapter: p.adapter,
    baseUrl: p.baseUrl,
    apiKeyUrl: p.apiKeyUrl,
    model: p.model,
    authHeader: p.authHeader,
    apiKeyMasked: p.apiKeyMasked,
    usesServerEnv: p.usesServerEnv,
    requiresApiKey: p.requiresApiKey,
    keyConfigured: configured,
    freeModelsCount: p.freeModelsCount,
    maxContext: p.maxContext,
    tagline: p.tagline,
    verifiedProtocols: p.verifiedProtocols,
    priority: p.priority,
    weight: p.weight,
    timeoutMs: p.timeoutMs,
    enabled: p.enabled,
    health: configured ? p.health : 'needs_key',
    consecutiveFailures: p.consecutiveFailures,
    cooldownUntil: p.cooldownUntil,
    simulatorBehavior: p.simulatorBehavior,
    totalRequests: p.totalRequests,
    successfulRequests: p.successfulRequests,
    failedRequests: p.failedRequests,
    avgLatencyMs: p.avgLatencyMs,
    lastError: p.lastError,
    lastCheckedAt: p.lastCheckedAt ?? null,
  };
}

export function createAccessKeyRecord(input: {
  name: string;
  description: string;
  scopes: string[];
  requireHmac: boolean;
}): { stored: StoredAccessKey; plainSecret: string } {
  const store = ensureStoreLoaded();
  const { publicKey, secretKey, secretMasked } = generateTaygosKeyPair();
  const stored: StoredAccessKey = {
    id: `key_${crypto.randomBytes(8).toString('hex')}`,
    name: input.name,
    description: input.description,
    publicKey,
    secretMasked,
    secretHash: hashSecret(secretKey),
    hmacSealedSecret: sealSecret(secretKey),
    perpetual: true,
    expiresAt: null,
    scopes: input.scopes.length ? input.scopes : ['gateway:execute'],
    requireHmac: input.requireHmac,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    requestCount: 0,
    failoverCount: 0,
  };
  store.keys.unshift(stored);
  persistStore();
  return { stored, plainSecret: secretKey };
}

export function revealAccessKeySecret(keyId: string): {
  key: StoredAccessKey;
  secretKey: string | null;
} | null {
  const store = ensureStoreLoaded();
  const target = store.keys.find((k) => k.id === keyId);
  if (!target) return null;
  const plain = unsealSecret(target.hmacSealedSecret);
  return { key: target, secretKey: plain };
}

export function rotateAccessKeySecret(
  keyId: string
): { stored: StoredAccessKey; plainSecret: string } | null {
  const store = ensureStoreLoaded();
  const target = store.keys.find((k) => k.id === keyId);
  if (!target) return null;
  const secHex = crypto.randomBytes(24).toString('hex');
  const plainSecret = `sk_taygos_live_${secHex}`;
  target.secretMasked = maskCredential(plainSecret);
  target.secretHash = hashSecret(plainSecret);
  target.hmacSealedSecret = sealSecret(plainSecret);
  target.status = 'active';
  persistStore();
  return { stored: target, plainSecret };
}

export function addUpstreamProviderRecord(input: {
  name: string;
  category?: ProviderCategory;
  specialty?: string;
  adapter: ProviderAdapter;
  baseUrl: string;
  apiKeyUrl?: string;
  tagline?: string;
  freeModelsCount?: number;
  model: string;
  authHeader: string;
  apiKeyPlain: string;
  usesServerEnv: boolean;
  requiresApiKey?: boolean;
  priority: number;
  weight: number;
  timeoutMs: number;
  simulatorBehavior: SimulatorBehavior;
}): StoredUpstreamProvider {
  const store = ensureStoreLoaded();
  const requiresApiKey =
    typeof input.requiresApiKey === 'boolean'
      ? input.requiresApiKey
      : input.adapter !== 'sandbox-simulator';

  const hasKey =
    input.usesServerEnv ||
    Boolean(input.apiKeyPlain) ||
    !requiresApiKey ||
    input.adapter === 'sandbox-simulator';

  const provider: StoredUpstreamProvider = {
    id: `prov_${crypto.randomBytes(6).toString('hex')}`,
    name: input.name,
    category: input.category || 'llm',
    specialty: input.specialty,
    adapter: input.adapter,
    baseUrl: input.baseUrl,
    apiKeyUrl: input.apiKeyUrl,
    tagline: input.tagline,
    freeModelsCount: input.freeModelsCount,
    model: input.model,
    authHeader: input.authHeader || 'Authorization',
    apiKeyMasked: input.usesServerEnv
      ? 'env:GEMINI_API_KEY'
      : input.adapter === 'sandbox-simulator'
        ? 'sandbox-managed'
        : input.apiKeyPlain
          ? maskCredential(input.apiKeyPlain)
          : !requiresApiKey
            ? 'anonymous-free-tier'
            : 'not-set',
    apiKeySealed:
      input.usesServerEnv || !input.apiKeyPlain
        ? ''
        : sealSecret(input.apiKeyPlain),
    usesServerEnv: input.usesServerEnv,
    requiresApiKey,
    priority: input.priority,
    weight: input.weight,
    timeoutMs: input.timeoutMs,
    enabled: true,
    health: hasKey ? 'healthy' : 'needs_key',
    consecutiveFailures: 0,
    cooldownUntil: null,
    simulatorBehavior: input.simulatorBehavior,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgLatencyMs: 0,
    lastError: null,
    lastCheckedAt: null,
  };
  store.providers.push(provider);
  store.providers.sort((a, b) => a.priority - b.priority);
  persistStore();
  return provider;
}

export function appendGatewayLog(entry: GatewayLogEntry): void {
  const store = ensureStoreLoaded();
  store.logs.unshift(entry);
  if (store.logs.length > 150) {
    store.logs = store.logs.slice(0, 150);
  }
  persistStore();
}
