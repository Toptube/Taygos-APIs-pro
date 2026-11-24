import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  authenticateGatewayRequest,
  executeUnifiedGateway,
  probeUpstreamProvider,
} from './server/gateway.ts';
import {
  assertSafeUpstreamUrl,
  createAdminSessionToken,
  hasPersistentMasterKey,
  maskCredential,
  sealSecret,
  verifyAdminSessionToken,
} from './server/security.ts';
import {
  isFirebaseAuthConfigured,
  verifyFirebaseAdminBearer,
} from './server/firebaseAuth.ts';
import {
  addUpstreamProviderRecord,
  claimInitialAdminPassword,
  getStore,
  isAdminSetupRequired,
  isEnvPasscodeConfigured,
  persistStore,
  revealAccessKeySecret,
  rotateAccessKeySecret,
  syncCloudVaultToStore,
  toPublicKeyView,
  toPublicProviderView,
  verifyAdminPasscode,
  createAccessKeyRecord,
} from './server/store.ts';
import type {
  ProviderAdapter,
  ProviderCategory,
  RoutingStrategy,
  SimulatorBehavior,
} from './src/types/taygos.ts';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

const PORT = 3000;

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return '';
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req);
  if (verifyAdminSessionToken(token)) {
    next();
    return;
  }
  const firebaseUser = await verifyFirebaseAdminBearer(token);
  if (firebaseUser) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized admin session.' });
}

function getBaseOrigin(req: Request): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && appUrl !== 'MY_APP_URL') {
    return appUrl.replace(/\/+$/, '');
  }
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ||
    req.protocol ||
    'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

async function startServer(): Promise<void> {
  // Sync latest catalog providers on startup
  getStore();
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf.toString('utf8');
      },
    })
  );

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'taygos-apis', timestamp: new Date().toISOString() });
  });

  // Public API Gateway CORS (for external client apps consuming the unified endpoint)
  app.use('/api/v1', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Taygos-Public-Key, X-Taygos-Secret-Key, X-Taygos-Timestamp, X-Taygos-Signature'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Public Unified Gateway Endpoints
  const handleGatewayDispatch = async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({ ok: false, error: auth.error });
      return;
    }

    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const category: ProviderCategory =
      payload.category === 'image' ||
      payload.category === 'video' ||
      payload.category === 'audio' ||
      payload.category === 'documents'
        ? payload.category
        : 'llm';

    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload,
      category,
    });
    res.status(result.httpStatus).json(result.body);
  };

  app.post('/api/v1/gateway', handleGatewayDispatch);
  app.post('/api/v1/dispatch', handleGatewayDispatch);

  // OpenAI-Compatible Chat Completions Endpoint (for AI Chat Apps & SDKs)
  app.post('/api/v1/chat/completions', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }

    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload,
      category: 'llm',
      allowSandbox: false,
    });

    if (!result.body.ok) {
      res.status(result.httpStatus).json({
        error: {
          message: result.body.error || 'Upstream failover exhausted.',
          type: 'gateway_error',
        },
        taygos: {
          requestId: result.body.requestId,
          failoverTriggered: result.body.failoverTriggered,
          attempts: result.body.attempts,
        },
      });
      return;
    }

    const rawData = result.body.data as Record<string, unknown> | undefined;
    let assistantText = '';
    if (typeof rawData?.output === 'string') {
      assistantText = rawData.output;
    } else if (
      Array.isArray(rawData?.choices) &&
      rawData.choices[0] &&
      typeof (rawData.choices[0] as { message?: { content?: unknown } })?.message
        ?.content === 'string'
    ) {
      assistantText = (
        rawData.choices[0] as { message: { content: string } }
      ).message.content;
    } else if (
      Array.isArray(rawData?.content) &&
      rawData.content[0] &&
      typeof (rawData.content[0] as { text?: unknown })?.text === 'string'
    ) {
      assistantText = (rawData.content[0] as { text: string }).text;
    } else {
      assistantText = JSON.stringify(rawData ?? {});
    }

    res.status(200).json({
      id: result.body.requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.body.provider?.model || 'taygos-unified',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: assistantText,
          },
          finish_reason: 'stop',
        },
      ],
      taygos: {
        requestId: result.body.requestId,
        provider: result.body.provider,
        failoverTriggered: result.body.failoverTriggered,
        totalLatencyMs: result.body.totalLatencyMs,
        attempts: result.body.attempts,
      },
    });
  });

  // Unified Image & Product Background Generation Endpoint (OpenAI Images Compatible)
  app.post('/api/v1/images/generations', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload,
      category: 'image',
      allowSandbox: false,
    });
    res.status(result.httpStatus).json(result.body);
  });

  // Unified Video Generation & Stock Video Endpoint
  app.post('/api/v1/videos/generations', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload,
      category: 'video',
      allowSandbox: false,
    });
    res.status(result.httpStatus).json(result.body);
  });

  // Unified Audio Text-to-Speech (TTS) Endpoint (OpenAI Audio Speech Compatible)
  app.post('/api/v1/audio/speech', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const promptVal =
      typeof payload.input === 'string'
        ? payload.input
        : typeof payload.prompt === 'string'
          ? payload.prompt
          : '';
    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload: { ...payload, prompt: promptVal, task: 'tts' },
      category: 'audio',
      allowSandbox: false,
    });
    res.status(result.httpStatus).json(result.body);
  });

  // Unified Audio Speech-to-Text (STT / Whisper) Endpoint
  app.post('/api/v1/audio/transcriptions', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload: { ...payload, task: 'stt' },
      category: 'audio',
      allowSandbox: false,
    });
    res.status(result.httpStatus).json(result.body);
  });

  // Unified Zero-Dependency Storyboard & Printable PDF-Ready Endpoint
  app.post('/api/v1/documents/storyboard', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }

    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const idea = typeof payload.idea === 'string' ? payload.idea.trim() : '';
    const images = Array.isArray(payload.images)
      ? payload.images
          .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
          .slice(0, 12)
      : [];

    if (!idea && images.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Provide "idea" text or an array of "images" URLs.',
      });
      return;
    }

    const scenes: Array<{ index: number; caption: string; imageUrl: string }> = [];
    if (images.length > 0) {
      images.forEach((imgUrl, idx) => {
        scenes.push({
          index: idx + 1,
          caption: idea ? `${idea} — Scene ${idx + 1}` : `Scene ${idx + 1}`,
          imageUrl: imgUrl,
        });
      });
    } else {
      const count = Math.max(2, Math.min(6, Number(payload.scenesCount) || 4));
      const llmRes = await executeUnifiedGateway({
        key: auth.key,
        authMethod: auth.authMethod,
        category: 'llm',
        allowSandbox: false,
        payload: {
          prompt: `Break this idea into ${count} short visual storyboard scenes (one concise English image prompt per line, numbered 1..${count}, plain text only): ${idea}`,
        },
      });
      const rawData = llmRes.body.data as Record<string, unknown> | undefined;
      let rawText = idea;
      if (typeof rawData?.output === 'string') {
        rawText = rawData.output;
      } else if (
        Array.isArray(rawData?.choices) &&
        rawData.choices[0] &&
        typeof (rawData.choices[0] as { message?: { content?: unknown } })?.message
          ?.content === 'string'
      ) {
        rawText = (rawData.choices[0] as { message: { content: string } }).message.content;
      } else if (
        Array.isArray(rawData?.content) &&
        rawData.content[0] &&
        typeof (rawData.content[0] as { text?: unknown })?.text === 'string'
      ) {
        rawText = (rawData.content[0] as { text: string }).text;
      }
      const lines = rawText
        .split(/\r?\n/)
        .map((s) => s.replace(/^[\d.\-*)\s"]+/, '').trim())
        .filter((s) => s.length > 6)
        .slice(0, count);
      const scenePrompts = lines.length > 0 ? lines : [idea];
      scenePrompts.forEach((sceneText, idx) => {
        scenes.push({
          index: idx + 1,
          caption: sceneText.slice(0, 180),
          imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(sceneText.slice(0, 220))}?model=flux&width=1024&height=576&nologo=true`,
        });
      });
    }

    const printableHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Taygos Storyboard</title><style>body{font-family:sans-serif;padding:24px;max-width:800px;margin:auto}figure{margin:0 0 24px;page-break-inside:avoid}img{width:100%;border-radius:8px}figcaption{margin-top:8px;font-size:14px;color:#1e293b}</style></head><body><h1>${idea ? idea.replace(/[<>&]/g, '') : 'Taygos Storyboard'}</h1>${scenes.map((s) => `<figure><img src="${s.imageUrl}" alt="Scene ${s.index}"/><figcaption>${s.index}. ${s.caption.replace(/[<>&]/g, '')}</figcaption></figure>`).join('')}</body></html>`;

    res.status(200).json({
      ok: true,
      scenes,
      printableHtml,
    });
  });

  // Companion Unified PDF / Document HTML Render Endpoint
  app.post('/api/v1/documents/pdf', async (req: RawBodyRequest, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const auth = authenticateGatewayRequest(req.headers, rawBody);
    if (!auth.ok || !auth.key || !auth.authMethod) {
      res.status(auth.statusCode).json({
        error: { message: auth.error || 'Unauthorized', type: 'authentication_error' },
      });
      return;
    }
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const result = await executeUnifiedGateway({
      key: auth.key,
      authMethod: auth.authMethod,
      payload,
      category: 'documents',
      allowSandbox: false,
    });
    res.status(result.httpStatus).json(result.body);
  });

  app.get('/api/v1/status', (req: RawBodyRequest, res: Response) => {
    const auth = authenticateGatewayRequest(req.headers, '');
    if (!auth.ok || !auth.key) {
      res.status(auth.statusCode).json({ ok: false, error: auth.error });
      return;
    }
    const store = getStore();
    const healthyProviders = store.providers.filter(
      (p) => p.enabled && p.health !== 'circuit_open'
    ).length;

    res.json({
      ok: true,
      key: {
        id: auth.key.id,
        name: auth.key.name,
        perpetual: auth.key.perpetual,
        status: auth.key.status,
      },
      routingStrategy: store.routing.strategy,
      healthyProviders,
      totalEnabledProviders: store.providers.filter((p) => p.enabled).length,
    });
  });

  // Admin Authentication Routes
  app.get('/api/admin/auth/status', async (req, res) => {
    const token = extractBearerToken(req);
    const authenticated =
      verifyAdminSessionToken(token) || Boolean(await verifyFirebaseAdminBearer(token));
    res.json({
      requiresSetup: isAdminSetupRequired(),
      envPasscodeActive: isEnvPasscodeConfigured(),
      authenticated,
      firebaseEnabled: isFirebaseAuthConfigured(),
    });
  });

  app.post('/api/admin/auth/claim', (req, res) => {
    if (!isAdminSetupRequired()) {
      res.status(409).json({ error: 'Admin passcode is already configured.' });
      return;
    }
    const password =
      typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Passcode must be between 6 and 128 characters.' });
      return;
    }
    const ok = claimInitialAdminPassword(password);
    if (!ok) {
      res.status(409).json({ error: 'Admin passcode is already claimed.' });
      return;
    }
    const token = createAdminSessionToken();
    res.status(201).json({ token });
  });

  app.post('/api/admin/auth/login', (req, res) => {
    if (isAdminSetupRequired()) {
      res.status(400).json({ error: 'Initial admin setup is required first.' });
      return;
    }
    const password =
      typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password || !verifyAdminPasscode(password)) {
      res.status(401).json({ error: 'Invalid admin passcode.' });
      return;
    }
    const token = createAdminSessionToken();
    res.json({ token });
  });

  app.post('/api/admin/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/admin/cloud/sync', requireAdminAuth, async (req, res) => {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : {};
    const accessKeys = Array.isArray(body.accessKeys) ? body.accessKeys : [];
    const providers = Array.isArray(body.providers) ? body.providers : [];
    const routing =
      body.routing && typeof body.routing === 'object' ? body.routing : null;

    const result = await syncCloudVaultToStore({
      accessKeys,
      providers,
      routing,
    });
    res.json({ ok: true, ...result });
  });

  // Protected Admin Routes
  app.get('/api/admin/overview', requireAdminAuth, (req, res) => {
    const store = getStore();
    const providerViews = store.providers.map(toPublicProviderView);
    const activeKeys = store.keys.filter((k) => k.status === 'active').length;
    const configuredProviders = providerViews.filter(
      (p) => p.enabled && p.keyConfigured
    ).length;
    const healthyProviders = providerViews.filter(
      (p) => p.enabled && p.keyConfigured && p.health !== 'circuit_open'
    ).length;
    const totalFreeModels = providerViews.reduce(
      (sum, p) => sum + (p.freeModelsCount ?? 0),
      0
    );
    const totalRequests = store.logs.length;
    const successCount = store.logs.filter((l) => l.status === 'success').length;
    const failoverRecoveries = store.logs.filter(
      (l) => l.status === 'success' && l.failoverTriggered
    ).length;

    res.json({
      keys: store.keys.map(toPublicKeyView),
      providers: providerViews,
      routing: store.routing,
      logs: store.logs,
      stats: {
        activeKeys,
        healthyProviders,
        configuredProviders,
        totalProviders: store.providers.length,
        totalFreeModels,
        totalRequests,
        failoverRecoveries,
        successRate:
          totalRequests === 0 ? 100 : Math.round((successCount / totalRequests) * 100),
      },
      gatewayEndpointUrl: `${getBaseOrigin(req)}/api/v1/gateway`,
      hasMasterEncryptionKey: hasPersistentMasterKey(),
      hasGeminiEnvKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  // Access Keys CRUD
  app.post('/api/admin/keys', requireAdminAuth, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) {
      res.status(400).json({ error: 'Key name is required (max 80 chars).' });
      return;
    }
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim().slice(0, 200)
        : '';
    const scopes = Array.isArray(req.body?.scopes)
      ? req.body.scopes
          .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
          .slice(0, 8)
      : ['gateway:execute', 'ai:generate'];
    const requireHmac = Boolean(req.body?.requireHmac);

    const { stored, plainSecret } = createAccessKeyRecord({
      name,
      description,
      scopes,
      requireHmac,
    });

    res.status(201).json({
      key: toPublicKeyView(stored),
      secretKey: plainSecret,
    });
  });

  app.patch('/api/admin/keys/:id', requireAdminAuth, (req, res) => {
    const store = getStore();
    const target = store.keys.find((k) => k.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      target.name = req.body.name.trim().slice(0, 80);
    }
    if (typeof req.body?.description === 'string') {
      target.description = req.body.description.trim().slice(0, 200);
    }
    if (req.body?.status === 'active' || req.body?.status === 'revoked') {
      target.status = req.body.status;
    }
    if (typeof req.body?.requireHmac === 'boolean') {
      target.requireHmac = req.body.requireHmac;
    }
    persistStore();
    res.json({ key: toPublicKeyView(target) });
  });

  app.post('/api/admin/keys/:id/rotate', requireAdminAuth, (req, res) => {
    const rotated = rotateAccessKeySecret(String(req.params.id));
    if (!rotated) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    res.json({
      key: toPublicKeyView(rotated.stored),
      secretKey: rotated.plainSecret,
    });
  });

  app.post('/api/admin/keys/:id/reveal', requireAdminAuth, (req, res) => {
    const revealed = revealAccessKeySecret(String(req.params.id));
    if (!revealed) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    res.json({
      id: revealed.key.id,
      name: revealed.key.name,
      publicKey: revealed.key.publicKey,
      secretKey: revealed.secretKey,
      requiresRotation: !revealed.secretKey,
      message: revealed.secretKey
        ? undefined
        : 'This key was created before TAYGOS_MASTER_KEY was persisted. Click Rotate to generate a newly viewable secret.',
    });
  });

  app.delete('/api/admin/keys/:id', requireAdminAuth, (req, res) => {
    const store = getStore();
    const before = store.keys.length;
    store.keys = store.keys.filter((k) => k.id !== req.params.id);
    if (store.keys.length === before) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    persistStore();
    res.json({ ok: true });
  });

  // Upstream Providers CRUD
  app.post('/api/admin/providers', requireAdminAuth, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const adapter = req.body?.adapter as ProviderAdapter;
    const allowedAdapters: ProviderAdapter[] = [
      'gemini',
      'openai-compatible',
      'anthropic',
      'custom-rest',
      'sandbox-simulator',
    ];
    if (!name || name.length > 80 || !allowedAdapters.includes(adapter)) {
      res.status(400).json({ error: 'Invalid provider name or adapter type.' });
      return;
    }

    let baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    const usesServerEnv = Boolean(req.body?.usesServerEnv) && adapter === 'gemini';
    const apiKeyPlain =
      typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

    if (adapter === 'sandbox-simulator') {
      baseUrl = `sandbox://${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    } else if (adapter === 'gemini') {
      baseUrl = 'https://generativelanguage.googleapis.com';
    } else {
      try {
        const validated = await assertSafeUpstreamUrl(baseUrl);
        baseUrl = validated.toString();
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid upstream URL.',
        });
        return;
      }
    }

    const priorityNum = Number(req.body?.priority);
    const weightNum = Number(req.body?.weight);
    const timeoutNum = Number(req.body?.timeoutMs);

    const category: ProviderCategory =
      req.body?.category === 'image' ||
      req.body?.category === 'video' ||
      req.body?.category === 'audio' ||
      req.body?.category === 'documents'
        ? req.body.category
        : 'llm';

    const provider = addUpstreamProviderRecord({
      name,
      category,
      specialty:
        typeof req.body?.specialty === 'string'
          ? req.body.specialty.trim().slice(0, 80)
          : undefined,
      adapter,
      baseUrl,
      model:
        typeof req.body?.model === 'string' && req.body.model.trim()
          ? req.body.model.trim().slice(0, 80)
          : adapter === 'gemini'
            ? 'gemini-4-hydrogen'
            : 'default',
      authHeader:
        typeof req.body?.authHeader === 'string' && req.body.authHeader.trim()
          ? req.body.authHeader.trim().slice(0, 40)
          : 'Authorization',
      apiKeyPlain,
      usesServerEnv,
      priority: Number.isFinite(priorityNum) ? Math.max(1, Math.min(99, priorityNum)) : 5,
      weight: Number.isFinite(weightNum) ? Math.max(1, Math.min(100, weightNum)) : 50,
      timeoutMs: Number.isFinite(timeoutNum)
        ? Math.max(1000, Math.min(30000, timeoutNum))
        : 8000,
      simulatorBehavior: (['healthy', 'rate_limit_429', 'server_error_503', 'latency_spike'].includes(
        req.body?.simulatorBehavior
      )
        ? req.body.simulatorBehavior
        : 'healthy') as SimulatorBehavior,
    });

    res.status(201).json({ provider: toPublicProviderView(provider) });
  });

  app.post('/api/admin/providers/bulk', requireAdminAuth, async (req, res) => {
    const items = Array.isArray(req.body?.providers) ? req.body.providers : null;
    if (!items || items.length === 0 || items.length > 200) {
      res.status(400).json({
        error: 'Provide a "providers" array with 1 to 200 items.',
      });
      return;
    }

    const allowedAdapters: ProviderAdapter[] = [
      'gemini',
      'openai-compatible',
      'anthropic',
      'custom-rest',
      'sandbox-simulator',
    ];

    const created: ReturnType<typeof toPublicProviderView>[] = [];
    const errors: { index: number; name: string; error: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const adapter = item?.adapter as ProviderAdapter;

      if (!name || name.length > 80 || !allowedAdapters.includes(adapter)) {
        errors.push({
          index: i,
          name: name || `#${i + 1}`,
          error: 'Invalid name or adapter.',
        });
        continue;
      }

      let baseUrl = typeof item?.baseUrl === 'string' ? item.baseUrl.trim() : '';
      const usesServerEnv = Boolean(item?.usesServerEnv) && adapter === 'gemini';
      const apiKeyPlain = typeof item?.apiKey === 'string' ? item.apiKey.trim() : '';

      if (adapter === 'sandbox-simulator') {
        baseUrl = `sandbox://${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      } else if (adapter === 'gemini') {
        baseUrl = 'https://generativelanguage.googleapis.com';
      } else {
        try {
          const validated = await assertSafeUpstreamUrl(baseUrl);
          baseUrl = validated.toString();
        } catch (err) {
          errors.push({
            index: i,
            name,
            error: err instanceof Error ? err.message : 'Invalid upstream URL.',
          });
          continue;
        }
      }

      const priorityNum = Number(item?.priority);
      const timeoutNum = Number(item?.timeoutMs);

      const itemCategory: ProviderCategory =
        item?.category === 'image' ||
        item?.category === 'video' ||
        item?.category === 'audio' ||
        item?.category === 'documents'
          ? item.category
          : 'llm';

      const provider = addUpstreamProviderRecord({
        name,
        category: itemCategory,
        adapter,
        baseUrl,
        model:
          typeof item?.model === 'string' && item.model.trim()
            ? item.model.trim().slice(0, 80)
            : adapter === 'gemini'
              ? 'gemini-4-hydrogen'
              : 'default',
        authHeader:
          typeof item?.authHeader === 'string' && item.authHeader.trim()
            ? item.authHeader.trim().slice(0, 40)
            : 'Authorization',
        apiKeyPlain,
        usesServerEnv,
        priority: Number.isFinite(priorityNum)
          ? Math.max(1, Math.min(999, priorityNum))
          : 10 + i,
        weight: 50,
        timeoutMs: Number.isFinite(timeoutNum)
          ? Math.max(1000, Math.min(30000, timeoutNum))
          : 8000,
        simulatorBehavior: 'healthy',
      });
      created.push(toPublicProviderView(provider));
    }

    res.status(201).json({
      createdCount: created.length,
      errorCount: errors.length,
      providers: created,
      errors,
    });
  });

  app.post('/api/admin/providers/import-url', requireAdminAuth, async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Please provide a valid HTTPS URL.' });
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = await assertSafeUpstreamUrl(rawUrl);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid URL.',
      });
      return;
    }

    const allowedHosts = new Set([
      'github.com',
      'www.github.com',
      'raw.githubusercontent.com',
      'api.github.com',
      'openrouter.ai',
    ]);
    if (!allowedHosts.has(targetUrl.hostname.toLowerCase())) {
      res.status(400).json({
        error:
          'Only GitHub (github.com / raw.githubusercontent.com / api.github.com) and OpenRouter (openrouter.ai) URLs are allowed for catalog extraction.',
      });
      return;
    }

    // Normalize github.com/owner/repo/blob/branch/path -> raw.githubusercontent.com
    let fetchUrls: string[] = [targetUrl.toString()];
    const hostLower = targetUrl.hostname.toLowerCase();
    if (hostLower === 'github.com' || hostLower === 'www.github.com') {
      const cleanPath = targetUrl.pathname.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
      const parts = cleanPath.split('/');
      if (parts.length >= 5 && parts[2] === 'blob') {
        const [owner, repo, , branch, ...rest] = parts;
        fetchUrls = [
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join('/')}`,
        ];
      } else if (parts.length >= 2) {
        const [owner, repo] = parts;
        fetchUrls = [
          `https://raw.githubusercontent.com/${owner}/${repo}/main/status.json`,
          `https://raw.githubusercontent.com/${owner}/${repo}/master/status.json`,
          `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
          `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
        ];
      }
    }

    let fetchedText = '';
    let resolvedUrl = '';
    for (const candidate of fetchUrls) {
      try {
        const safe = await assertSafeUpstreamUrl(candidate);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const upstreamRes = await fetch(safe.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json, text/plain, text/markdown, */*' },
        });
        clearTimeout(timer);
        if (upstreamRes.ok) {
          fetchedText = await upstreamRes.text();
          resolvedUrl = safe.toString();
          break;
        }
      } catch {
        // Try next candidate URL
      }
    }

    if (!fetchedText) {
      res.status(422).json({
        error:
          'Could not fetch readable catalog content (JSON or Markdown) from that URL.',
      });
      return;
    }

    const store = getStore();
    const existingKeys = new Set(
      store.providers.map(
        (p) => `${p.baseUrl.replace(/\/+$/, '').toLowerCase()}::${p.model.toLowerCase()}`
      )
    );

    const extracted: Array<{
      name: string;
      adapter: ProviderAdapter;
      baseUrl: string;
      model: string;
      tagline?: string;
      apiKeyUrl?: string;
      freeModelsCount?: number;
    }> = [];

    // 1) Try JSON parsing (OpenRouter /api/v1/models or status.json or provider array)
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(fetchedText);
    } catch {
      parsedJson = null;
    }

    if (parsedJson && typeof parsedJson === 'object') {
      const obj = parsedJson as Record<string, unknown>;
      // Format A: OpenRouter models API { data: [ { id, name, pricing } ] }
      if (Array.isArray(obj.data) && resolvedUrl.includes('openrouter.ai')) {
        const freeModels = obj.data.filter((m): m is Record<string, unknown> => {
          if (!m || typeof m !== 'object') return false;
          const id = typeof m.id === 'string' ? m.id : '';
          const pricing = m.pricing as Record<string, unknown> | undefined;
          return (
            id.endsWith(':free') ||
            (pricing?.prompt === '0' && pricing?.completion === '0')
          );
        });
        for (const m of freeModels.slice(0, 12)) {
          const modelId = String(m.id);
          const modelName =
            typeof m.name === 'string' ? m.name.slice(0, 60) : modelId;
          extracted.push({
            name: `OpenRouter (${modelName})`,
            adapter: 'openai-compatible',
            baseUrl: 'https://openrouter.ai/api/v1',
            model: modelId,
            tagline: 'Free tier model imported from OpenRouter catalog',
            apiKeyUrl: 'https://openrouter.ai/workspaces/default/keys',
            freeModelsCount: freeModels.length,
          });
        }
      } else {
        // Format B: status.json { providers: [...] } or raw array
        const list = Array.isArray(parsedJson)
          ? parsedJson
          : Array.isArray(obj.providers)
            ? obj.providers
            : [];
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue;
          const rec = entry as Record<string, unknown>;
          const name =
            typeof rec.name === 'string'
              ? rec.name.trim()
              : typeof rec.provider === 'string'
                ? rec.provider.trim()
                : '';
          const baseUrl =
            typeof rec.api_base === 'string'
              ? rec.api_base.trim()
              : typeof rec.baseUrl === 'string'
                ? rec.baseUrl.trim()
                : '';
          if (!name || !baseUrl.startsWith('https://')) continue;

          const modelsArr = Array.isArray(rec.models) ? rec.models : [];
          const firstModel =
            modelsArr.length > 0 &&
            typeof (modelsArr[0] as Record<string, unknown>)?.id === 'string'
              ? String((modelsArr[0] as Record<string, unknown>).id)
              : typeof rec.model === 'string'
                ? rec.model.trim()
                : 'default';

          const adapter: ProviderAdapter = baseUrl.includes(
            'generativelanguage.googleapis.com'
          )
            ? 'gemini'
            : baseUrl.includes('anthropic.com')
              ? 'anthropic'
              : 'openai-compatible';

          extracted.push({
            name: name.slice(0, 80),
            adapter,
            baseUrl,
            model: firstModel.slice(0, 80),
            tagline:
              typeof rec.tagline === 'string' ? rec.tagline.slice(0, 120) : undefined,
            apiKeyUrl:
              typeof rec.api_key_url === 'string' ? rec.api_key_url : undefined,
            freeModelsCount: modelsArr.length || undefined,
          });
        }
      }
    } else {
      // 2) Fallback: Extract HTTPS API base URLs from README / Markdown
      const urlMatches = fetchedText.match(/https:\/\/[a-zA-Z0-9.-]+\/[^\s)"'`<>]+/g) || [];
      const seenHosts = new Set<string>();
      for (const rawCandidate of urlMatches) {
        const cleaned = rawCandidate.replace(/[.,;:]+$/, '');
        if (!/\/(v1|v1beta|v2|v4|openai|api)(\/|$)/i.test(cleaned)) continue;
        try {
          const u = new URL(cleaned);
          const h = u.hostname.toLowerCase();
          if (
            h.includes('github.com') ||
            h.includes('shields.io') ||
            h.includes('githubusercontent.com') ||
            seenHosts.has(h)
          ) {
            continue;
          }
          seenHosts.add(h);
          const providerBase = `${u.origin}${u.pathname.replace(/\/chat\/completions.*$/, '')}`;
          const friendlyName = h
            .replace(/^(api|integrate\.api|inference|models)\./, '')
            .split('.')[0];
          extracted.push({
            name: `${friendlyName.charAt(0).toUpperCase()}${friendlyName.slice(1)} (Imported)`,
            adapter: h.includes('generativelanguage.googleapis.com')
              ? 'gemini'
              : 'openai-compatible',
            baseUrl: providerBase,
            model: 'default',
            tagline: `Extracted from ${resolvedUrl}`,
          });
        } catch {
          // Ignore malformed URL
        }
      }
    }

    const created: ReturnType<typeof toPublicProviderView>[] = [];
    let skipped = 0;
    let nextPriority =
      store.providers.reduce((max, p) => Math.max(max, p.priority), 0) + 1;

    for (const item of extracted) {
      const dedupeKey = `${item.baseUrl.replace(/\/+$/, '').toLowerCase()}::${item.model.toLowerCase()}`;
      if (existingKeys.has(dedupeKey)) {
        skipped += 1;
        continue;
      }
      try {
        const validated = await assertSafeUpstreamUrl(item.baseUrl);
        const provider = addUpstreamProviderRecord({
          name: item.name,
          adapter: item.adapter,
          baseUrl: validated.toString(),
          model: item.model,
          authHeader: 'Authorization',
          apiKeyPlain: '',
          usesServerEnv: false,
          priority: nextPriority++,
          weight: 50,
          timeoutMs: 8000,
          simulatorBehavior: 'healthy',
          tagline: item.tagline,
          apiKeyUrl: item.apiKeyUrl,
          freeModelsCount: item.freeModelsCount,
        });
        existingKeys.add(dedupeKey);
        created.push(toPublicProviderView(provider));
      } catch {
        skipped += 1;
      }
    }

    res.status(200).json({
      sourceUrl: resolvedUrl,
      discoveredCount: extracted.length,
      createdCount: created.length,
      skippedCount: skipped,
      providers: created,
    });
  });

  app.patch('/api/admin/providers/:id', requireAdminAuth, async (req, res) => {
    const store = getStore();
    const target = store.providers.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Provider not found.' });
      return;
    }

    if (typeof req.body?.enabled === 'boolean') {
      target.enabled = req.body.enabled;
    }
    if (typeof req.body?.priority === 'number' && Number.isFinite(req.body.priority)) {
      target.priority = Math.max(1, Math.min(999, Math.round(req.body.priority)));
    }
    if (typeof req.body?.model === 'string' && req.body.model.trim()) {
      target.model = req.body.model.trim().slice(0, 120);
    }
    if (
      typeof req.body?.baseUrl === 'string' &&
      req.body.baseUrl.trim() &&
      target.adapter !== 'sandbox-simulator' &&
      target.adapter !== 'gemini' &&
      !target.baseUrl.startsWith('internal://')
    ) {
      try {
        const validated = await assertSafeUpstreamUrl(req.body.baseUrl.trim());
        target.baseUrl = validated.toString();
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid upstream URL.',
        });
        return;
      }
    }
    if (
      target.adapter === 'sandbox-simulator' &&
      ['healthy', 'rate_limit_429', 'server_error_503', 'latency_spike'].includes(
        req.body?.simulatorBehavior
      )
    ) {
      target.simulatorBehavior = req.body.simulatorBehavior as SimulatorBehavior;
    }
    if (req.body?.resetCircuit === true) {
      target.health = 'healthy';
      target.consecutiveFailures = 0;
      target.cooldownUntil = null;
      target.lastError = null;
    }
    if (req.body?.usesServerEnv === true && target.adapter === 'gemini') {
      target.usesServerEnv = true;
      target.apiKeyMasked = 'env:GEMINI_API_KEY';
      target.apiKeySealed = '';
      target.health = process.env.GEMINI_API_KEY?.trim() ? 'healthy' : 'needs_key';
      target.lastError = null;
    } else if (typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()) {
      const nextKey = req.body.apiKey.trim();
      target.usesServerEnv = false;
      target.apiKeyMasked = maskCredential(nextKey);
      target.apiKeySealed = sealSecret(nextKey);
      target.health = 'healthy';
      target.consecutiveFailures = 0;
      target.cooldownUntil = null;
      target.lastError = null;
    }

    store.providers.sort((a, b) => a.priority - b.priority);
    persistStore();
    res.json({ provider: toPublicProviderView(target) });
  });

  app.post('/api/admin/providers/:id/probe', requireAdminAuth, async (req, res) => {
    const store = getStore();
    const target = store.providers.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Provider not found.' });
      return;
    }
    const probe = await probeUpstreamProvider(target);
    res.json({ provider: toPublicProviderView(target), probe });
  });

  app.post('/api/admin/providers/probe-all', requireAdminAuth, async (_req, res) => {
    const store = getStore();
    const targets = store.providers.filter(
      (p) =>
        p.enabled &&
        !p.baseUrl.includes('{account_id}') &&
        !p.baseUrl.includes('.example.com') &&
        (p.adapter === 'sandbox-simulator' ||
          (p.usesServerEnv && Boolean(process.env.GEMINI_API_KEY?.trim())) ||
          !p.requiresApiKey ||
          Boolean(p.apiKeySealed))
    );

    const results = await Promise.all(
      targets.map(async (p) => ({
        id: p.id,
        name: p.name,
        ...(await probeUpstreamProvider(p)),
      }))
    );
    res.json({
      checkedCount: results.length,
      operationalCount: results.filter((r) => r.ok).length,
      results,
    });
  });

  app.delete('/api/admin/providers/:id', requireAdminAuth, (req, res) => {
    const store = getStore();
    const before = store.providers.length;
    store.providers = store.providers.filter((p) => p.id !== req.params.id);
    if (store.providers.length === before) {
      res.status(404).json({ error: 'Provider not found.' });
      return;
    }
    persistStore();
    res.json({ ok: true });
  });

  // Routing Policy
  app.put('/api/admin/routing', requireAdminAuth, (req, res) => {
    const store = getStore();
    const strategy = req.body?.strategy as RoutingStrategy;
    if (['priority_failover', 'round_robin', 'lowest_latency'].includes(strategy)) {
      store.routing.strategy = strategy;
    }
    if (typeof req.body?.maxRetries === 'number') {
      store.routing.maxRetries = Math.max(0, Math.min(10, Math.round(req.body.maxRetries)));
    }
    if (typeof req.body?.circuitBreakerThreshold === 'number') {
      store.routing.circuitBreakerThreshold = Math.max(
        1,
        Math.min(10, Math.round(req.body.circuitBreakerThreshold))
      );
    }
    if (typeof req.body?.cooldownSeconds === 'number') {
      store.routing.cooldownSeconds = Math.max(
        5,
        Math.min(600, Math.round(req.body.cooldownSeconds))
      );
    }
    persistStore();
    res.json({ routing: store.routing });
  });

  // Logs clear
  app.delete('/api/admin/logs', requireAdminAuth, (_req, res) => {
    const store = getStore();
    store.logs = [];
    persistStore();
    res.json({ ok: true });
  });

  // Vite Dev Middleware or Static Production Build
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Taygos APIs gateway running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Taygos APIs server:', err);
  process.exit(1);
});
