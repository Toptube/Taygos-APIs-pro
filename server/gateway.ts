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
import {
  appendGatewayLog,
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

export function authenticateGatewayRequest(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string
): GatewayAuthResult {
  const getHeader = (name: string): string => {
    const val = headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0]?.trim() ?? '';
    return typeof val === 'string' ? val.trim() : '';
  };

  let publicKey = getHeader('x-taygos-public-key');
  let secretKey = getHeader('x-taygos-secret-key');
  const timestamp = getHeader('x-taygos-timestamp');
  const signature = getHeader('x-taygos-signature');
  const authHeader = getHeader('authorization');

  let authMethod: 'key_pair' | 'hmac_sha256' | 'bearer_pair' | null = null;

  if (!publicKey && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      publicKey = token.slice(0, colonIdx).trim();
      secretKey = token.slice(colonIdx + 1).trim();
      authMethod = 'bearer_pair';
    }
  }

  if (!publicKey) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Missing X-Taygos-Public-Key header or Bearer pk:sk credential.',
    };
  }

  const store = getStore();
  const key = store.keys.find((k) => k.publicKey === publicKey);
  if (!key) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Invalid Taygos Public Key.',
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
    if (!verifySecret(secretKey, key.secretHash)) {
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

export function resolveProviderApiKey(provider: StoredUpstreamProvider): string {
  if (provider.usesServerEnv) {
    return process.env.GEMINI_API_KEY?.trim() ?? '';
  }
  return unsealSecret(provider.apiKeySealed) ?? '';
}

function createGeminiClient(apiKey: string): GoogleGenAI {
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
    const cleanPrompt = promptText.slice(0, 500);
    const width = Number(payload.width) || 1024;
    const height = Number(payload.height) || 1024;
    const inputImageUrl =
      typeof payload.image_url === 'string'
        ? payload.image_url.trim()
        : typeof payload.image === 'string'
          ? payload.image.trim()
          : '';

    if (provider.baseUrl.includes('lllyasviel-ic-light.hf.space')) {
      const spaceRes = await fetch('https://lllyasviel-ic-light.hf.space/config');
      if (!spaceRes.ok) {
        throw Object.assign(new Error(`IC-Light Space HTTP ${spaceRes.status}`), {
          statusCode: spaceRes.status,
        });
      }
      return {
        statusCode: 200,
        data: {
          model: 'lllyasviel/IC-Light',
          spaceUrl: 'https://lllyasviel-ic-light.hf.space',
          gradioApi: 'https://lllyasviel-ic-light.hf.space/gradio_api/call/process_relight',
          status: 'running',
          note: inputImageUrl
            ? 'IC-Light Space is live. Submit foreground image + lighting prompt to gradioApi.'
            : 'IC-Light Space verified live (Gradio). Pass image_url for product relighting workflows.',
        },
      };
    }

    if (provider.baseUrl.includes('pollinations.ai')) {
      const apiKey = resolveProviderApiKey(provider);
      const isGenApi = provider.baseUrl.includes('gen.pollinations.ai');
      let targetUrl = isGenApi
        ? `https://gen.pollinations.ai/image/${encodeURIComponent(cleanPrompt)}?model=${encodeURIComponent(provider.model || 'black-forest-labs/flux.2-klein-4b')}&width=${width}&height=${height}`
        : `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=${encodeURIComponent(provider.model || 'flux')}&width=${width}&height=${height}&nologo=true`;
      if (inputImageUrl && inputImageUrl.startsWith('https://')) {
        targetUrl += `&image=${encodeURIComponent(inputImageUrl)}`;
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
      const imageModel = provider.model || 'gemini-3.1-flash-lite-image';

      if (payload.__probeOnly === true) {
        const meta = await ai.models.get({ model: imageModel });
        return {
          statusCode: 200,
          data: {
            model: meta.name || imageModel,
            status: 'verified',
          },
        };
      }

      const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];
      if (inputImageUrl && inputImageUrl.startsWith('https://')) {
        const safeImg = await assertSafeUpstreamUrl(inputImageUrl);
        const imgRes = await fetch(safeImg.toString());
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          parts.push({
            inlineData: {
              data: buf.toString('base64'),
              mimeType: imgRes.headers.get('content-type') || 'image/png',
            },
          });
        }
      }
      parts.push({ text: cleanPrompt });

      const response = await ai.models.generateContent({
        model: imageModel,
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
      if (outImages.length === 0) {
        throw Object.assign(
          new Error('Gemini did not return an image part for this prompt/key.'),
          { statusCode: 502 }
        );
      }
      return {
        statusCode: 200,
        data: {
          model: imageModel,
          data: outImages,
        },
      };
    }
  }

  if (provider.category === 'video') {
    const cleanPrompt = promptText.slice(0, 400);
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
      const targetUrl = `https://gen.pollinations.ai/video/${encodeURIComponent(cleanPrompt)}?model=${encodeURIComponent(provider.model || 'alibaba/wan-2.2-fast')}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
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

      const interaction = await ai.interactions.create(
        {
          model: videoModel,
          input: cleanPrompt,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: '16:9',
            duration: '5s',
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
        const imgUrl =
          typeof payload.image_url === 'string'
            ? payload.image_url.trim()
            : typeof payload.image === 'string'
              ? payload.image.trim()
              : '';
        if (!imgUrl) {
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
              note: 'HF token verified. Send image_url in JSON payload to remove background.',
            },
          };
        }
        const safeImg = await assertSafeUpstreamUrl(imgUrl);
        const srcFetch = await fetch(safeImg.toString());
        if (!srcFetch.ok) {
          throw Object.assign(new Error(`Image fetch HTTP ${srcFetch.status}`), {
            statusCode: srcFetch.status,
          });
        }
        const srcBytes = await srcFetch.arrayBuffer();
        const segRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'Content-Type': srcFetch.headers.get('content-type') || 'image/png',
          },
          body: srcBytes,
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

  // Fallback to all category providers if no specialty match was configured
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
}): Promise<{ httpStatus: number; body: GatewayExecutionResponse }> {
  const store = getStore();
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

  const maxAttempts = Math.min(candidates.length, store.routing.maxRetries + 1);
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
    }
  }

  params.key.requestCount += 1;
  params.key.lastUsedAt = new Date().toISOString();
  persistStore();

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
