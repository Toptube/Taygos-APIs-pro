import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  AccessKeyPublicView,
  GatewayLogEntry,
  Language,
} from '../types/taygos';
import { useT } from '../i18n/translations';
import { CopyButton } from './CopyButton';

interface DocsAndLogsProps {
  lang: Language;
  gatewayEndpointUrl: string;
  keys: AccessKeyPublicView[];
  logs: GatewayLogEntry[];
  onClearLogs: () => Promise<void>;
}

type DocsSubView = 'code' | 'logs';
type SnippetTab =
  | 'openai_sdk'
  | 'cursor'
  | 'claude_code'
  | 'codex'
  | 'curl'
  | 'typescript'
  | 'python';
type LogFilter = 'all' | 'success' | 'failover' | 'failed';

export const DocsAndLogs: React.FC<DocsAndLogsProps> = ({
  lang,
  gatewayEndpointUrl,
  keys,
  logs,
  onClearLogs,
}) => {
  const t = useT(lang);
  const [subView, setSubView] = useState<DocsSubView>('code');
  const [snippetTab, setSnippetTab] = useState<SnippetTab>('openai_sdk');
  const [filter, setFilter] = useState<LogFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const samplePk =
    keys.find((k) => k.status === 'active')?.publicKey ||
    'pk_taygos_live_your_public_key';
  const openaiBaseUrl = gatewayEndpointUrl.replace(/\/gateway$/, '');
  const openaiChatUrl = `${openaiBaseUrl}/chat/completions`;
  const githubUrl = 'https://github.com/Toptube/Taygos-apis.git';

  const snippets: Record<SnippetTab, { title: string; code: string }> = {
    openai_sdk: {
      title: 'JavaScript / AI Chat (الشمساوية / OpenAI)',
      code: `// Base URL: ${openaiBaseUrl}
// API Key:  ${samplePk}:sk_taygos_live_your_secret_key

const response = await fetch("${openaiChatUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${samplePk}:sk_taygos_live_your_secret_key"
  },
  body: JSON.stringify({
    model: "taygos-unified",
    messages: [{ role: "user", content: "مرحباً، كيف تعمل البوابة؟" }]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);`,
    },
    cursor: {
      title: 'Cursor IDE Settings (from Toptube/Taygos-apis)',
      code: `# 1. Open Cursor Settings -> Models -> Override OpenAI Base URL & API Key
OpenAI Base URL: ${openaiBaseUrl}
OpenAI API Key:  ${samplePk}:sk_taygos_live_your_secret_key
Custom Model:    taygos-unified

# Or point directly to any catalog provider from Toptube/Taygos-apis:
# Groq:       https://api.groq.com/openai/v1      (llama-3.3-70b-versatile)
# OpenRouter: https://openrouter.ai/api/v1        (openai/gpt-oss-120b:free)
# NVIDIA NIM: https://integrate.api.nvidia.com/v1 (meta/llama-3.3-70b-instruct)`,
    },
    claude_code: {
      title: 'Claude Code CLI (from Toptube/Taygos-apis)',
      code: `# Point Claude Code to your unified Taygos Gateway (with automatic failover):
export ANTHROPIC_BASE_URL="${openaiBaseUrl}"
export ANTHROPIC_AUTH_TOKEN="${samplePk}:sk_taygos_live_your_secret_key"

# Or direct free backends from Toptube/Taygos-apis:
# Groq:       export ANTHROPIC_BASE_URL="https://api.groq.com/openai/v1"
# NVIDIA NIM: export ANTHROPIC_BASE_URL="https://integrate.api.nvidia.com/v1"
# OpenRouter: export ANTHROPIC_BASE_URL="https://openrouter.ai/api/v1"`,
    },
    codex: {
      title: 'Codex CLI / OpenAI SDK (from Toptube/Taygos-apis)',
      code: `# ~/.zshrc or ~/.bashrc
export OPENAI_BASE_URL="${openaiBaseUrl}"
export OPENAI_API_KEY="${samplePk}:sk_taygos_live_your_secret_key"

# Direct provider fallback URLs included in Taygos catalog:
# Groq:       https://api.groq.com/openai/v1
# NVIDIA NIM: https://integrate.api.nvidia.com/v1
# OpenRouter: https://openrouter.ai/api/v1
# Gemini:     https://generativelanguage.googleapis.com/v1beta`,
    },
    curl: {
      title: 'cURL (Unified Gateway)',
      code: `curl -X POST "${gatewayEndpointUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-Taygos-Public-Key: ${samplePk}" \\
  -H "X-Taygos-Secret-Key: sk_taygos_live_your_secret_key" \\
  -d '{"prompt": "Hello from my external app"}'`,
    },
    typescript: {
      title: 'TypeScript (HMAC-SHA256 Signed)',
      code: `import crypto from 'node:crypto';

const endpoint = "${gatewayEndpointUrl}";
const publicKey = process.env.TAYGOS_PUBLIC_KEY!;
const secretKey = process.env.TAYGOS_SECRET_KEY!;

const body = JSON.stringify({ prompt: "Hello from Node/TypeScript" });
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = crypto
  .createHmac("sha256", secretKey)
  .update(\`\${timestamp}.\${body}\`)
  .digest("hex");

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Taygos-Public-Key": publicKey,
    "X-Taygos-Timestamp": timestamp,
    "X-Taygos-Signature": \`sha256=\${signature}\`,
  },
  body,
});

const data = await res.json();
console.log("Served by:", data.provider?.name, "Failover:", data.failoverTriggered);`,
    },
    python: {
      title: 'Python (HMAC-SHA256 Signed)',
      code: `import hashlib, hmac, json, os, time, urllib.request

endpoint = "${gatewayEndpointUrl}"
public_key = os.environ["TAYGOS_PUBLIC_KEY"]
secret_key = os.environ["TAYGOS_SECRET_KEY"]

body = json.dumps({"prompt": "Hello from Python"}).encode("utf-8")
ts = str(int(time.time()))
sig = hmac.new(
    secret_key.encode("utf-8"),
    f"{ts}.".encode("utf-8") + body,
    hashlib.sha256,
).hexdigest()

req = urllib.request.Request(
    endpoint,
    data=body,
    headers={
        "Content-Type": "application/json",
        "X-Taygos-Public-Key": public_key,
        "X-Taygos-Timestamp": ts,
        "X-Taygos-Signature": f"sha256={sig}",
    },
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    print(resp.read().decode("utf-8"))`,
    },
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filter === 'success' && log.status !== 'success') return false;
      if (filter === 'failed' && log.status !== 'failed') return false;
      if (filter === 'failover' && !log.failoverTriggered) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          log.id.toLowerCase().includes(q) ||
          log.keyName.toLowerCase().includes(q) ||
          log.publicKey.toLowerCase().includes(q) ||
          (log.finalProviderName ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, filter, search]);

  return (
    <div className="space-y-5">
      {/* Sub-view Switch at Top (No Scrolling Needed!) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {subView === 'code' ? t.docsTitle : t.logsTitle}
          </h1>
          <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
            {t.docsDesc}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setSubView('code')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subView === 'code'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar' ? 'الأكواد والروابط الجاهزة' : 'Code & Endpoints'}
          </button>
          <button
            type="button"
            onClick={() => setSubView('logs')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subView === 'logs'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar'
              ? `سجل الطلبات (${logs.length})`
              : `Audit Logs (${logs.length})`}
          </button>
        </div>
      </div>

      {subView === 'code' ? (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {/* Code Example Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['openai_sdk', 'AI Chat / الشمساوية'],
                ['cursor', 'Cursor'],
                ['claude_code', 'Claude Code'],
                ['codex', 'Codex CLI'],
                ['curl', 'cURL'],
                ['typescript', 'TypeScript (HMAC)'],
                ['python', 'Python (HMAC)'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSnippetTab(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  snippetTab === id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Code Block with Visible Top Header Copy Bar */}
          <div className="border border-slate-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 bg-slate-900 px-4 py-2.5 border-b border-slate-800">
              <span
                dir="ltr"
                className="text-xs font-mono text-slate-300 truncate"
              >
                {snippets[snippetTab].title}
              </span>
              <CopyButton
                text={snippets[snippetTab].code}
                label={lang === 'ar' ? 'نسخ الكود بالكامل' : 'Copy Code'}
                copiedLabel={t.copied}
                className="bg-teal-700 border-teal-600 text-white hover:bg-teal-600"
              />
            </div>
            <pre
              dir="ltr"
              className="p-5 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed select-all"
            >
              {snippets[snippetTab].code}
            </pre>
          </div>

          {/* Copyable Endpoints Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100 text-xs">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">
                  {t.unifiedEndpointLabel}
                </span>
                <CopyButton
                  text={gatewayEndpointUrl}
                  label={t.copy}
                  copiedLabel={t.copied}
                  className="bg-white"
                />
              </div>
              <code
                dir="ltr"
                className="block font-mono text-slate-700 break-all select-all"
              >
                {gatewayEndpointUrl}
              </code>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">
                  {t.aiEndpointLabel}
                </span>
                <CopyButton
                  text={openaiChatUrl}
                  label={t.copy}
                  copiedLabel={t.copied}
                  className="bg-white"
                />
              </div>
              <code
                dir="ltr"
                className="block font-mono text-slate-700 break-all select-all"
              >
                {openaiChatUrl}
              </code>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">
                  {t.githubRepo}
                </span>
                <CopyButton
                  text={githubUrl}
                  label={t.copy}
                  copiedLabel={t.copied}
                  className="bg-white"
                />
              </div>
              <a
                dir="ltr"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="block font-mono text-teal-700 hover:underline break-all"
              >
                {githubUrl}
              </a>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['all', t.logsFilterAll],
                  ['success', t.logsFilterSuccess],
                  ['failover', t.logsFilterFailover],
                  ['failed', t.logsFilterFailed],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    filter === id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchLogsPlaceholder}
                  className="ps-8 pe-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 w-56"
                />
              </div>

              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={onClearLogs}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.clearLogsBtn}</span>
                </button>
              )}
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              {t.emptyLogs}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                      <th className="py-3 px-4 text-start">Request ID</th>
                      <th className="py-3 px-4 text-start">Key / Auth</th>
                      <th className="py-3 px-4 text-start">Final Provider</th>
                      <th className="py-3 px-4 text-start">Status</th>
                      <th className="py-3 px-4 text-end">Latency</th>
                      <th className="py-3 px-4 text-end">Trace</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLogs.map((log) => {
                      const isOpen = expandedLogId === log.id;
                      return (
                        <React.Fragment key={log.id}>
                          <tr className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono tabular-nums text-slate-800">
                              <div className="flex items-center gap-1.5">
                                <span>{log.id}</span>
                                <CopyButton text={log.id} compact title={t.copy} />
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5 font-medium text-slate-900">
                                <span>{log.keyName}</span>
                                <CopyButton
                                  text={log.publicKey}
                                  compact
                                  title={t.copy}
                                />
                              </div>
                              <div className="text-slate-500 font-mono">
                                {log.authMethod} · {log.strategyUsed}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              <div>{log.finalProviderName ?? 'None'}</div>
                              {log.failoverTriggered && (
                                <div className="text-[11px] text-amber-700 font-medium">
                                  Failover across {log.attempts.length} nodes
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {log.status === 'success' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>{log.statusCode} OK</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-700 font-medium whitespace-nowrap">
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>{log.statusCode} Failed</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-700">
                              {log.totalLatencyMs} ms
                            </td>
                            <td className="py-3 px-4 text-end">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedLogId(isOpen ? null : log.id)
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 rounded"
                              >
                                <span>{log.attempts.length}</span>
                                {isOpen ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50">
                              <td colSpan={6} className="p-4">
                                <div className="space-y-2">
                                  {log.attempts.map((a, idx) => (
                                    <div
                                      key={`${a.providerId}-${idx}`}
                                      className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded px-3 py-2"
                                    >
                                      <div>
                                        <span className="font-mono text-slate-400 me-2">
                                          #{idx + 1}
                                        </span>
                                        <span className="font-medium text-slate-900">
                                          {a.providerName}
                                        </span>
                                        {a.errorMessage && (
                                          <span className="text-red-600 ms-2">
                                            — {a.errorMessage}
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-mono tabular-nums text-slate-600">
                                        HTTP {a.statusCode} · {a.latencyMs} ms
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
