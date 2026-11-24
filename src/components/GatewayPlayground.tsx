import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Play,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type {
  AccessKeyPublicView,
  FailoverAttempt,
  GatewayExecutionResponse,
  Language,
} from '../types/taygos';
import { useT } from '../i18n/translations';
import { CopyButton } from './CopyButton';

interface GatewayPlaygroundProps {
  lang: Language;
  keys: AccessKeyPublicView[];
  gatewayEndpointUrl: string;
  initialPublicKey: string;
  initialSecretKey: string;
  onRequestCompleted: () => void;
}

type AuthMode = 'key_pair' | 'hmac_sha256' | 'bearer_pair';
type EndpointMode = 'gateway' | 'chat' | 'images' | 'videos' | 'audio' | 'documents';

async function computeHmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await window.crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(message)
  );
  return Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const GatewayPlayground: React.FC<GatewayPlaygroundProps> = ({
  lang,
  keys,
  gatewayEndpointUrl,
  initialPublicKey,
  initialSecretKey,
  onRequestCompleted,
}) => {
  const t = useT(lang);
  const [publicKey, setPublicKey] = useState(
    initialPublicKey || keys.find((k) => k.status === 'active')?.publicKey || ''
  );
  const [secretKey, setSecretKey] = useState(initialSecretKey || '');
  const [authMode, setAuthMode] = useState<AuthMode>('key_pair');
  const [endpointMode, setEndpointMode] = useState<EndpointMode>('gateway');
  const [payloadText, setPayloadText] = useState(
    JSON.stringify(
      {
        prompt:
          'Verify Taygos unified gateway routing and automatic provider failover.',
        channel: 'production-app',
      },
      null,
      2
    )
  );
  const [sending, setSending] = useState(false);
  const [rawResult, setRawResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [clientError, setClientError] = useState<string | null>(null);

  const apiBase = gatewayEndpointUrl.replace(/\/gateway$/, '');
  const endpointMap: Record<EndpointMode, { url: string; path: string }> = {
    gateway: { url: gatewayEndpointUrl, path: '/api/v1/gateway' },
    chat: { url: `${apiBase}/chat/completions`, path: '/api/v1/chat/completions' },
    images: { url: `${apiBase}/images/generations`, path: '/api/v1/images/generations' },
    videos: { url: `${apiBase}/videos/generations`, path: '/api/v1/videos/generations' },
    audio: { url: `${apiBase}/audio/speech`, path: '/api/v1/audio/speech' },
    documents: { url: `${apiBase}/documents/storyboard`, path: '/api/v1/documents/storyboard' },
  };
  const activeUrl = endpointMap[endpointMode].url;
  const activePath = endpointMap[endpointMode].path;

  const switchEndpointMode = (mode: EndpointMode) => {
    setEndpointMode(mode);
    if (mode === 'chat') {
      setPayloadText(
        JSON.stringify(
          {
            model: 'taygos-unified',
            messages: [
              {
                role: 'user',
                content: 'مرحباً، اكتب ملخصاً قصيراً عن قدرات بوابة Taygos.',
              },
            ],
          },
          null,
          2
        )
      );
    } else if (mode === 'images') {
      setPayloadText(
        JSON.stringify(
          {
            task: 'generate',
            prompt: 'Minimalist luxury perfume bottle on white marble studio pedestal',
            width: 1024,
            height: 1024,
          },
          null,
          2
        )
      );
    } else if (mode === 'videos') {
      setPayloadText(
        JSON.stringify(
          {
            prompt: 'Golden coffee beans falling in slow motion studio lighting',
          },
          null,
          2
        )
      );
    } else if (mode === 'audio') {
      setPayloadText(
        JSON.stringify(
          {
            input: 'Welcome to Taygos Unified APIs gateway.',
            voice: 'nova',
          },
          null,
          2
        )
      );
    } else if (mode === 'documents') {
      setPayloadText(
        JSON.stringify(
          {
            idea: 'Eco-friendly solar lamp product launch campaign',
            scenesCount: 3,
          },
          null,
          2
        )
      );
    } else {
      setPayloadText(
        JSON.stringify(
          {
            prompt:
              'Verify Taygos unified gateway routing and automatic provider failover.',
            channel: 'production-app',
          },
          null,
          2
        )
      );
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);
    setRawResult(null);

    if (!publicKey.trim() || !secretKey.trim()) {
      setClientError(
        'Public Key and Secret Key are required to execute a gateway call.'
      );
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(payloadText);
    } catch {
      setClientError('Payload must be valid JSON.');
      return;
    }

    const rawBody = JSON.stringify(parsedBody);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authMode === 'key_pair') {
      headers['X-Taygos-Public-Key'] = publicKey.trim();
      headers['X-Taygos-Secret-Key'] = secretKey.trim();
    } else if (authMode === 'bearer_pair') {
      headers['Authorization'] = `Bearer ${publicKey.trim()}:${secretKey.trim()}`;
    } else {
      const ts = String(Math.floor(Date.now() / 1000));
      const signature = await computeHmacSha256Hex(
        secretKey.trim(),
        `${ts}.${rawBody}`
      );
      headers['X-Taygos-Public-Key'] = publicKey.trim();
      headers['X-Taygos-Timestamp'] = ts;
      headers['X-Taygos-Signature'] = `sha256=${signature}`;
    }

    setSending(true);
    try {
      const res = await fetch(activePath, {
        method: 'POST',
        headers,
        body: rawBody,
      });
      const json = (await res.json()) as Record<string, unknown>;
      setRawResult(json);
      onRequestCompleted();
    } catch {
      setClientError(`Network error reaching ${activePath}.`);
    } finally {
      setSending(false);
    }
  };

  const traceSource: GatewayExecutionResponse | null = rawResult
    ? ((rawResult.taygos as GatewayExecutionResponse | undefined) ??
        (rawResult as unknown as GatewayExecutionResponse))
    : null;
  const isSuccess = Boolean(
    rawResult && (rawResult.ok === true || Array.isArray(rawResult.choices))
  );
  const attempts: FailoverAttempt[] = Array.isArray(traceSource?.attempts)
    ? traceSource.attempts
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          {t.playgroundTitle}
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {t.playgroundDesc}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Request Builder */}
        <form
          onSubmit={handleDispatch}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 border-b border-slate-100 pb-3">
            <span className="font-medium text-slate-700 shrink-0">POST</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <code dir="ltr" className="font-mono text-slate-800 truncate">
                {activeUrl}
              </code>
              <CopyButton text={activeUrl} compact title={t.copy} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.endpointModeLabel}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['gateway', 'Gateway'],
                  ['chat', lang === 'ar' ? 'شات AI' : 'AI Chat'],
                  ['images', lang === 'ar' ? 'صور وخلفيات' : 'Images'],
                  ['videos', lang === 'ar' ? 'فيديو' : 'Videos'],
                  ['audio', lang === 'ar' ? 'صوت TTS' : 'Audio TTS'],
                  ['documents', lang === 'ar' ? 'PDF/ستوري' : 'Storyboard'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => switchEndpointMode(mode)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors truncate ${
                    endpointMode === mode
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.authModeLabel}
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['key_pair', t.authModePair],
                  ['hmac_sha256', t.authModeHmac],
                  ['bearer_pair', t.authModeBearer],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAuthMode(mode)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors truncate ${
                    authMode === mode
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.selectKeyLabel}
            </label>
            {keys.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <select
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- Select Public Key --</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.publicKey}>
                      {k.name} ({k.publicKey})
                    </option>
                  ))}
                </select>
                {publicKey && <CopyButton text={publicKey} compact title={t.copy} />}
              </div>
            ) : (
              <input
                type="text"
                dir="ltr"
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="pk_taygos_live_..."
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.pasteSecretLabel}
            </label>
            <input
              type="password"
              dir="ltr"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="sk_taygos_live_..."
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-700">
                {t.payloadLabel}
              </label>
              <CopyButton
                text={payloadText}
                label={t.copy}
                copiedLabel={t.copied}
              />
            </div>
            <textarea
              dir="ltr"
              rows={6}
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          {clientError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
              {clientError}
            </div>
          )}

          <button
            type="submit"
            disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{sending ? t.sendingRequest : t.sendRequestBtn}</span>
          </button>
        </form>

        {/* Failover Trace & Response */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {t.traceTitle}
            </h3>
            {traceSource?.requestId && (
              <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-500">
                <span>
                  {traceSource.totalLatencyMs} ms · {traceSource.requestId}
                </span>
                <CopyButton
                  text={traceSource.requestId}
                  compact
                  title={t.copy}
                />
              </div>
            )}
          </div>

          {!rawResult ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {t.traceEmpty}
            </div>
          ) : (
            <div className="space-y-4">
              {isSuccess ? (
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    {traceSource?.failoverTriggered
                      ? t.failoverNotice
                      : t.directNotice}
                    {traceSource?.provider
                      ? ` · ${traceSource.provider.name}`
                      : ''}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {typeof rawResult.error === 'string'
                      ? rawResult.error
                      : (rawResult.error as { message?: string })?.message ||
                        'Gateway request failed.'}
                  </span>
                </div>
              )}

              {attempts.length > 0 && (
                <div className="space-y-2">
                  {attempts.map((att, idx) => (
                    <div
                      key={`${att.providerId}-${idx}`}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono tabular-nums text-slate-400">
                          #{idx + 1}
                        </span>
                        {att.outcome === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : att.outcome === 'skipped_circuit' ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        )}
                        <div className="truncate">
                          <span className="font-medium text-slate-900">
                            {att.providerName}
                          </span>
                          {att.errorMessage && (
                            <span className="text-slate-500 ms-2">
                              — {att.errorMessage}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 font-mono tabular-nums shrink-0 text-slate-600">
                        <span>HTTP {att.statusCode}</span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span>{att.latencyMs} ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between bg-slate-900 px-4 py-2 border-b border-slate-800">
                  <span className="text-xs font-medium text-slate-300">
                    {t.responsePayloadTitle}
                  </span>
                  <CopyButton
                    text={JSON.stringify(rawResult, null, 2)}
                    label={lang === 'ar' ? 'نسخ الرد بالكامل' : t.copy}
                    copiedLabel={t.copied}
                    className="bg-teal-700 border-teal-600 text-white hover:bg-teal-600"
                  />
                </div>
                <pre
                  dir="ltr"
                  className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto max-h-72 select-all"
                >
                  {JSON.stringify(rawResult, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
