import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type {
  FailoverAttempt,
  GatewayExecutionResponse,
  GatewayLogEntry,
  ProviderCategory,
} from '../src/types/taygos.ts';
import {
  assertSafeUpstreamUrl,
  unsealSecret,
  verifyHmacSignature,
  verifySecret,
} from './security.ts';
import { recordKeyUsageInDb, recordProviderStatsInDb } from './dbVault.ts';
import {
  appendGatewayLog,
  ensureDbHydrated,
  getStore,
  persistStore,
  type StoredAccessKey,
  type StoredUpstreamProvider,
} from './store.ts';

export interface GatewayAuthResult {
  ok: boolean;
  statusCode: number;
  error?: string;
  key?: StoredAccessKey;
  authMethod?: 'key_pair' | 'hmac_sha256' | 'bearer_pair';
}

function matchKeyBySecret(
  keys: StoredAccessKey[],
  secretKey: string
): StoredAccessKey | undefined {
  for (const k of keys) {
    const unsealed = unsealSecret(k.hmacSealedSecret);
    if (unsealed && unsealed === secretKey) {
      return k;
    }
  }
  for (const k of keys) {
    if (verifySecret(secretKey, k.secretHash)) {
      return k;
    }
  }
  return undefined;
}

export async function authenticateGatewayRequest(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string
): Promise<GatewayAuthResult> {
  const getHeader = (name: string): string => {
    const val = headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0]?.trim() ?? '';
    return typeof val === 'string' ? val.trim() : '';
  };

  const cleanCred = (s: string): string =>
    s.trim().replace(/^["']+|["']+$/g, '').trim();

  let publicKey = cleanCred(getHeader('x-taygos-public-key'));
  let secretKey = cleanCred(getHeader('x-taygos-secret-key'));
  const timestamp = getHeader('x-taygos-timestamp');
  const signature = getHeader('x-taygos-signature');
  const authHeader = getHeader('authorization');
  const altApiKeyHeader = cleanCred(
    getHeader('x-api-key') || getHeader('x-taygos-api-key')
  );

  let authMethod: 'key_pair' | 'hmac_sha256' | 'bearer_pair' | null = null;

  const parseCombinedToken = (rawToken: string) => {
    const token = cleanCred(rawToken);
    if (!token) return;
    const sepIdx = token.indexOf(':') > 0 ? token.indexOf(':') : token.indexOf('|');
    if (sepIdx > 0) {
      if (!publicKey) publicKey = cleanCred(token.slice(0, sepIdx));
      if (!secretKey) secretKey = cleanCred(token.slice(sepIdx + 1));
      authMethod = 'bearer_pair';
    } else if (!secretKey) {
      secretKey = token;
      authMethod = 'bearer_pair';
    }
  };

  if (authHeader.toLowerCase().startsWith('bearer ')) {
    parseCombinedToken(authHeader.slice(7));
  } else if (!secretKey && altApiKeyHeader) {
    parseCombinedToken(altApiKeyHeader);
  }

  if (!publicKey && !secretKey) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Missing X-Taygos-Public-Key or Authorization Bearer credential.',
    };
  }

  let store = await ensureDbHydrated();
  let key: StoredAccessKey | undefined;
  let matchedBySecretDirectly = false;

  if (publicKey) {
    key = store.keys.find((k) => k.publicKey === publicKey);
    if (!key) {
      store = await ensureDbHydrated(true);
      key = store.keys.find((k) => k.publicKey === publicKey);
    }
    if (!key) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Invalid Taygos Public Key.',
      };
    }
  } else if (secretKey) {
    key = matchKeyBySecret(store.keys, secretKey);
    if (!key) {
      store = await ensureDbHydrated(true);
      key = matchKeyBySecret(store.keys, secretKey);
    }
    if (!key) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Invalid Taygos Secret Key.',
      };
    }
    matchedBySecretDirectly = true;
  }

  if (!key) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Invalid Taygos credentials.',
    };
  }

  if (key.status !== 'active') {
    return {
      ok: false,
      statusCode: 403,
      error: 'This Taygos API key has been revoked.',
    };
  }

  if (!key.perpetual && key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) {
    return {
      ok: false,
      statusCode: 403,
      error: 'This Taygos API key has expired.',
    };
  }

  if (signature && timestamp) {
    const unsealedHmacSecret = unsealSecret(key.hmacSealedSecret);
    if (!unsealedHmacSecret) {
      return {
        ok: false,
        statusCode: 401,
        error:
          'HMAC signing key is unavailable; configure TAYGOS_MASTER_KEY or use X-Taygos-Secret-Key.',
      };
    }
    const validHmac = verifyHmacSignature(
      unsealedHmacSecret,
      timestamp,
      signature,
      rawBody
    );
    if (!validHmac) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Invalid or expired X-Taygos-Signature HMAC-SHA256 digest.',
      };
    }
    authMethod = 'hmac_sha256';
  } else {
    if (key.requireHmac) {
      return {
        ok: false,
        statusCode: 401,
        error:
          'This key enforces HMAC-SHA256 request signing (X-Taygos-Timestamp and X-Taygos-Signature required).',
      };
    }
    if (!secretKey) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Missing X-Taygos-Secret-Key header.',
      };
    }
    if (!matchedBySecretDirectly && !verifySecret(secretKey, key.secretHash)) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Invalid Taygos Secret Key.',
      };
    }
    authMethod = authMethod ?? 'key_pair';
  }

  return {
    ok: true,
    statusCode: 200,
    key,
    authMethod,
  };
}

function resolveGatewayVendorGroup(p: {
  slug?: string;
  baseUrl: string;
}): string {
  const s = (p.slug || '').toLowerCase();
  const u = (p.baseUrl || '').toLowerCase();
  if (s.startsWith('huggingface') || u.includes('huggingface.co') || u.includes('.hf.space')) {
    return 'huggingface';
  }
  if (s.startsWith('api-airforce') || u.includes('api.airforce')) return 'airforce';
  if (s.startsWith('nvidia-nim') || u.includes('nvidia.com')) return 'nvidia';
  if (s.startsWith('pollinations') || u.includes('pollinations.ai')) return 'pollinations';
  if (s.startsWith('siliconflow') || u.includes('siliconflow.cn')) return 'siliconflow';
  if (s.startsWith('cloudflare') || u.includes('api.cloudflare.com')) return 'cloudflare';
  if (s.startsWith('wavespeed') || u.includes('wavespeed.ai')) return 'wavespeed';
  if (s.startsWith('replicate') || u.includes('replicate.com')) return 'replicate';
  if (s.startsWith('pixabay') || u.includes('pixabay.com')) return 'pixabay';
  if (s.startsWith('agnes-ai') || u.includes('agnes-ai.com')) return 'agnes';
  return s || u;
}

export function resolveProviderApiKey(provider: StoredUpstreamProvider): string {
  if (provider.usesServerEnv) {
    return process.env.GEMINI_API_KEY?.trim() ?? '';
  }
  const direct = unsealSecret(provider.apiKeySealed) ?? '';
  if (direct) return direct;

  const vendor = resolveGatewayVendorGroup(provider);
  if (vendor === 'huggingface' && process.env.HF_TOKEN?.trim()) {
    return process.env.HF_TOKEN.trim();
  }
  const store = getStore();
  for (const sibling of store.providers) {
    if (sibling.id === provider.id) continue;
    if (resolveGatewayVendorGroup(sibling) !== vendor) continue;
    const siblingKey = sibling.usesServerEnv
      ? process.env.GEMINI_API_KEY?.trim() ?? ''
      : unsealSecret(sibling.apiKeySealed) ?? '';
    if (siblingKey) return siblingKey;
  }
  return '';
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function hasProviderCredentials(provider: StoredUpstreamProvider): boolean {
  if (provider.adapter === 'sandbox-simulator') return true;
  if (
    provider.baseUrl.includes('{account_id}') ||
    provider.baseUrl.includes('.example.com')
  ) {
    return false;
  }
  if (!provider.requiresApiKey) return true;
  return Boolean(resolveProviderApiKey(provider));
}

function extractPromptText(payload: Record<string, unknown>): string {
  if (typeof payload.prompt === 'string' && payload.prompt.trim()) {
    return payload.prompt.trim();
  }
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    const formatted = payload.messages
      .map((m) => {
        if (!m || typeof m !== 'object') return '';
        const msg = m as { role?: unknown; content?: unknown };
        const role = typeof msg.role === 'string' ? msg.role : 'user';
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content ?? '');
        return `${role}: ${content}`;
      })
      .filter(Boolean)
      .join('\n');
    if (formatted.trim()) return formatted;
  }
  return JSON.stringify(payload);
}

function buildOpenAICompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  if (/\/(v\d+(beta)?|openai\/v1|api\/gateway|paas\/v4)$/i.test(clean)) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

async function resolveImageBytes(
  rawInput: unknown
): Promise<{ buffer: Buffer; mimeType: string; base64: string } | null> {
  if (typeof rawInput !== 'string' || !rawInput.trim()) return null;
  const trimmed = rawInput.trim();
  const dataMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataMatch) {
    const mimeType = dataMatch[1];
    const base64 = dataMatch[2];
    return {
      buffer: Buffer.from(base64, 'base64'),
      mimeType,
      base64,
    };
  }
  if (trimmed.startsWith('https://')) {
    const safeUrl = await assertSafeUpstreamUrl(trimmed);
    const res = await fetch(safeUrl.toString());
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    return {
      buffer: buf,
      mimeType,
      base64: buf.toString('base64'),
    };
  }
  return null;
}

interface GradioFileData {
  path: string;
  url: string;
  orig_name: string;
  mime_type: string;
  is_stream: boolean;
  meta: { _type: string };
}

function buildGradioMediaUrl(spaceBaseUrl: string, item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const obj = item as Record<string, unknown>;
  if (obj.video && typeof obj.video === 'object') {
    const inner = buildGradioMediaUrl(spaceBaseUrl, obj.video);
    if (inner) return inner;
  }
  if (typeof obj.url === 'string' && obj.url.startsWith('http')) {
    return obj.url;
  }
  if (typeof obj.path === 'string' && obj.path) {
    return `${spaceBaseUrl.replace(/\/+$/, '')}/gradio_api/file=${obj.path}`;
  }
  return '';
}

function extractGradioOutputMediaUrl(
  spaceBaseUrl: string,
  parsedData: unknown[],
  preferCutoutOutput = false
): string {
  if (!Array.isArray(parsedData) || parsedData.length === 0) return '';

  // For RMBG spaces: BRIA returns [[orig_slider, cutout_slider], no_bg_image.png]
  // Other spaces return [[orig_slider, cutout_slider]]
  if (preferCutoutOutput) {
    // 1. Look specifically for explicit no_bg_image PNG output
    for (let i = parsedData.length - 1; i >= 0; i--) {
      const item = parsedData[i];
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        const orig = typeof rec.orig_name === 'string' ? rec.orig_name.toLowerCase() : '';
        const p = typeof rec.path === 'string' ? rec.path.toLowerCase() : '';
        if (orig.includes('no_bg') || p.includes('no_bg') || p.endsWith('.png')) {
          const url = buildGradioMediaUrl(spaceBaseUrl, item);
          if (url) return url;
        }
      }
    }
    // 2. If slider tuple [before, after], always pick index 1 (after cutout!)
    for (const item of parsedData) {
      if (Array.isArray(item) && item.length >= 2) {
        const afterUrl = buildGradioMediaUrl(spaceBaseUrl, item[1]);
        if (afterUrl) return afterUrl;
      }
    }
  }

  for (const item of parsedData) {
    if (Array.isArray(item)) {
      for (const sub of item) {
        const url = buildGradioMediaUrl(spaceBaseUrl, sub);
        if (url) return url;
      }
    } else {
      const url = buildGradioMediaUrl(spaceBaseUrl, item);
      if (url) return url;
    }
  }
  return '';
}

function resolveAnyHfToken(): string {
  if (process.env.HF_TOKEN?.trim()) return process.env.HF_TOKEN.trim();
  const store = getStore();
  for (const p of store.providers) {
    if (resolveGatewayVendorGroup(p) === 'huggingface') {
      const key = unsealSecret(p.apiKeySealed) ?? '';
      if (key) return key;
    }
  }
  return '';
}

async function uploadToGradioSpace(
  spaceBaseUrl: string,
  imgRaw: string,
  signal: AbortSignal,
  hfToken?: string
): Promise<GradioFileData> {
  const resolved = await resolveImageBytes(imgRaw);
  if (!resolved) {
    throw Object.assign(new Error('Could not decode or fetch input image for AI Space.'), {
      statusCode: 400,
    });
  }
  const cleanBase = spaceBaseUrl.replace(/\/+$/, '');
  const ext = resolved.mimeType.includes('png') ? 'png' : 'jpg';
  const fd = new FormData();
  fd.append(
    'files',
    new Blob([new Uint8Array(resolved.buffer)], { type: resolved.mimeType || 'image/jpeg' }),
    `product.${ext}`
  );
  const upRes = await fetch(`${cleanBase}/gradio_api/upload`, {
    method: 'POST',
    headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined,
    body: fd,
    signal,
  });
  if (!upRes.ok) {
    throw Object.assign(new Error(`Gradio upload HTTP ${upRes.status}`), {
      statusCode: upRes.status,
    });
  }
  const paths = (await upRes.json()) as unknown;
  const uploadedPath = Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : '';
  if (!uploadedPath) {
    throw Object.assign(new Error('Gradio upload returned empty path.'), { statusCode: 502 });
  }
  return {
    path: uploadedPath,
    url: `${cleanBase}/gradio_api/file=${uploadedPath}`,
    orig_name: `product.${ext}`,
    mime_type: resolved.mimeType || 'image/jpeg',
    is_stream: false,
    meta: { _type: 'gradio.FileData' },
  };
}

async function invokeGradioSpace(params: {
  spaceBaseUrl: string;
  endpoint: string;
  modelName: string;
  timeoutMs: number;
  probeOnly?: boolean;
  inputImageRaw?: string;
  buildData: (fileRef: GradioFileData | null) => unknown[];
  preferCutoutOutput?: boolean;
  expectedKind: 'image' | 'video';
  specialty?: string;
}): Promise<{ statusCode: number; data: unknown }> {
  const cleanBase = params.spaceBaseUrl.replace(/\/+$/, '');
  await assertSafeUpstreamUrl(cleanBase);

  const hfToken = resolveAnyHfToken();
  const authHeaders: Record<string, string> = hfToken
    ? { Authorization: `Bearer ${hfToken}` }
    : {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(params.timeoutMs, 35000));

  try {
    if (params.probeOnly) {
      const cfgRes = await fetch(`${cleanBase}/config`, {
        headers: authHeaders,
        signal: controller.signal,
      });
      if (!cfgRes.ok) {
        throw Object.assign(new Error(`Gradio Space HTTP ${cfgRes.status}`), {
          statusCode: cfgRes.status,
        });
      }
      return {
        statusCode: 200,
        data: {
          model: params.modelName,
          spaceUrl: cleanBase,
          status: 'live',
        },
      };
    }

    let fileRef: GradioFileData | null = null;
    if (params.inputImageRaw) {
      fileRef = await uploadToGradioSpace(
        cleanBase,
        params.inputImageRaw,
        controller.signal,
        hfToken
      );
    }

    const callRes = await fetch(`${cleanBase}/gradio_api/call/${params.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ data: params.buildData(fileRef) }),
      signal: controller.signal,
    });
    if (!callRes.ok) {
      const txt = await callRes.text();
      throw Object.assign(
        new Error(`Gradio call HTTP ${callRes.status}: ${txt.slice(0, 120)}`),
        { statusCode: callRes.status }
      );
    }
    const callJson = (await callRes.json()) as { event_id?: string };
    const eventId = callJson?.event_id;
    if (!eventId) {
      throw Object.assign(new Error('Gradio call did not return event_id.'), {
        statusCode: 502,
      });
    }

    const sseRes = await fetch(`${cleanBase}/gradio_api/call/${params.endpoint}/${eventId}`, {
      headers: authHeaders,
      signal: controller.signal,
    });
    if (!sseRes.ok) {
      throw Object.assign(new Error(`Gradio SSE HTTP ${sseRes.status}`), {
        statusCode: sseRes.status,
      });
    }
    const sseText = await sseRes.text();

    let completeJsonRaw = '';
    let hasErrorEvent = false;
    let errorDetail = '';
    const lines = sseText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === 'event: complete') {
        const nextLine = lines[i + 1]?.trim() || '';
        if (nextLine.startsWith('data:')) {
          completeJsonRaw = nextLine.slice(5).trim();
        }
      } else if (line === 'event: error') {
        hasErrorEvent = true;
        const nextLine = lines[i + 1]?.trim() || '';
        if (nextLine.startsWith('data:')) {
          errorDetail = nextLine.slice(5).trim();
        }
      }
    }

    if (hasErrorEvent && !completeJsonRaw) {
      throw Object.assign(
        new Error(
          `Gradio Space returned queue/quota error${errorDetail && errorDetail !== 'null' ? `: ${errorDetail.slice(0, 120)}` : ''}`
        ),
        { statusCode: 503 }
      );
    }
    if (!completeJsonRaw) {
      throw Object.assign(new Error('Gradio Space stream finished without complete payload.'), {
        statusCode: 502,
      });
    }

    const parsedData = JSON.parse(completeJsonRaw) as unknown[];
    const mediaUrl = extractGradioOutputMediaUrl(
      cleanBase,
      parsedData,
      Boolean(params.preferCutoutOutput)
    );
    if (!mediaUrl) {
      throw Object.assign(new Error('Gradio Space returned no output file URL.'), {
        statusCode: 502,
      });
    }

    const safeMediaUrl = await assertSafeUpstreamUrl(mediaUrl);
    const mediaRes = await fetch(safeMediaUrl.toString(), {
      headers: mediaUrl.startsWith(cleanBase) ? authHeaders : undefined,
      signal: controller.signal,
    });
    if (!mediaRes.ok) {
      throw Object.assign(new Error(`Gradio file download HTTP ${mediaRes.status}`), {
        statusCode: mediaRes.status,
      });
    }
    const defaultMime = params.expectedKind === 'video' ? 'video/mp4' : 'image/png';
    const rawMime = mediaRes.headers.get('content-type')?.split(';')[0]?.trim() || defaultMime;
    const mime =
      rawMime.startsWith('image/') || rawMime.startsWith('video/') ? rawMime : defaultMime;
    const buf = Buffer.from(await mediaRes.arrayBuffer());
    const b64 = buf.toString('base64');

    return {
      statusCode: 200,
      data: {
        created: Math.floor(Date.now() / 1000),
        model: params.modelName,
        ...(params.specialty ? { specialty: params.specialty } : {}),
        data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw Object.assign(new Error(`Gradio Space timeout after ${params.timeoutMs}ms`), {
        statusCode: 504,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function invokeSingleProvider(
  provider: StoredUpstreamProvider,
  payload: Record<string, unknown>
): Promise<{ statusCode: number; data: unknown }> {
  const promptText = extractPromptText(payload);

  if (provider.adapter === 'sandbox-simulator') {
    const baseDelay =
      provider.simulatorBehavior === 'latency_spike' ? 420 : 45;
    await new Promise((r) => setTimeout(r, baseDelay));

    if (provider.simulatorBehavior === 'rate_limit_429') {
      throw Object.assign(new Error('Upstream 429: Rate limit quota exceeded'), {
        statusCode: 429,
      });
    }
    if (provider.simulatorBehavior === 'server_error_503') {
      throw Object.assign(new Error('Upstream 503: Service temporarily unavailable'), {
        statusCode: 503,
      });
    }

    return {
      statusCode: 200,
      data: {
        id: `resp_${crypto.randomBytes(6).toString('hex')}`,
        model: provider.model,
        node: provider.name,
        output: `[${provider.name}] Processed unified payload (${promptText.slice(0, 120)})`,
        echo: payload,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (provider.category === 'image') {
    const cleanPrompt = promptText.slice(0, 700);
    const width = Number(payload.width) || 1024;
    const height = Number(payload.height) || 1024;
    const inputImageRaw =
      typeof payload.image_url === 'string'
        ? payload.image_url.trim()
        : typeof payload.image === 'string'
          ? payload.image.trim()
          : '';

    if (provider.baseUrl.includes('briaai-bria-rmbg-1-4.hf.space')) {
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: 'run',
        modelName: provider.model,
        timeoutMs: provider.timeoutMs,
        probeOnly: payload.__probeOnly === true,
        inputImageRaw,
        buildData: (fileRef) => [fileRef],
        preferCutoutOutput: true,
        expectedKind: 'image',
        specialty: 'bg_removal',
      });
    }

    if (provider.baseUrl.includes('not-lain-background-removal.hf.space')) {
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: 'image',
        modelName: provider.model,
        timeoutMs: provider.timeoutMs,
        probeOnly: payload.__probeOnly === true,
        inputImageRaw,
        buildData: (fileRef) => [fileRef],
        preferCutoutOutput: true,
        expectedKind: 'image',
        specialty: 'bg_removal',
      });
    }

    if (provider.baseUrl.includes('zhengpeng7-birefnet-demo.hf.space')) {
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: 'image',
        modelName: provider.model,
        timeoutMs: provider.timeoutMs,
        probeOnly: payload.__probeOnly === true,
        inputImageRaw,
        buildData: (fileRef) => [fileRef, '1024x1024', 'General'],
        preferCutoutOutput: true,
        expectedKind: 'image',
        specialty: 'bg_removal',
      });
    }

    if (provider.baseUrl.includes('black-forest-labs-flux-1-kontext-dev.hf.space')) {
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: 'infer',
        modelName: provider.model,
        timeoutMs: provider.timeoutMs,
        probeOnly: payload.__probeOnly === true,
        inputImageRaw,
        buildData: (fileRef) => [fileRef, cleanPrompt, 0, true, 2.5, 20],
        expectedKind: 'image',
        specialty: 'bg_edit',
      });
    }

    if (provider.baseUrl.includes('qwen-qwen-image-edit.hf.space')) {
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: 'infer',
        modelName: provider.model,
        timeoutMs: provider.timeoutMs,
        probeOnly: payload.__probeOnly === true,
        inputImageRaw,
        buildData: (fileRef) => [fileRef, cleanPrompt, 0, true, 4, 24, true],
        expectedKind: 'image',
        specialty: 'bg_edit',
      });
    }

    if (provider.baseUrl.includes('black-forest-labs-flux-1-schnell.hf.space')) {
      const clampedW = Math.max(512, Math.min(1024, Math.round(width / 16) * 16));
      const clampedH = Math.max(512, Math.min(1024, Math.round(height / 16) * 16));
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: 'infer',
        modelName: provider.model,
        timeoutMs: provider.timeoutMs,
        probeOnly: payload.__probeOnly === true,
        buildData: () => [cleanPrompt, 0, true, clampedW, clampedH, 4],
        expectedKind: 'image',
        specialty: 'generate',
      });
    }

    if (provider.baseUrl.includes('lllyasviel-ic-light.hf.space')) {
      const spaceRes = await fetch('https://lllyasviel-ic-light.hf.space/config');
      if (!spaceRes.ok) {
        throw Object.assign(new Error(`IC-Light Space HTTP ${spaceRes.status}`), {
          statusCode: spaceRes.status,
        });
      }
      if (payload.__probeOnly === true || !inputImageRaw) {
        return {
          statusCode: 200,
          data: {
            model: 'lllyasviel/IC-Light',
            spaceUrl: 'https://lllyasviel-ic-light.hf.space',
            gradioApi: 'https://lllyasviel-ic-light.hf.space/gradio_api/call/process_relight',
            status: 'running',
            note: 'IC-Light Space verified live (Gradio).',
          },
        };
      }
      throw Object.assign(
        new Error('IC-Light Gradio queue requires interactive upload; failing over to direct image-edit API.'),
        { statusCode: 503 }
      );
    }

    if (provider.baseUrl.includes('api.airforce')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Api.Airforce key is missing.'), { statusCode: 401 });
      }
      if (payload.__probeOnly === true) {
        const mRes = await fetch('https://api.airforce/v1/models');
        if (!mRes.ok) {
          throw Object.assign(new Error(`Api.Airforce HTTP ${mRes.status}`), {
            statusCode: mRes.status,
          });
        }
        return {
          statusCode: 200,
          data: { model: provider.model, status: 'verified' },
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(provider.timeoutMs, 28000));
      try {
        const reqBody: Record<string, unknown> = {
          model: provider.model || (inputImageRaw ? 'flux.1-kontext-pro' : 'flux-1.1-pro'),
          prompt: cleanPrompt,
          size: `${Math.min(1024, Math.max(512, width))}x${Math.min(1024, Math.max(512, height))}`,
          n: 1,
        };
        if (inputImageRaw) {
          reqBody.image = inputImageRaw;
          reqBody.image_url = inputImageRaw;
        }
        const afRes = await fetch('https://api.airforce/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });
        if (!afRes.ok) {
          const errTxt = await afRes.text();
          throw Object.assign(
            new Error(`Api.Airforce HTTP ${afRes.status}: ${errTxt.slice(0, 140)}`),
            { statusCode: afRes.status }
          );
        }
        const ct = afRes.headers.get('content-type') || '';
        if (ct.startsWith('image/')) {
          const buf = Buffer.from(await afRes.arrayBuffer());
          const b64 = buf.toString('base64');
          const mime = ct.split(';')[0] || 'image/png';
          return {
            statusCode: 200,
            data: {
              model: reqBody.model,
              specialty: provider.specialty || 'generate',
              data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
            },
          };
        }
        const json = (await afRes.json()) as {
          data?: Array<{ url?: string; b64_json?: string }>;
        };
        const first = json.data?.[0];
        if (first?.b64_json) {
          return {
            statusCode: 200,
            data: {
              model: reqBody.model,
              specialty: provider.specialty || 'generate',
              data: [
                {
                  b64_json: first.b64_json,
                  url: first.url || `data:image/png;base64,${first.b64_json}`,
                },
              ],
            },
          };
        }
        if (first?.url) {
          const resolved = await resolveImageBytes(first.url);
          if (resolved) {
            return {
              statusCode: 200,
              data: {
                model: reqBody.model,
                specialty: provider.specialty || 'generate',
                data: [
                  {
                    b64_json: resolved.base64,
                    url: `data:${resolved.mimeType};base64,${resolved.base64}`,
                  },
                ],
              },
            };
          }
          return { statusCode: 200, data: json };
        }
        throw Object.assign(new Error('Api.Airforce returned no image output.'), {
          statusCode: 502,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.baseUrl.includes('aihorde.net')) {
      const apiKey = resolveProviderApiKey(provider) || '0000000000';
      if (payload.__probeOnly === true) {
        const mRes = await fetch('https://aihorde.net/api/v2/status/models?type=image', {
          headers: { 'Client-Agent': 'AlShamsawyaStudio:1.0:studio' },
        });
        if (!mRes.ok) {
          throw Object.assign(new Error(`AI Horde HTTP ${mRes.status}`), {
            statusCode: mRes.status,
          });
        }
        return {
          statusCode: 200,
          data: { model: provider.model, status: 'live' },
        };
      }

      const controller = new AbortController();
      const totalTimeout = Math.max(provider.timeoutMs, 42000);
      const timer = setTimeout(() => controller.abort(), totalTimeout);
      try {
        let pickedModels = ['Deliberate 3.0', 'Realistic Vision', 'Dreamshaper', 'AbsoluteReality'];
        try {
          const mRes = await fetch('https://aihorde.net/api/v2/status/models?type=image', {
            headers: { 'Client-Agent': 'AlShamsawyaStudio:1.0:studio' },
            signal: AbortSignal.timeout(2500),
          });
          if (mRes.ok) {
            const list = (await mRes.json()) as Array<{
              name: string;
              count: number;
              eta: number;
            }>;
            const fastRealistic = list
              .filter(
                (m) =>
                  m.count >= 1 &&
                  m.eta <= 45 &&
                  !/anime|pony|furry|yiff|hentai|nsfw|pixel|inpainting/i.test(m.name)
              )
              .sort((a, b) => a.eta - b.eta || b.count - a.count)
              .slice(0, 4)
              .map((m) => m.name);
            if (fastRealistic.length > 0) {
              pickedModels = fastRealistic;
            }
          }
        } catch {
          // Use defaults
        }

        const isAnon = apiKey === '0000000000';
        const maxDim = isAnon ? 576 : 1024;
        const hordeW = Math.max(384, Math.min(maxDim, Math.round(width / 64) * 64));
        const hordeH = Math.max(384, Math.min(maxDim, Math.round(height / 64) * 64));

        const subRes = await fetch('https://aihorde.net/api/v2/generate/async', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
            'Client-Agent': 'AlShamsawyaStudio:1.0:studio',
          },
          body: JSON.stringify({
            prompt: `${cleanPrompt}, realistic interior photography, soft natural studio lighting ### ugly, blurry, watermark, text, distorted`,
            models: pickedModels,
            params: {
              width: hordeW,
              height: hordeH,
              steps: 14,
              n: 1,
              sampler_name: 'k_euler_a',
              cfg_scale: 7,
            },
            r2: true,
            nsfw: false,
          }),
          signal: controller.signal,
        });
        if (!subRes.ok) {
          const errTxt = await subRes.text();
          throw Object.assign(
            new Error(`AI Horde submit HTTP ${subRes.status}: ${errTxt.slice(0, 120)}`),
            { statusCode: subRes.status }
          );
        }
        const subJson = (await subRes.json()) as { id?: string };
        const jobId = subJson.id;
        if (!jobId) {
          throw Object.assign(new Error('AI Horde did not return job ID.'), { statusCode: 502 });
        }

        const deadline = Date.now() + totalTimeout - 3000;
        let done = false;
        while (Date.now() < deadline && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, 1800));
          const chkRes = await fetch(`https://aihorde.net/api/v2/generate/check/${jobId}`, {
            headers: { 'Client-Agent': 'AlShamsawyaStudio:1.0:studio' },
            signal: controller.signal,
          });
          if (!chkRes.ok) continue;
          const chkJson = (await chkRes.json()) as {
            done?: boolean;
            faulted?: boolean;
            wait_time?: number;
          };
          if (chkJson.faulted) {
            throw Object.assign(new Error('AI Horde generation faulted.'), { statusCode: 502 });
          }
          if (chkJson.done) {
            done = true;
            break;
          }
          if (
            typeof chkJson.wait_time === 'number' &&
            chkJson.wait_time > 180 &&
            Date.now() + 25000 > deadline
          ) {
            break;
          }
        }

        if (!done) {
          throw Object.assign(
            new Error('AI Horde queue wait exceeded timeout; failing over to next provider.'),
            { statusCode: 504 }
          );
        }

        const stRes = await fetch(`https://aihorde.net/api/v2/generate/status/${jobId}`, {
          headers: { 'Client-Agent': 'AlShamsawyaStudio:1.0:studio' },
          signal: controller.signal,
        });
        if (!stRes.ok) {
          throw Object.assign(new Error(`AI Horde status HTTP ${stRes.status}`), {
            statusCode: stRes.status,
          });
        }
        const stJson = (await stRes.json()) as {
          generations?: Array<{ img?: string; model?: string }>;
        };
        const firstGen = stJson.generations?.[0];
        if (!firstGen?.img) {
          throw Object.assign(new Error('AI Horde returned empty image payload.'), {
            statusCode: 502,
          });
        }

        if (firstGen.img.startsWith('http')) {
          const safeUrl = await assertSafeUpstreamUrl(firstGen.img);
          const dlRes = await fetch(safeUrl.toString(), { signal: controller.signal });
          if (!dlRes.ok) {
            throw Object.assign(new Error(`AI Horde image download HTTP ${dlRes.status}`), {
              statusCode: dlRes.status,
            });
          }
          const mime = dlRes.headers.get('content-type')?.split(';')[0] || 'image/webp';
          const b64 = Buffer.from(await dlRes.arrayBuffer()).toString('base64');
          return {
            statusCode: 200,
            data: {
              model: firstGen.model || pickedModels[0],
              specialty: 'generate',
              data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
            },
          };
        }

        const cleanB64 = firstGen.img.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        return {
          statusCode: 200,
          data: {
            model: firstGen.model || pickedModels[0],
            specialty: 'generate',
            data: [{ b64_json: cleanB64, url: `data:image/webp;base64,${cleanB64}` }],
          },
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.baseUrl.includes('ai.api.nvidia.com')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('NVIDIA NIM API key is missing.'), { statusCode: 401 });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(provider.timeoutMs, 25000));
      try {
        const nvRes = await fetch(provider.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            text_prompts: [{ text: cleanPrompt, weight: 1 }],
            cfg_scale: 5,
            sampler: 'K_EULER_ANCESTRAL',
            seed: 0,
            steps: 20,
            width: Math.min(1024, Math.max(512, Math.round(width / 64) * 64)),
            height: Math.min(1024, Math.max(512, Math.round(height / 64) * 64)),
          }),
          signal: controller.signal,
        });
        const nvJson = (await nvRes.json().catch(() => ({}))) as {
          artifacts?: Array<{ base64?: string }>;
          detail?: string;
        };
        if (!nvRes.ok) {
          throw Object.assign(
            new Error(`NVIDIA SDXL HTTP ${nvRes.status}: ${nvJson.detail || 'Error'}`),
            { statusCode: nvRes.status }
          );
        }
        const b64 = nvJson.artifacts?.[0]?.base64;
        if (!b64) {
          throw Object.assign(new Error('NVIDIA NIM SDXL returned no image artifact.'), {
            statusCode: 502,
          });
        }
        return {
          statusCode: 200,
          data: {
            model: provider.model,
            specialty: 'generate',
            data: [{ b64_json: b64, url: `data:image/jpeg;base64,${b64}` }],
          },
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.baseUrl.includes('pollinations.ai')) {
      const apiKey = resolveProviderApiKey(provider);
      const isGenApi = provider.baseUrl.includes('gen.pollinations.ai');
      let targetUrl = isGenApi
        ? `https://gen.pollinations.ai/image/${encodeURIComponent(cleanPrompt)}?model=${encodeURIComponent(provider.model || 'black-forest-labs/flux.2-klein-4b')}&width=${width}&height=${height}`
        : `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=${encodeURIComponent(provider.model || 'turbo')}&width=${width}&height=${height}&nologo=true`;
      if (inputImageRaw && inputImageRaw.startsWith('https://')) {
        targetUrl += `&image=${encodeURIComponent(inputImageRaw)}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) {
          throw Object.assign(new Error(`Pollinations HTTP ${res.status}`), {
            statusCode: res.status,
          });
        }
        const contentType = res.headers.get('content-type') || '';
        if (payload.__probeOnly !== true && contentType.startsWith('image/')) {
          const buf = Buffer.from(await res.arrayBuffer());
          const b64 = buf.toString('base64');
          const mime = contentType.split(';')[0] || 'image/jpeg';
          return {
            statusCode: 200,
            data: {
              created: Math.floor(Date.now() / 1000),
              model: provider.model || 'flux',
              specialty: provider.specialty || 'generate',
              data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
            },
          };
        }
        return {
          statusCode: 200,
          data: {
            created: Math.floor(Date.now() / 1000),
            model: provider.model || 'flux',
            specialty: provider.specialty || 'generate',
            data: [{ url: targetUrl }],
          },
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.baseUrl.includes('pixabay.com')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Pixabay API key is required.'), { statusCode: 401 });
      }
      const targetUrl = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(cleanPrompt)}&image_type=photo&per_page=4&safesearch=true`;
      const res = await fetch(targetUrl);
      const json = (await res.json()) as { hits?: Array<{ largeImageURL?: string; previewURL?: string }> };
      if (!res.ok) {
        throw Object.assign(new Error(`Pixabay HTTP ${res.status}`), { statusCode: res.status });
      }
      const hits = json.hits || [];
      return {
        statusCode: 200,
        data: {
          model: 'pixabay-stock',
          data: hits.map((h) => ({ url: h.largeImageURL || h.previewURL })),
        },
      };
    }

    if (provider.adapter === 'gemini') {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Gemini upstream key is missing.'), { statusCode: 401 });
      }
      const ai = createGeminiClient(apiKey);
      const primaryModel = provider.model || 'gemini-3.1-flash-lite-image';

      if (payload.__probeOnly === true) {
        const meta = await ai.models.get({ model: primaryModel });
        return {
          statusCode: 200,
          data: {
            model: meta.name || primaryModel,
            status: 'verified',
          },
        };
      }

      const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];
      const resolvedImg = await resolveImageBytes(inputImageRaw);
      if (resolvedImg) {
        parts.push({
          inlineData: {
            data: resolvedImg.base64,
            mimeType: resolvedImg.mimeType,
          },
        });
      }
      parts.push({ text: cleanPrompt });

      const modelsToTry = Array.from(
        new Set([primaryModel, 'gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1'])
      );
      let lastErr: unknown = null;
      for (const candidateModel of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: candidateModel,
            contents: { parts },
          });
          const outImages: Array<{ b64_json: string; url: string }> = [];
          for (const part of response.candidates?.[0]?.content?.parts ?? []) {
            if (part.inlineData?.data) {
              const mime = part.inlineData.mimeType || 'image/png';
              outImages.push({
                b64_json: part.inlineData.data,
                url: `data:${mime};base64,${part.inlineData.data}`,
              });
            }
          }
          if (outImages.length > 0) {
            return {
              statusCode: 200,
              data: {
                model: candidateModel,
                data: outImages,
              },
            };
          }
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : Object.assign(
            new Error('Gemini did not return an image part for this prompt/key.'),
            { statusCode: 502 }
          );
    }
  }

  if (provider.category === 'video') {
    const cleanPrompt = promptText.slice(0, 500);
    const startFrameRaw =
      typeof payload.start_image === 'string'
        ? payload.start_image
        : typeof payload.image_url === 'string'
          ? payload.image_url
          : typeof payload.image === 'string'
            ? payload.image
            : '';
    const endFrameRaw =
      typeof payload.end_image === 'string' ? payload.end_image : '';
    const aspectRatioRaw =
      payload.aspect_ratio === '9:16' ? '9:16' : '16:9';
    const rawDurSec = Number.parseInt(String(payload.duration || '5'), 10);
    const clampedDurSec = Number.isFinite(rawDurSec)
      ? Math.max(3, Math.min(endFrameRaw ? 10 : 15, rawDurSec))
      : 5;

    if (provider.baseUrl.includes('lightricks-ltx-video-distilled.hf.space')) {
      const ltxH = aspectRatioRaw === '9:16' ? 704 : 512;
      const ltxW = aspectRatioRaw === '9:16' ? 512 : 704;
      const ltxDur = Math.max(2, Math.min(5, clampedDurSec));
      const useI2V = Boolean(startFrameRaw);
      return await invokeGradioSpace({
        spaceBaseUrl: provider.baseUrl,
        endpoint: useI2V ? 'image_to_video' : 'text_to_video',
        modelName: provider.model,
        timeoutMs: Math.max(provider.timeoutMs, 60000),
        probeOnly: payload.__probeOnly === true,
        inputImageRaw: useI2V ? startFrameRaw : undefined,
        buildData: (fileRef) => [
          cleanPrompt,
          'worst quality, inconsistent motion, blurry, jittery, distorted',
          useI2V ? fileRef : '',
          '',
          ltxH,
          ltxW,
          useI2V ? 'image-to-video' : 'text-to-video',
          ltxDur,
          9,
          42,
          true,
          1,
          true,
        ],
        expectedKind: 'video',
      });
    }

    if (provider.baseUrl.includes('api.airforce')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Api.Airforce key is missing.'), { statusCode: 401 });
      }
      if (payload.__probeOnly === true) {
        const mRes = await fetch('https://api.airforce/v1/models');
        if (!mRes.ok) {
          throw Object.assign(new Error(`Api.Airforce HTTP ${mRes.status}`), {
            statusCode: mRes.status,
          });
        }
        return { statusCode: 200, data: { model: provider.model, status: 'verified' } };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(provider.timeoutMs, 45000));
      try {
        const videoBody: Record<string, unknown> = {
          model: provider.model || (startFrameRaw ? 'wan2.6-i2v' : 'wan2.5-t2v'),
          prompt: cleanPrompt,
          aspect_ratio: aspectRatioRaw,
          duration: clampedDurSec,
        };
        if (startFrameRaw) {
          videoBody.image = startFrameRaw;
          videoBody.image_url = startFrameRaw;
        }
        const afRes = await fetch('https://api.airforce/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(videoBody),
          signal: controller.signal,
        });
        if (!afRes.ok) {
          const errTxt = await afRes.text();
          throw Object.assign(
            new Error(`Api.Airforce Video HTTP ${afRes.status}: ${errTxt.slice(0, 140)}`),
            { statusCode: afRes.status }
          );
        }
        const ct = afRes.headers.get('content-type') || '';
        if (ct.startsWith('video/')) {
          const b64 = Buffer.from(await afRes.arrayBuffer()).toString('base64');
          const mime = ct.split(';')[0] || 'video/mp4';
          return {
            statusCode: 200,
            data: {
              model: videoBody.model,
              data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
            },
          };
        }
        const vJson = (await afRes.json()) as {
          data?: Array<{ url?: string; b64_json?: string }>;
        };
        const first = vJson.data?.[0];
        if (first?.url || first?.b64_json) {
          return { statusCode: 200, data: vJson };
        }
        throw Object.assign(new Error('Api.Airforce video returned no output.'), {
          statusCode: 502,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.baseUrl.includes('pixabay.com')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Pixabay API key is required.'), { statusCode: 401 });
      }
      const targetUrl = `https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(cleanPrompt)}&per_page=3&safesearch=true`;
      const res = await fetch(targetUrl);
      const json = (await res.json()) as { hits?: Array<{ videos?: { medium?: { url?: string } } }> };
      if (!res.ok) {
        throw Object.assign(new Error(`Pixabay Video HTTP ${res.status}`), { statusCode: res.status });
      }
      return {
        statusCode: 200,
        data: {
          model: 'pixabay-stock-video',
          data: (json.hits || []).map((h) => ({ url: h.videos?.medium?.url })),
        },
      };
    }

    if (provider.baseUrl.includes('pexels.com')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Pexels API key is required.'), { statusCode: 401 });
      }
      const targetUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(cleanPrompt)}&per_page=3`;
      const res = await fetch(targetUrl, { headers: { Authorization: apiKey } });
      const json = (await res.json()) as { videos?: Array<{ video_files?: Array<{ link?: string }> }> };
      if (!res.ok) {
        throw Object.assign(new Error(`Pexels HTTP ${res.status}`), { statusCode: res.status });
      }
      return {
        statusCode: 200,
        data: {
          model: 'pexels-stock-video',
          data: (json.videos || []).map((v) => ({ url: v.video_files?.[0]?.link })),
        },
      };
    }

    if (provider.baseUrl.includes('pollinations.ai')) {
      const apiKey = resolveProviderApiKey(provider);
      let targetUrl = `https://gen.pollinations.ai/video/${encodeURIComponent(cleanPrompt)}?model=${encodeURIComponent(provider.model || 'alibaba/wan-2.2-fast')}&aspectRatio=${encodeURIComponent(aspectRatioRaw)}&duration=${clampedDurSec}`;
      if (startFrameRaw && startFrameRaw.startsWith('https://')) {
        targetUrl += `&image=${encodeURIComponent(startFrameRaw)}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(provider.timeoutMs, 30000));
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) {
          throw Object.assign(new Error(`Pollinations Video HTTP ${res.status}`), {
            statusCode: res.status,
          });
        }
        const cType = res.headers.get('content-type') || '';
        if (payload.__probeOnly !== true && cType.startsWith('video/')) {
          const buf = Buffer.from(await res.arrayBuffer());
          const b64 = buf.toString('base64');
          const mime = cType.split(';')[0] || 'video/mp4';
          return {
            statusCode: 200,
            data: {
              model: provider.model || 'alibaba/wan-2.2-fast',
              data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
            },
          };
        }
        return {
          statusCode: 200,
          data: {
            model: provider.model || 'alibaba/wan-2.2-fast',
            data: [{ url: targetUrl }],
          },
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.adapter === 'gemini') {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Gemini upstream key is missing.'), { statusCode: 401 });
      }
      const ai = createGeminiClient(apiKey);
      const videoModel = provider.model || 'gemini-omni-1.2-flash';

      if (payload.__probeOnly === true) {
        const meta = await ai.models.get({ model: videoModel });
        return {
          statusCode: 200,
          data: {
            model: meta.name || videoModel,
            status: 'verified',
          },
        };
      }

      const startImg = await resolveImageBytes(startFrameRaw);
      const endImg = await resolveImageBytes(endFrameRaw);

      type InteractionInputItem =
        | { type: 'image'; mime_type: string; data: string }
        | { type: 'text'; text: string };
      let interactionInput: string | InteractionInputItem[] = cleanPrompt;

      if (startImg || endImg) {
        const items: InteractionInputItem[] = [];
        if (startImg) {
          items.push({
            type: 'image',
            mime_type: startImg.mimeType,
            data: startImg.base64,
          });
        }
        if (endImg) {
          items.push({
            type: 'image',
            mime_type: endImg.mimeType,
            data: endImg.base64,
          });
        }
        const defaultGuidance =
          startImg && endImg
            ? 'Smoothly animate and transition from the first frame image to the last frame image, keeping exact handmade craft textures and lighting coherent.'
            : 'Smoothly animate this handmade craft product with natural studio lighting and gentle camera motion while preserving exact textures.';
        items.push({
          type: 'text',
          text: cleanPrompt && cleanPrompt !== '{}' ? cleanPrompt : defaultGuidance,
        });
        interactionInput = items;
      }

      const interaction = await ai.interactions.create(
        {
          model: videoModel,
          input: interactionInput,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: aspectRatioRaw,
            duration: `${clampedDurSec}s`,
            resolution: '720p',
          },
        },
        { timeout: 300000 }
      );
      const videoPart = interaction.output_video;
      if (!videoPart?.data) {
        throw Object.assign(
          new Error('Gemini Omni did not return video output for this prompt/key.'),
          { statusCode: 502 }
        );
      }
      const mime = videoPart.mime_type || 'video/mp4';
      return {
        statusCode: 200,
        data: {
          model: videoModel,
          data: [{ b64_json: videoPart.data, url: `data:${mime};base64,${videoPart.data}` }],
        },
      };
    }
  }

  if (provider.category === 'audio') {
    const cleanText = promptText.slice(0, 600);
    const voice = typeof payload.voice === 'string' && payload.voice.trim()
      ? payload.voice.trim()
      : 'nova';

    if (provider.baseUrl.includes('pollinations.ai')) {
      const apiKey = resolveProviderApiKey(provider);
      const audioModel = provider.model || 'openai/tts-1';
      const targetUrl = `https://gen.pollinations.ai/audio/${encodeURIComponent(cleanText)}?model=${encodeURIComponent(audioModel)}&voice=${encodeURIComponent(voice)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) {
          throw Object.assign(new Error(`Pollinations Audio HTTP ${res.status}`), {
            statusCode: res.status,
          });
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type') || 'audio/mpeg';
        const b64 = buf.toString('base64');
        return {
          statusCode: 200,
          data: {
            model: audioModel,
            voice,
            mimeType: mime,
            url: targetUrl,
            audioBase64: b64,
            dataUrl: `data:${mime};base64,${b64}`,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (provider.baseUrl.includes('huggingface.co')) {
      const apiKey = resolveProviderApiKey(provider);
      if (!apiKey) {
        throw Object.assign(new Error('Hugging Face token required.'), { statusCode: 401 });
      }
      if (provider.specialty === 'stt') {
        const audioUrl = typeof payload.audio_url === 'string' ? payload.audio_url.trim() : '';
        if (!audioUrl) {
          const whoami = await fetch('https://huggingface.co/api/whoami-v2', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!whoami.ok) {
            throw Object.assign(new Error(`HF Token HTTP ${whoami.status}`), {
              statusCode: whoami.status,
            });
          }
          return {
            statusCode: 200,
            data: {
              model: provider.model,
              status: 'ready',
              note: 'Pass audio_url to transcribe speech with Whisper.',
            },
          };
        }
        const safeAudio = await assertSafeUpstreamUrl(audioUrl);
        const audioFetch = await fetch(safeAudio.toString());
        if (!audioFetch.ok) {
          throw Object.assign(new Error(`Audio fetch HTTP ${audioFetch.status}`), {
            statusCode: audioFetch.status,
          });
        }
        const audioBytes = await audioFetch.arrayBuffer();
        const sttRes = await fetch(provider.baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'audio/mpeg',
          },
          body: audioBytes,
        });
        const sttJson = await sttRes.json().catch(() => ({}));
        if (!sttRes.ok) {
          throw Object.assign(new Error(`HF Whisper HTTP ${sttRes.status}`), {
            statusCode: sttRes.status,
          });
        }
        return { statusCode: 200, data: sttJson };
      }

      const ttsRes = await fetch(provider.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: cleanText }),
      });
      if (!ttsRes.ok) {
        const errTxt = await ttsRes.text();
        throw Object.assign(new Error(`HF TTS HTTP ${ttsRes.status}: ${errTxt.slice(0, 140)}`), {
          statusCode: ttsRes.status,
        });
      }
      const mime = ttsRes.headers.get('content-type') || 'audio/wav';
      const b64 = Buffer.from(await ttsRes.arrayBuffer()).toString('base64');
      return {
        statusCode: 200,
        data: {
          model: provider.model,
          mimeType: mime,
          audioBase64: b64,
          dataUrl: `data:${mime};base64,${b64}`,
        },
      };
    }
  }

  if (provider.category === 'documents' && provider.baseUrl === 'internal://taygos-storyboard') {
    const cleanTitle = promptText.slice(0, 140);
    return {
      statusCode: 200,
      data: {
        model: provider.model,
        engine: 'taygos-native-storyboard',
        status: 'operational',
        title: cleanTitle,
        printableHtml: `<!doctype html><html><head><meta charset="utf-8"><title>${cleanTitle.replace(/[<>&]/g, '')}</title></head><body><h1>${cleanTitle.replace(/[<>&]/g, '')}</h1></body></html>`,
      },
    };
  }

  if (provider.adapter === 'gemini') {
    const apiKey = resolveProviderApiKey(provider);
    if (!apiKey) {
      throw Object.assign(
        new Error('Gemini upstream key is missing or unconfigured on server.'),
        { statusCode: 401 }
      );
    }
    const ai = createGeminiClient(apiKey);
    const chatModel = provider.model || 'gemini-4-hydrogen';
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            Object.assign(new Error(`Upstream timeout after ${provider.timeoutMs}ms`), {
              statusCode: 504,
            })
          ),
        provider.timeoutMs
      )
    );

    const response = await Promise.race([
      ai.models.generateContent({
        model: chatModel,
        contents: promptText,
      }),
      timeoutPromise,
    ]);

    return {
      statusCode: 200,
      data: {
        model: chatModel,
        output: response.text ?? '',
      },
    };
  }

  if (provider.baseUrl.includes('{account_id}')) {
    throw Object.assign(
      new Error('Replace {account_id} in Cloudflare Workers AI URL first.'),
      { statusCode: 400 }
    );
  }

  const parsedUrl = await assertSafeUpstreamUrl(provider.baseUrl);
  const apiKey = resolveProviderApiKey(provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs);

  try {
    let targetUrl = parsedUrl.toString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    let bodyObj: unknown = payload;

    if (provider.category === 'image' && provider.baseUrl.includes('huggingface.co')) {
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      if (provider.specialty === 'bg_removal') {
        const imgRaw =
          typeof payload.image_url === 'string'
            ? payload.image_url.trim()
            : typeof payload.image === 'string'
              ? payload.image.trim()
              : '';
        if (!imgRaw) {
          const whoami = await fetch('https://huggingface.co/api/whoami-v2', {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          });
          if (!whoami.ok) {
            throw Object.assign(new Error(`HF Token HTTP ${whoami.status}`), {
              statusCode: whoami.status,
            });
          }
          return {
            statusCode: 200,
            data: {
              model: provider.model,
              specialty: 'bg_removal',
              status: 'ready',
              note: 'HF token verified. Send image_url or data:image base64 in JSON payload to remove background.',
            },
          };
        }
        const resolvedImg = await resolveImageBytes(imgRaw);
        if (!resolvedImg) {
          throw Object.assign(new Error('Could not decode or fetch input image for RMBG.'), {
            statusCode: 400,
          });
        }
        const segRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'Content-Type': resolvedImg.mimeType || 'image/png',
          },
          body: new Uint8Array(resolvedImg.buffer),
          signal: controller.signal,
        });
        if (!segRes.ok) {
          const errTxt = await segRes.text();
          throw Object.assign(new Error(`HF RMBG HTTP ${segRes.status}: ${errTxt.slice(0, 140)}`), {
            statusCode: segRes.status,
          });
        }
        const arrBuf = await segRes.arrayBuffer();
        const b64 = Buffer.from(arrBuf).toString('base64');
        const mime = segRes.headers.get('content-type') || 'image/png';
        return {
          statusCode: 200,
          data: {
            model: provider.model,
            specialty: 'bg_removal',
            data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
          },
        };
      }

      bodyObj = { inputs: promptText };
      const imgRes = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: controller.signal,
      });
      if (!imgRes.ok) {
        const errTxt = await imgRes.text();
        throw Object.assign(new Error(`HF HTTP ${imgRes.status}: ${errTxt.slice(0, 160)}`), {
          statusCode: imgRes.status,
        });
      }
      const arrBuf = await imgRes.arrayBuffer();
      const b64 = Buffer.from(arrBuf).toString('base64');
      const mime = imgRes.headers.get('content-type') || 'image/png';
      return {
        statusCode: 200,
        data: {
          model: provider.model,
          data: [{ b64_json: b64, url: `data:${mime};base64,${b64}` }],
        },
      };
    }

    if (provider.category === 'image' && provider.adapter === 'openai-compatible') {
      if (apiKey) {
        headers[provider.authHeader || 'Authorization'] = `Bearer ${apiKey}`;
      }
      bodyObj = {
        model: provider.model,
        prompt: promptText,
        image_size: payload.size || '1024x1024',
      };
    } else if (provider.adapter === 'openai-compatible') {
      targetUrl = buildOpenAICompletionsUrl(targetUrl);
      if (apiKey) {
        headers[provider.authHeader || 'Authorization'] = `Bearer ${apiKey}`;
      }
      bodyObj = {
        model: provider.model || 'gpt-4o-mini',
        messages: Array.isArray(payload.messages)
          ? payload.messages
          : [{ role: 'user', content: promptText }],
      };
    } else if (provider.adapter === 'anthropic') {
      if (!targetUrl.endsWith('/messages')) {
        targetUrl = `${targetUrl.replace(/\/+$/, '')}/v1/messages`;
      }
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      headers['anthropic-version'] = '2023-06-01';
      bodyObj = {
        model: provider.model || 'claude-3-5-sonnet-latest',
        max_tokens: 1024,
        messages: Array.isArray(payload.messages)
          ? payload.messages
          : [{ role: 'user', content: promptText }],
      };
    } else {
      if (apiKey) {
        const hdrName = provider.authHeader || 'Authorization';
        headers[hdrName] =
          hdrName.toLowerCase() === 'authorization' &&
          !apiKey.toLowerCase().startsWith('bearer ')
            ? `Bearer ${apiKey}`
            : apiKey;
      }
      if (provider.category === 'image' || provider.category === 'video') {
        bodyObj = { model: provider.model, prompt: promptText, ...payload };
      }
    }

    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });

    const textBody = await upstreamRes.text();
    let parsedBody: unknown = textBody;
    try {
      parsedBody = JSON.parse(textBody);
    } catch {
      // Keep raw text
    }

    if (!upstreamRes.ok) {
      throw Object.assign(
        new Error(
          `Upstream HTTP ${upstreamRes.status}: ${textBody.slice(0, 180)}`
        ),
        { statusCode: upstreamRes.status }
      );
    }

    return {
      statusCode: upstreamRes.status,
      data: parsedBody,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw Object.assign(
        new Error(`Upstream timeout after ${provider.timeoutMs}ms`),
        { statusCode: 504 }
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeUpstreamProvider(
  provider: StoredUpstreamProvider
): Promise<{
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  message: string;
}> {
  const start = Date.now();
  if (!hasProviderCredentials(provider)) {
    provider.health = 'needs_key';
    provider.lastCheckedAt = new Date().toISOString();
    provider.lastError = 'Missing API key';
    persistStore();
    return {
      ok: false,
      statusCode: 401,
      latencyMs: 0,
      message: 'Requires API key',
    };
  }

  try {
    await invokeSingleProvider(provider, {
      prompt: 'Reply with OK.',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      __probeOnly: true,
    });
    const latencyMs = Math.max(1, Date.now() - start);
    provider.health = 'healthy';
    provider.consecutiveFailures = 0;
    provider.cooldownUntil = null;
    provider.lastError = null;
    provider.lastCheckedAt = new Date().toISOString();
    provider.avgLatencyMs =
      provider.avgLatencyMs === 0
        ? latencyMs
        : Math.round(provider.avgLatencyMs * 0.7 + latencyMs * 0.3);
    persistStore();
    void recordProviderStatsInDb(provider).catch(() => {});
    return { ok: true, statusCode: 200, latencyMs, message: 'Operational' };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - start);
    const statusCode =
      typeof (err as { statusCode?: unknown })?.statusCode === 'number'
        ? ((err as { statusCode: number }).statusCode)
        : 502;
    const message = err instanceof Error ? err.message : 'Probe failed';
    provider.health = 'degraded';
    provider.lastError = message;
    provider.lastCheckedAt = new Date().toISOString();
    persistStore();
    void recordProviderStatsInDb(provider).catch(() => {});
    return { ok: false, statusCode, latencyMs, message };
  }
}

function resolveDesiredSpecialty(
  category: ProviderCategory,
  payload: Record<string, unknown>
): string | null {
  const rawTask = typeof payload.task === 'string' ? payload.task.toLowerCase().trim() : '';
  if (category === 'image') {
    if (rawTask === 'remove_bg' || rawTask === 'bg_removal' || rawTask === 'rmbg') {
      return 'bg_removal';
    }
    if (
      rawTask === 'bg_edit' ||
      rawTask === 'background_relight' ||
      rawTask === 'relight' ||
      Boolean(payload.image_url || payload.image)
    ) {
      return 'bg_edit';
    }
    if (rawTask === 'generate') return 'generate';
    return 'generate';
  }
  if (category === 'audio') {
    if (rawTask === 'stt' || rawTask === 'transcribe' || Boolean(payload.audio_url)) {
      return 'stt';
    }
    return 'tts';
  }
  return null;
}

function selectOrderedCandidates(
  category: ProviderCategory = 'llm',
  payload: Record<string, unknown> = {},
  allowSandbox = true
): {
  candidates: StoredUpstreamProvider[];
  skippedAttempts: FailoverAttempt[];
} {
  const store = getStore();
  const now = Date.now();
  const skippedAttempts: FailoverAttempt[] = [];
  const activeHealthy: StoredUpstreamProvider[] = [];
  const inCooldown: StoredUpstreamProvider[] = [];
  const desiredSpecialty = resolveDesiredSpecialty(category, payload);

  for (const p of store.providers) {
    if (!p.enabled) continue;
    if (!allowSandbox && p.adapter === 'sandbox-simulator') continue;
    if ((p.category || 'llm') !== category) continue;
    if (desiredSpecialty && p.specialty && p.specialty !== desiredSpecialty) {
      continue;
    }
    if (!hasProviderCredentials(p)) {
      continue;
    }
    if (p.cooldownUntil) {
      const cooldownMs = Date.parse(p.cooldownUntil);
      if (Number.isFinite(cooldownMs) && cooldownMs > now) {
        inCooldown.push(p);
        skippedAttempts.push({
          providerId: p.id,
          providerName: p.name,
          adapter: p.adapter,
          statusCode: 503,
          latencyMs: 0,
          outcome: 'skipped_circuit',
          errorMessage: `Circuit open until ${p.cooldownUntil}`,
        });
        continue;
      }
      p.cooldownUntil = null;
      p.health = 'degraded';
    }
    activeHealthy.push(p);
  }

  // Fallback to compatible providers if no specialty match was configured
  if (activeHealthy.length === 0 && inCooldown.length === 0 && desiredSpecialty) {
    for (const p of store.providers) {
      if (
        !p.enabled ||
        (!allowSandbox && p.adapter === 'sandbox-simulator') ||
        (p.category || 'llm') !== category ||
        !hasProviderCredentials(p)
      ) {
        continue;
      }
      // Never route background removal or image editing into pure text-to-image generators
      if (
        (desiredSpecialty === 'bg_removal' || desiredSpecialty === 'bg_edit') &&
        p.specialty === 'generate' &&
        p.adapter !== 'gemini'
      ) {
        continue;
      }
      activeHealthy.push(p);
    }
  }

  let pool = activeHealthy;
  if (pool.length === 0 && inCooldown.length > 0) {
    skippedAttempts.length = 0;
    pool = [...inCooldown].sort(
      (a, b) =>
        Date.parse(a.cooldownUntil ?? '0') - Date.parse(b.cooldownUntil ?? '0')
    );
  }

  const ordered = [...pool];
  if (store.routing.strategy === 'priority_failover') {
    ordered.sort((a, b) => a.priority - b.priority);
  } else if (store.routing.strategy === 'lowest_latency') {
    ordered.sort((a, b) => {
      if (a.avgLatencyMs === 0 && b.avgLatencyMs > 0) return -1;
      if (b.avgLatencyMs === 0 && a.avgLatencyMs > 0) return 1;
      if (a.avgLatencyMs !== b.avgLatencyMs) return a.avgLatencyMs - b.avgLatencyMs;
      return a.priority - b.priority;
    });
  } else if (store.routing.strategy === 'round_robin' && ordered.length > 0) {
    ordered.sort((a, b) => a.priority - b.priority);
    const offset = store.routing.roundRobinCursor % ordered.length;
    store.routing.roundRobinCursor =
      (store.routing.roundRobinCursor + 1) % Math.max(ordered.length, 1);
    const rotated = [...ordered.slice(offset), ...ordered.slice(0, offset)];
    return { candidates: rotated, skippedAttempts };
  }

  return { candidates: ordered, skippedAttempts };
}

export async function executeUnifiedGateway(params: {
  key: StoredAccessKey;
  authMethod: 'key_pair' | 'hmac_sha256' | 'bearer_pair';
  payload: Record<string, unknown>;
  category?: ProviderCategory;
  allowSandbox?: boolean;
  fullCascade?: boolean;
}): Promise<{ httpStatus: number; body: GatewayExecutionResponse }> {
  const store = await ensureDbHydrated();
  const requestId = `req_${crypto.randomBytes(8).toString('hex')}`;
  const startAll = Date.now();
  const { candidates, skippedAttempts } = selectOrderedCandidates(
    params.category || 'llm',
    params.payload,
    params.allowSandbox ?? true
  );

  const attempts: FailoverAttempt[] = [...skippedAttempts];

  if (candidates.length === 0) {
    const totalLatencyMs = Date.now() - startAll;
    const logEntry: GatewayLogEntry = {
      id: requestId,
      timestamp: new Date().toISOString(),
      keyId: params.key.id,
      keyName: params.key.name,
      publicKey: params.key.publicKey,
      authMethod: params.authMethod,
      strategyUsed: store.routing.strategy,
      attempts,
      finalProviderId: null,
      finalProviderName: null,
      status: 'failed',
      statusCode: 503,
      totalLatencyMs,
      failoverTriggered: false,
      payloadPreview: JSON.stringify(params.payload).slice(0, 160),
      responsePreview: 'No configured upstream providers available.',
    };
    appendGatewayLog(logEntry);
    return {
      httpStatus: 503,
      body: {
        ok: false,
        requestId,
        failoverTriggered: false,
        totalLatencyMs,
        attempts,
        error:
          'No configured upstream providers are available. Add an API key to a provider or enable a sandbox node.',
      },
    };
  }

  const maxAttempts = params.fullCascade
    ? candidates.length
    : Math.min(candidates.length, store.routing.maxRetries + 1);
  let failedAttemptCount = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const provider = candidates[i];
    const attemptStart = Date.now();
    provider.totalRequests += 1;

    try {
      const result = await invokeSingleProvider(provider, params.payload);
      const latencyMs = Math.max(1, Date.now() - attemptStart);

      provider.successfulRequests += 1;
      provider.consecutiveFailures = 0;
      provider.health = 'healthy';
      provider.cooldownUntil = null;
      provider.lastError = null;
      provider.lastCheckedAt = new Date().toISOString();
      provider.avgLatencyMs =
        provider.avgLatencyMs === 0
          ? latencyMs
          : Math.round(provider.avgLatencyMs * 0.7 + latencyMs * 0.3);

      attempts.push({
        providerId: provider.id,
        providerName: provider.name,
        adapter: provider.adapter,
        statusCode: result.statusCode,
        latencyMs,
        outcome: 'success',
      });

      const failoverTriggered =
        failedAttemptCount > 0 || skippedAttempts.length > 0;
      params.key.requestCount += 1;
      params.key.lastUsedAt = new Date().toISOString();
      if (failoverTriggered) {
        params.key.failoverCount += 1;
      }
      persistStore();
      void recordKeyUsageInDb(params.key).catch(() => {});
      void recordProviderStatsInDb(provider).catch(() => {});

      const totalLatencyMs = Math.max(1, Date.now() - startAll);
      appendGatewayLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        keyId: params.key.id,
        keyName: params.key.name,
        publicKey: params.key.publicKey,
        authMethod: params.authMethod,
        strategyUsed: store.routing.strategy,
        attempts,
        finalProviderId: provider.id,
        finalProviderName: provider.name,
        status: 'success',
        statusCode: result.statusCode,
        totalLatencyMs,
        failoverTriggered,
        payloadPreview: JSON.stringify(params.payload).slice(0, 160),
        responsePreview: JSON.stringify(result.data).slice(0, 220),
      });

      return {
        httpStatus: 200,
        body: {
          ok: true,
          requestId,
          provider: {
            id: provider.id,
            name: provider.name,
            adapter: provider.adapter,
            model: provider.model,
          },
          failoverTriggered,
          totalLatencyMs,
          attempts,
          data: result.data,
        },
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - attemptStart);
      const statusCode =
        typeof (err as { statusCode?: unknown })?.statusCode === 'number'
          ? ((err as { statusCode: number }).statusCode)
          : 502;
      const errMsg = err instanceof Error ? err.message : 'Upstream provider error';

      failedAttemptCount += 1;
      provider.failedRequests += 1;
      provider.consecutiveFailures += 1;
      provider.lastError = errMsg;
      provider.lastCheckedAt = new Date().toISOString();

      if (provider.consecutiveFailures >= store.routing.circuitBreakerThreshold) {
        provider.health = 'circuit_open';
        provider.cooldownUntil = new Date(
          Date.now() + store.routing.cooldownSeconds * 1000
        ).toISOString();
      } else {
        provider.health = 'degraded';
      }

      attempts.push({
        providerId: provider.id,
        providerName: provider.name,
        adapter: provider.adapter,
        statusCode,
        latencyMs,
        outcome: 'failed',
        errorMessage: errMsg,
      });
      void recordProviderStatsInDb(provider).catch(() => {});
    }
  }

  params.key.requestCount += 1;
  params.key.lastUsedAt = new Date().toISOString();
  persistStore();
  void recordKeyUsageInDb(params.key).catch(() => {});

  const totalLatencyMs = Math.max(1, Date.now() - startAll);
  appendGatewayLog({
    id: requestId,
    timestamp: new Date().toISOString(),
    keyId: params.key.id,
    keyName: params.key.name,
    publicKey: params.key.publicKey,
    authMethod: params.authMethod,
    strategyUsed: store.routing.strategy,
    attempts,
    finalProviderId: null,
    finalProviderName: null,
    status: 'failed',
    statusCode: 502,
    totalLatencyMs,
    failoverTriggered: failedAttemptCount > 1 || (skippedAttempts.length > 0 && failedAttemptCount >= 1),
    payloadPreview: JSON.stringify(params.payload).slice(0, 160),
    responsePreview: 'All upstream providers failed during failover chain.',
  });

  return {
    httpStatus: 502,
    body: {
      ok: false,
      requestId,
      failoverTriggered: failedAttemptCount > 1 || (skippedAttempts.length > 0 && failedAttemptCount >= 1),
      totalLatencyMs,
      attempts,
      error: 'All configured upstream providers failed. Inspect attempts for details.',
    },
  };
}
