import { desc, eq } from 'drizzle-orm';
import { db, isSqlConfigured } from '../src/db/index.ts';
import {
  taygosKeys,
  taygosLogs,
  taygosProviders,
  taygosSettings,
} from '../src/db/schema.ts';
import type {
  GatewayLogEntry,
  KeyStatus,
  ProviderAdapter,
  ProviderCategory,
  ProviderHealth,
  RoutingStrategy,
  SimulatorBehavior,
} from '../src/types/taygos.ts';
import {
  getLocalVaultSecretsHex,
  setRuntimeVaultSecrets,
} from './security.ts';
import type {
  StoreSchema,
  StoredAccessKey,
  StoredUpstreamProvider,
} from './store.ts';

const SETTINGS_ID = 'default';

function isTransientSqlWakeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: unknown })?.code;
  const codeStr = typeof code === 'string' ? code : '';
  return (
    codeStr === 'ECONNRESET' ||
    codeStr === 'ETIMEDOUT' ||
    codeStr === 'EPIPE' ||
    codeStr === 'ECONNREFUSED' ||
    codeStr === '57P01' ||
    codeStr === '57P02' ||
    codeStr === '57P03' ||
    /ECONNRESET|ETIMEDOUT|EPIPE|Connection terminated|terminating connection|the database system is starting up|timeout expired/i.test(
      msg
    )
  );
}

async function withSqlRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  const delays = [450, 900];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length && isTransientSqlWakeError(err)) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function safeParseJsonArray(raw: string | null | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // ignore malformed json
  }
  return fallback;
}

function rowToAccessKey(row: typeof taygosKeys.$inferSelect): StoredAccessKey {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    publicKey: row.publicKey,
    secretMasked: row.secretMasked,
    secretHash: row.secretHash,
    hmacSealedSecret: row.hmacSealedSecret,
    perpetual: row.perpetual,
    expiresAt: row.expiresAt,
    scopes: safeParseJsonArray(row.scopesJson, ['gateway:execute', 'ai:generate']),
    requireHmac: row.requireHmac,
    status: (row.status === 'revoked' ? 'revoked' : 'active') as KeyStatus,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    requestCount: row.requestCount,
    failoverCount: row.failoverCount,
  };
}

function rowToProvider(row: typeof taygosProviders.$inferSelect): StoredUpstreamProvider {
  return {
    id: row.id,
    slug: row.slug ?? undefined,
    name: row.name,
    category: (row.category || 'llm') as ProviderCategory,
    specialty: row.specialty ?? undefined,
    adapter: row.adapter as ProviderAdapter,
    baseUrl: row.baseUrl,
    apiKeyUrl: row.apiKeyUrl ?? undefined,
    model: row.model,
    authHeader: row.authHeader,
    apiKeyMasked: row.apiKeyMasked,
    apiKeySealed: row.apiKeySealed,
    usesServerEnv: row.usesServerEnv,
    requiresApiKey: row.requiresApiKey,
    freeModelsCount: row.freeModelsCount ?? undefined,
    maxContext: row.maxContext ?? undefined,
    tagline: row.tagline ?? undefined,
    verifiedProtocols: row.verifiedProtocolsJson
      ? safeParseJsonArray(row.verifiedProtocolsJson, [])
      : undefined,
    priority: row.priority,
    weight: row.weight,
    timeoutMs: row.timeoutMs,
    enabled: row.enabled,
    health: row.health as ProviderHealth,
    consecutiveFailures: row.consecutiveFailures,
    cooldownUntil: row.cooldownUntil,
    simulatorBehavior: row.simulatorBehavior as SimulatorBehavior,
    totalRequests: row.totalRequests,
    successfulRequests: row.successfulRequests,
    failedRequests: row.failedRequests,
    avgLatencyMs: row.avgLatencyMs,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt ?? null,
  };
}

export async function saveSettingsToDb(store: StoreSchema): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      const localHex = getLocalVaultSecretsHex();
      await db
        .insert(taygosSettings)
        .values({
          id: SETTINGS_ID,
          adminPasswordHash: store.adminPasswordHash,
          adminOwnerUid: store.adminOwnerUid ?? null,
          vaultMasterKeyHex: localHex.vaultMasterKeyHex,
          vaultSessionKeyHex: localHex.vaultSessionKeyHex,
          strategy: store.routing.strategy,
          maxRetries: store.routing.maxRetries,
          circuitBreakerThreshold: store.routing.circuitBreakerThreshold,
          cooldownSeconds: store.routing.cooldownSeconds,
          roundRobinCursor: store.routing.roundRobinCursor,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: taygosSettings.id,
          set: {
            adminPasswordHash: store.adminPasswordHash,
            adminOwnerUid: store.adminOwnerUid ?? null,
            strategy: store.routing.strategy,
            maxRetries: store.routing.maxRetries,
            circuitBreakerThreshold: store.routing.circuitBreakerThreshold,
            cooldownSeconds: store.routing.cooldownSeconds,
            roundRobinCursor: store.routing.roundRobinCursor,
            updatedAt: new Date(),
          },
        });
    });
  } catch (err) {
    throw new Error('Failed to save settings to database.', { cause: err });
  }
}

export async function upsertKeyToDb(k: StoredAccessKey): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db
        .insert(taygosKeys)
        .values({
          id: k.id,
          name: k.name,
          description: k.description || '',
          publicKey: k.publicKey,
          secretMasked: k.secretMasked,
          secretHash: k.secretHash,
          hmacSealedSecret: k.hmacSealedSecret || '',
          perpetual: k.perpetual,
          expiresAt: k.expiresAt,
          scopesJson: JSON.stringify(k.scopes ?? ['gateway:execute']),
          requireHmac: k.requireHmac,
          status: k.status,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          requestCount: k.requestCount,
          failoverCount: k.failoverCount,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: taygosKeys.id,
          set: {
            name: k.name,
            description: k.description || '',
            publicKey: k.publicKey,
            secretMasked: k.secretMasked,
            secretHash: k.secretHash,
            hmacSealedSecret: k.hmacSealedSecret || '',
            perpetual: k.perpetual,
            expiresAt: k.expiresAt,
            scopesJson: JSON.stringify(k.scopes ?? ['gateway:execute']),
            requireHmac: k.requireHmac,
            status: k.status,
            lastUsedAt: k.lastUsedAt,
            requestCount: k.requestCount,
            failoverCount: k.failoverCount,
            updatedAt: new Date(),
          },
        });
    });
  } catch (err) {
    throw new Error('Failed to save access key to database.', { cause: err });
  }
}

export async function recordKeyUsageInDb(k: StoredAccessKey): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db
        .update(taygosKeys)
        .set({
          lastUsedAt: k.lastUsedAt,
          requestCount: k.requestCount,
          failoverCount: k.failoverCount,
          updatedAt: new Date(),
        })
        .where(eq(taygosKeys.id, k.id));
    });
  } catch {
    // Non-fatal telemetry update
  }
}

export async function deleteKeyFromDb(keyId: string): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db.delete(taygosKeys).where(eq(taygosKeys.id, keyId));
    });
  } catch (err) {
    throw new Error('Failed to delete access key from database.', { cause: err });
  }
}

export async function upsertProviderToDb(p: StoredUpstreamProvider): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db
        .insert(taygosProviders)
        .values({
          id: p.id,
          slug: p.slug ?? null,
          name: p.name,
          category: p.category || 'llm',
          specialty: p.specialty ?? null,
          adapter: p.adapter,
          baseUrl: p.baseUrl,
          apiKeyUrl: p.apiKeyUrl ?? null,
          model: p.model,
          authHeader: p.authHeader || 'Authorization',
          apiKeyMasked: p.apiKeyMasked || 'not-set',
          apiKeySealed: p.apiKeySealed || '',
          usesServerEnv: Boolean(p.usesServerEnv),
          requiresApiKey: Boolean(p.requiresApiKey),
          freeModelsCount: p.freeModelsCount ?? null,
          maxContext: p.maxContext ?? null,
          tagline: p.tagline ?? null,
          verifiedProtocolsJson: p.verifiedProtocols
            ? JSON.stringify(p.verifiedProtocols)
            : null,
          priority: p.priority,
          weight: p.weight,
          timeoutMs: p.timeoutMs,
          enabled: p.enabled,
          health: p.health,
          consecutiveFailures: p.consecutiveFailures,
          cooldownUntil: p.cooldownUntil,
          simulatorBehavior: p.simulatorBehavior || 'healthy',
          totalRequests: p.totalRequests,
          successfulRequests: p.successfulRequests,
          failedRequests: p.failedRequests,
          avgLatencyMs: p.avgLatencyMs,
          lastError: p.lastError,
          lastCheckedAt: p.lastCheckedAt ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: taygosProviders.id,
          set: {
            slug: p.slug ?? null,
            name: p.name,
            category: p.category || 'llm',
            specialty: p.specialty ?? null,
            adapter: p.adapter,
            baseUrl: p.baseUrl,
            apiKeyUrl: p.apiKeyUrl ?? null,
            model: p.model,
            authHeader: p.authHeader || 'Authorization',
            apiKeyMasked: p.apiKeyMasked || 'not-set',
            apiKeySealed: p.apiKeySealed || '',
            usesServerEnv: Boolean(p.usesServerEnv),
            requiresApiKey: Boolean(p.requiresApiKey),
            freeModelsCount: p.freeModelsCount ?? null,
            maxContext: p.maxContext ?? null,
            tagline: p.tagline ?? null,
            verifiedProtocolsJson: p.verifiedProtocols
              ? JSON.stringify(p.verifiedProtocols)
              : null,
            priority: p.priority,
            weight: p.weight,
            timeoutMs: p.timeoutMs,
            enabled: p.enabled,
            health: p.health,
            consecutiveFailures: p.consecutiveFailures,
            cooldownUntil: p.cooldownUntil,
            simulatorBehavior: p.simulatorBehavior || 'healthy',
            totalRequests: p.totalRequests,
            successfulRequests: p.successfulRequests,
            failedRequests: p.failedRequests,
            avgLatencyMs: p.avgLatencyMs,
            lastError: p.lastError,
            lastCheckedAt: p.lastCheckedAt ?? null,
            updatedAt: new Date(),
          },
        });
    });
  } catch (err) {
    throw new Error('Failed to save provider config to database.', { cause: err });
  }
}

export async function recordProviderStatsInDb(p: StoredUpstreamProvider): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db
        .update(taygosProviders)
        .set({
          health: p.health,
          consecutiveFailures: p.consecutiveFailures,
          cooldownUntil: p.cooldownUntil,
          totalRequests: p.totalRequests,
          successfulRequests: p.successfulRequests,
          failedRequests: p.failedRequests,
          avgLatencyMs: p.avgLatencyMs,
          lastError: p.lastError,
          lastCheckedAt: p.lastCheckedAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(taygosProviders.id, p.id));
    });
  } catch {
    // Non-fatal telemetry update
  }
}

export async function deleteProviderFromDb(providerId: string): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db.delete(taygosProviders).where(eq(taygosProviders.id, providerId));
    });
  } catch (err) {
    throw new Error('Failed to delete provider from database.', { cause: err });
  }
}

export async function appendLogToDb(entry: GatewayLogEntry): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db
        .insert(taygosLogs)
        .values({
          id: entry.id,
          timestamp: entry.timestamp,
          entryJson: JSON.stringify(entry),
        })
        .onConflictDoNothing();
    });
  } catch (err) {
    throw new Error('Failed to write gateway log to database.', { cause: err });
  }
}

export async function clearLogsInDb(): Promise<void> {
  if (!isSqlConfigured()) return;
  try {
    await withSqlRetry(async () => {
      await db.delete(taygosLogs);
    });
  } catch (err) {
    throw new Error('Failed to clear gateway logs in database.', { cause: err });
  }
}

export async function saveFullStoreToDb(store: StoreSchema): Promise<void> {
  if (!isSqlConfigured()) return;
  await saveSettingsToDb(store);
  for (const k of store.keys) {
    await upsertKeyToDb(k);
  }
  for (const p of store.providers) {
    await upsertProviderToDb(p);
  }
}

export async function hydrateStoreFromDb(
  store: StoreSchema,
  mergeMissingCatalogFn: (s: StoreSchema) => boolean
): Promise<{ hydrated: boolean; bootstrapped: boolean }> {
  if (!isSqlConfigured()) {
    return { hydrated: false, bootstrapped: false };
  }

  try {
    const [settingsRows, keyRows, providerRows, logRows] = await withSqlRetry(() =>
      Promise.all([
        db.select().from(taygosSettings).where(eq(taygosSettings.id, SETTINGS_ID)),
        db.select().from(taygosKeys),
        db.select().from(taygosProviders),
        db.select().from(taygosLogs).orderBy(desc(taygosLogs.createdAt)).limit(150),
      ])
    );

    const settings = settingsRows[0];
    if (settings) {
      setRuntimeVaultSecrets({
        vaultMasterKeyHex: settings.vaultMasterKeyHex,
        vaultSessionKeyHex: settings.vaultSessionKeyHex,
      });
      if (settings.adminPasswordHash && !store.adminPasswordHash) {
        store.adminPasswordHash = settings.adminPasswordHash;
      }
      if (settings.adminOwnerUid) {
        store.adminOwnerUid = settings.adminOwnerUid;
      }
      if (
        ['priority_failover', 'round_robin', 'lowest_latency'].includes(
          settings.strategy
        )
      ) {
        store.routing.strategy = settings.strategy as RoutingStrategy;
      }
      store.routing.maxRetries = settings.maxRetries;
      store.routing.circuitBreakerThreshold = settings.circuitBreakerThreshold;
      store.routing.cooldownSeconds = settings.cooldownSeconds;
      store.routing.roundRobinCursor = settings.roundRobinCursor;
    }

    if (!settings && keyRows.length === 0 && providerRows.length === 0) {
      // First-time bootstrap on empty DB: persist local keys/providers/settings into PostgreSQL
      await saveFullStoreToDb(store);
      return { hydrated: true, bootstrapped: true };
    }

    // PostgreSQL is authoritative once initialized (prevents stale container RAM from resurrecting deleted keys)
    store.keys = keyRows.map(rowToAccessKey);

    if (providerRows.length > 0) {
      const dbProviders = providerRows.map(rowToProvider);
      const beforeById = new Map(dbProviders.map((p) => [p.id, JSON.stringify(p)]));
      store.providers = dbProviders;
      const catalogChanged = mergeMissingCatalogFn(store);
      if (catalogChanged) {
        for (const p of store.providers) {
          if (beforeById.get(p.id) !== JSON.stringify(p)) {
            await upsertProviderToDb(p);
          }
        }
      } else {
        store.providers.sort((a, b) => a.priority - b.priority);
      }
    } else {
      for (const p of store.providers) {
        await upsertProviderToDb(p);
      }
    }

    if (logRows.length > 0) {
      const parsedLogs: GatewayLogEntry[] = [];
      for (const lr of logRows) {
        try {
          parsedLogs.push(JSON.parse(lr.entryJson) as GatewayLogEntry);
        } catch {
          // ignore malformed log entry
        }
      }
      if (parsedLogs.length > 0) {
        store.logs = parsedLogs;
      }
    }

    if (!settings) {
      await saveSettingsToDb(store);
    }

    return { hydrated: true, bootstrapped: false };
  } catch (err) {
    throw new Error('Database hydration failed.', { cause: err });
  }
}
