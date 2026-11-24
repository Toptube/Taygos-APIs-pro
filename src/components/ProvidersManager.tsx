import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ImageSpecialty,
  Language,
  ProviderAdapter,
  ProviderCategory,
  RoutingConfig,
  RoutingStrategy,
  SimulatorBehavior,
  UpstreamProviderPublicView,
} from '../types/taygos';
import { useT } from '../i18n/translations';
import { CopyButton } from './CopyButton';

interface ProvidersManagerProps {
  lang: Language;
  activeCategory?: ProviderCategory;
  imageSpecialty?: ImageSpecialty;
  onChangeImageSpecialty?: (spec: ImageSpecialty) => void;
  gatewayEndpointUrl: string;
  providers: UpstreamProviderPublicView[];
  routing: RoutingConfig;
  hasGeminiEnvKey: boolean;
  onAddProvider: (input: {
    name: string;
    category?: ProviderCategory;
    adapter: ProviderAdapter;
    baseUrl: string;
    model: string;
    authHeader: string;
    apiKey: string;
    usesServerEnv: boolean;
    priority: number;
    timeoutMs: number;
  }) => Promise<boolean>;
  onBulkImportProviders: (
    items: Array<Record<string, unknown>>
  ) => Promise<{ createdCount: number; errorCount: number }>;
  onImportFromUrl: (url: string) => Promise<{
    sourceUrl: string;
    discoveredCount: number;
    createdCount: number;
    skippedCount: number;
  }>;
  onUpdateProvider: (
    id: string,
    patch: {
      enabled?: boolean;
      priority?: number;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      usesServerEnv?: boolean;
      simulatorBehavior?: SimulatorBehavior;
      resetCircuit?: boolean;
    }
  ) => Promise<void>;
  onProbeProvider: (id: string) => Promise<{
    ok: boolean;
    statusCode: number;
    latencyMs: number;
    message: string;
  } | null>;
  onProbeAllProviders: () => Promise<{
    checkedCount: number;
    operationalCount: number;
  } | null>;
  onDeleteProvider: (id: string) => Promise<void>;
  onSaveRouting: (next: Partial<RoutingConfig>) => Promise<boolean>;
}

type ProviderFilter = 'all' | 'configured' | 'needs_key';

export const ProvidersManager: React.FC<ProvidersManagerProps> = ({
  lang,
  activeCategory = 'llm',
  imageSpecialty = 'all',
  onChangeImageSpecialty,
  gatewayEndpointUrl,
  providers,
  routing,
  hasGeminiEnvKey,
  onAddProvider,
  onBulkImportProviders,
  onImportFromUrl,
  onUpdateProvider,
  onProbeProvider,
  onProbeAllProviders,
  onDeleteProvider,
  onSaveRouting,
}) => {
  const t = useT(lang);
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [search, setSearch] = useState('');

  // Centered modal states (zero scrolling!)
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<UpstreamProviderPublicView | null>(null);

  // Edit provider modal inputs
  const [editApiKey, setEditApiKey] = useState('');
  const [showEditApiKey, setShowEditApiKey] = useState(false);
  const [editModel, setEditModel] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editUseEnv, setEditUseEnv] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Probe states
  const [probingAll, setProbingAll] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probeSummary, setProbeSummary] = useState<string | null>(null);

  // Routing form
  const [strategy, setStrategy] = useState<RoutingStrategy>(routing.strategy);
  const [maxRetries, setMaxRetries] = useState<number>(routing.maxRetries);
  const [threshold, setThreshold] = useState<number>(
    routing.circuitBreakerThreshold
  );
  const [cooldown, setCooldown] = useState<number>(routing.cooldownSeconds);
  const [policySaved, setPolicySaved] = useState(false);

  // Bulk import form
  const [bulkText, setBulkText] = useState(
    JSON.stringify(
      [
        {
          name: 'Custom OpenAI Backup',
          adapter: 'openai-compatible',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'llama-3.3-70b-versatile',
          apiKey: '',
          priority: 25,
        },
      ],
      null,
      2
    )
  );
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState('https://openrouter.ai/api/v1/models');
  const [importingUrl, setImportingUrl] = useState(false);

  // Add provider form
  const [pName, setPName] = useState('');
  const [pAdapter, setPAdapter] = useState<ProviderAdapter>('openai-compatible');
  const [pBaseUrl, setPBaseUrl] = useState('https://api.openai.com/v1');
  const [pModel, setPModel] = useState('gpt-4o-mini');
  const [pAuthHeader, setPAuthHeader] = useState('Authorization');
  const [pApiKey, setPApiKey] = useState('');
  const [pUseEnv, setPUseEnv] = useState(false);
  const [pPriority, setPPriority] = useState(providers.length + 1);
  const [pTimeout, setPTimeout] = useState(8000);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openEditModal = (p: UpstreamProviderPublicView) => {
    setEditingProvider(p);
    setEditApiKey('');
    setShowEditApiKey(false);
    setEditModel(p.model);
    setEditBaseUrl(p.baseUrl);
    setEditUseEnv(p.usesServerEnv);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider) return;
    setSavingEdit(true);
    await onUpdateProvider(editingProvider.id, {
      model: editModel.trim(),
      baseUrl:
        editingProvider.adapter !== 'sandbox-simulator' &&
        editingProvider.adapter !== 'gemini'
          ? editBaseUrl.trim()
          : undefined,
      apiKey: editApiKey.trim() || undefined,
      usesServerEnv: editingProvider.adapter === 'gemini' ? editUseEnv : false,
    });
    setSavingEdit(false);
    setEditingProvider(null);
  };

  const handleProbeAll = async () => {
    setProbingAll(true);
    setProbeSummary(null);
    const res = await onProbeAllProviders();
    setProbingAll(false);
    if (res) {
      setProbeSummary(
        lang === 'ar'
          ? `تم فحص ${res.checkedCount} مزودين جاهزين — الشغال الآن: ${res.operationalCount}`
          : `Checked ${res.checkedCount} configured providers — ${res.operationalCount} operational`
      );
    }
  };

  const handleProbeOne = async (id: string) => {
    setProbingId(id);
    await onProbeProvider(id);
    setProbingId(null);
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onSaveRouting({
      strategy,
      maxRetries,
      circuitBreakerThreshold: threshold,
      cooldownSeconds: cooldown,
    });
    if (ok) {
      setPolicySaved(true);
      setTimeout(() => {
        setPolicySaved(false);
        setShowPolicyModal(false);
      }, 900);
    }
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const ok = await onAddProvider({
        name: pName.trim(),
        category: activeCategory,
        adapter: pAdapter,
        baseUrl: pBaseUrl.trim(),
        model: pModel.trim(),
        authHeader: pAuthHeader.trim(),
        apiKey: pApiKey.trim(),
        usesServerEnv: pUseEnv,
        priority: pPriority,
        timeoutMs: pTimeout,
      });
      if (ok) {
        setShowAddModal(false);
        setPName('');
        setPApiKey('');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add provider.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkStatus(null);
    try {
      const parsed = JSON.parse(bulkText);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.providers)
          ? parsed.providers
          : null;
      if (!list) {
        setBulkStatus('Provide a JSON array of provider objects.');
        return;
      }
      const res = await onBulkImportProviders(list);
      setBulkStatus(
        `Imported ${res.createdCount} providers (${res.errorCount} skipped).`
      );
    } catch (err) {
      setBulkStatus(err instanceof Error ? err.message : 'Invalid JSON format.');
    }
  };

  const handleImportUrlClick = async () => {
    if (!importUrl.trim()) return;
    setImportingUrl(true);
    setBulkStatus(null);
    try {
      const res = await onImportFromUrl(importUrl.trim());
      setBulkStatus(
        lang === 'ar'
          ? `تم فحص الرابط واكتشاف ${res.discoveredCount} عنصر: تمت إضافة ${res.createdCount} مزود/موديل جديد (وتخطي ${res.skippedCount} مكرر).`
          : `Discovered ${res.discoveredCount} items: added ${res.createdCount} new providers (${res.skippedCount} already present).`
      );
    } catch (err) {
      setBulkStatus(err instanceof Error ? err.message : 'Failed to extract from URL.');
    } finally {
      setImportingUrl(false);
    }
  };

  const categoryProviders = useMemo(
    () => providers.filter((p) => (p.category || 'llm') === activeCategory),
    [providers, activeCategory]
  );

  const specialtyScopedProviders = useMemo(() => {
    if (activeCategory !== 'image' || imageSpecialty === 'all') {
      return categoryProviders;
    }
    return categoryProviders.filter((p) => p.specialty === imageSpecialty);
  }, [categoryProviders, activeCategory, imageSpecialty]);

  const configuredCount = useMemo(
    () => specialtyScopedProviders.filter((p) => p.keyConfigured && p.enabled).length,
    [specialtyScopedProviders]
  );
  const needsKeyCount = useMemo(
    () => specialtyScopedProviders.filter((p) => !p.keyConfigured).length,
    [specialtyScopedProviders]
  );

  const filteredProviders = useMemo(() => {
    return specialtyScopedProviders.filter((p) => {
      if (filter === 'configured' && !p.keyConfigured) return false;
      if (filter === 'needs_key' && p.keyConfigured) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.baseUrl.toLowerCase().includes(q) ||
          p.model.toLowerCase().includes(q) ||
          (p.tagline || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [specialtyScopedProviders, filter, search]);

  const mediaEndpointUrl =
    activeCategory === 'image'
      ? gatewayEndpointUrl.replace(/\/gateway$/, '/images/generations')
      : activeCategory === 'video'
        ? gatewayEndpointUrl.replace(/\/gateway$/, '/videos/generations')
        : activeCategory === 'audio'
          ? gatewayEndpointUrl.replace(/\/gateway$/, '/audio/speech')
          : activeCategory === 'documents'
            ? gatewayEndpointUrl.replace(/\/gateway$/, '/documents/storyboard')
            : gatewayEndpointUrl;

  const sectionTitle =
    activeCategory === 'image'
      ? imageSpecialty === 'bg_removal'
        ? lang === 'ar'
          ? 'عزل الصور وتفريغ الخلفيات (RMBG)'
          : 'Background Removal APIs'
        : imageSpecialty === 'bg_edit'
          ? lang === 'ar'
            ? 'تعديل وإضاءة الخلفية (IC-Light & Edit)'
            : 'Background Edit & Relighting APIs'
          : imageSpecialty === 'generate'
            ? lang === 'ar'
              ? 'توليد الصور والخلفيات (Flux / Imagen / Sana)'
              : 'Image & Background Generation APIs'
            : lang === 'ar'
              ? 'APIs للصور وتوليد وتفريغ الخلفيات (موحد)'
              : 'Unified Image & Background APIs'
      : activeCategory === 'video'
        ? lang === 'ar'
          ? 'APIs لتوليد الفيديو والمونتاج'
          : 'Video Generation & Stock APIs'
        : activeCategory === 'audio'
          ? lang === 'ar'
            ? 'APIs للصوتيات (تحويل نص لصوت وتحويل صوت لنص)'
            : 'Audio & Voice APIs (TTS + STT)'
          : activeCategory === 'documents'
            ? lang === 'ar'
              ? 'APIs للـ PDF والستوري بورد والمستندات'
              : 'PDF & Storyboard APIs'
            : t.providersSectionTitle;

  const sectionSubtitle =
    lang === 'ar'
      ? `${specialtyScopedProviders.length} مزود في هذا العرض · ${configuredCount} جاهز للعمل الآن · ${needsKeyCount} بانتظار مفتاحك`
      : `${specialtyScopedProviders.length} providers · ${configuredCount} ready · ${needsKeyCount} need API key`;

  return (
    <div className="space-y-4">
      {/* Unified Media Endpoint Banner for Image, Video, Audio & PDF Tabs */}
      {activeCategory !== 'llm' && (
        <div className="bg-white border border-teal-200 rounded-xl p-4 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-teal-800">
                {activeCategory === 'image'
                  ? lang === 'ar'
                    ? 'رابط API موحد للصور (عزل + تعديل خلفية + توليد صور بمفتاح واحد Public + Secret)'
                    : 'Unified Image Endpoint (BG Removal + Edit + Generation with 1 Key Pair)'
                  : activeCategory === 'video'
                    ? lang === 'ar'
                      ? 'رابط البوابة الموحد لتوليد الفيديو'
                      : 'Unified Video Generation Endpoint'
                    : activeCategory === 'audio'
                      ? lang === 'ar'
                        ? 'رابط البوابة الموحد للصوتيات (TTS + Whisper STT)'
                        : 'Unified Audio Speech & Transcription Endpoint'
                      : lang === 'ar'
                        ? 'رابط البوابة الموحد للـ PDF والستوري بورد'
                        : 'Unified Storyboard & Printable PDF Endpoint'}
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {activeCategory === 'image'
                  ? lang === 'ar'
                    ? 'كل أقسام الصور تتجمع في هذا الرابط الواحد ومفتاح Public + Secret واحد؛ أرسل "task": "remove_bg" للعزل، أو "task": "bg_edit" لتعديل الخلفية، أو "prompt" للتوليد.'
                    : 'All image tasks share this single endpoint & key pair; pass "task": "remove_bg", "bg_edit", or "generate".'
                  : activeCategory === 'video'
                    ? lang === 'ar'
                      ? 'اربط تطبيقات الفيديو بهذا الرابط الواحد للتبديل التلقائي بين Wan2.1 و CogVideoX و WaveSpeed و Veo و Pollinations و Pixabay.'
                      : 'Use this single endpoint to auto-switch between Wan2.1, CogVideoX, WaveSpeed, Veo, Pollinations & Stock videos.'
                    : activeCategory === 'audio'
                      ? lang === 'ar'
                        ? 'نقطة موحدة لتحويل النص لصوت (Kokoro / Pollinations Audio) أو تفريغ الصوت لنص عبر /api/v1/audio/transcriptions.'
                        : 'Single endpoint for TTS (/api/v1/audio/speech) and Whisper STT (/api/v1/audio/transcriptions).'
                      : lang === 'ar'
                        ? 'نقطة مدمجة خفيفة بدون تثبيت مكتبات ثقيلة لتوليد Storyboard وتصدير PDF قابل للطباعة فوراً.'
                        : 'Zero-bloat native endpoint for visual Storyboard and printable HTML/PDF layout.'}
              </p>
            </div>
            <CopyButton
              text={mediaEndpointUrl}
              label={t.copy}
              copiedLabel={t.copied}
              className="bg-teal-50 border-teal-200 text-teal-900 self-start sm:self-auto"
            />
          </div>
          <code
            dir="ltr"
            className="block text-xs font-mono text-slate-900 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg break-all select-all"
          >
            {mediaEndpointUrl}
          </code>

          {activeCategory === 'image' && onChangeImageSpecialty && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {(
                [
                  ['all', lang === 'ar' ? 'الكل' : 'All'],
                  ['bg_removal', lang === 'ar' ? 'عزل الصور وتفريغ الخلفيات' : 'BG Removal'],
                  ['bg_edit', lang === 'ar' ? 'تعديل وإضاءة الخلفية' : 'BG Edit & Relight'],
                  ['generate', lang === 'ar' ? 'توليد الصور والخلفيات' : 'Generation'],
                ] as const
              ).map(([spec, label]) => (
                <button
                  key={spec}
                  type="button"
                  onClick={() => onChangeImageSpecialty(spec)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                    imageSpecialty === spec
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header + Action Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {sectionTitle}
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            {sectionSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleProbeAll}
            disabled={probingAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>
              {probingAll
                ? lang === 'ar'
                  ? 'جارٍ الفحص...'
                  : 'Checking...'
                : lang === 'ar'
                  ? 'فحص الشغال الآن'
                  : 'Check Live Health'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowPolicyModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{t.routingPolicyTitle}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>{t.bulkImportBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.addProviderBtn}</span>
          </button>
        </div>
      </div>

      {/* Filter + Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar' ? `الكل (${specialtyScopedProviders.length})` : `All (${specialtyScopedProviders.length})`}
          </button>
          <button
            type="button"
            onClick={() => setFilter('configured')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === 'configured'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar'
              ? `الشغالة والجاهزة (${configuredCount})`
              : `Ready (${configuredCount})`}
          </button>
          <button
            type="button"
            onClick={() => setFilter('needs_key')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === 'needs_key'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar'
              ? `تحتاج مفتاح (${needsKeyCount})`
              : `Needs Key (${needsKeyCount})`}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full sm:w-auto">
          {probeSummary && (
            <span className="text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1 rounded-lg">
              {probeSummary}
            </span>
          )}
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                lang === 'ar' ? 'ابحث باسم المزود أو الرابط...' : 'Filter providers...'
              }
              className="ps-8 pe-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 w-full"
            />
          </div>
        </div>
      </div>

      {/* Mobile Stacked Provider Cards (Zero Horizontal Scroll) */}
      <div className="md:hidden space-y-3">
        {filteredProviders.map((p) => (
          <div
            key={p.id}
            className={`bg-white border border-slate-200 rounded-xl p-4 space-y-3 ${
              !p.enabled ? 'opacity-65' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-semibold text-slate-500">
                    #{String(p.priority).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 break-words">
                    {p.name}
                  </span>
                  <CopyButton text={p.name} compact title={t.copy} />
                </div>
                {p.tagline && (
                  <p className="text-[11px] text-slate-500 mt-1">{p.tagline}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateProvider(p.id, {
                      priority: Math.max(1, p.priority - 1),
                    })
                  }
                  className="p-1 text-slate-400 hover:text-slate-900 border border-slate-200 rounded"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateProvider(p.id, { priority: p.priority + 1 })
                  }
                  className="p-1 text-slate-400 hover:text-slate-900 border border-slate-200 rounded"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <code dir="ltr" className="font-mono text-slate-700 break-all">
                  {p.baseUrl}
                </code>
                {p.baseUrl && <CopyButton text={p.baseUrl} compact title={t.copy} />}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/70">
                <code dir="ltr" className="font-mono text-slate-900 break-all">
                  {p.model}
                </code>
                <CopyButton text={p.model} compact title={t.copy} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {p.health === 'healthy' && (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{lang === 'ar' ? 'شغال / جاهز' : t.healthHealthy}</span>
                  </span>
                )}
                {p.health === 'needs_key' && (
                  <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                    <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                    <span>{lang === 'ar' ? 'يحتاج مفتاح API' : 'Needs Key'}</span>
                  </span>
                )}
                {p.health === 'degraded' && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{t.healthDegraded}</span>
                  </span>
                )}
                {p.health === 'circuit_open' && (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 font-medium text-red-700">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{t.healthCircuitOpen}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProvider(p.id, { resetCircuit: true })
                      }
                      className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:underline"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t.resetCircuit}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 font-mono tabular-nums text-[11px] text-slate-600">
                <span>{p.avgLatencyMs ? `${p.avgLatencyMs} ms` : '—'}</span>
                <span className="text-slate-400">
                  ({p.successfulRequests}/{p.totalRequests})
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-mono text-slate-500 truncate max-w-[190px]">
                {p.apiKeyMasked}
              </span>
              {p.apiKeyUrl && (
                <div className="flex items-center gap-1.5">
                  <a
                    href={p.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                  >
                    <span>{lang === 'ar' ? 'جلب مفتاح مجاني' : 'Get Free Key'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <CopyButton text={p.apiKeyUrl} compact title={t.copy} />
                </div>
              )}
            </div>

            {p.lastError && p.health !== 'healthy' && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 break-words">
                {p.lastError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
              {p.adapter === 'sandbox-simulator' ? (
                <select
                  value={p.simulatorBehavior}
                  onChange={(e) =>
                    onUpdateProvider(p.id, {
                      simulatorBehavior: e.target.value as SimulatorBehavior,
                    })
                  }
                  className="px-2 py-1 text-xs bg-white border border-slate-300 rounded-md"
                >
                  <option value="healthy">{t.simHealthy}</option>
                  <option value="rate_limit_429">{t.sim429}</option>
                  <option value="server_error_503">{t.sim503}</option>
                  <option value="latency_spike">{t.simLatency}</option>
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => openEditModal(p)}
                  className="px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded transition-colors"
                >
                  {p.keyConfigured
                    ? lang === 'ar'
                      ? 'تعديل'
                      : 'Edit'
                    : lang === 'ar'
                      ? 'إضافة مفتاح'
                      : 'Set Key'}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleProbeOne(p.id)}
                disabled={probingId === p.id}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
              >
                {probingId === p.id ? '...' : lang === 'ar' ? 'فحص' : 'Probe'}
              </button>
              <button
                type="button"
                onClick={() => onUpdateProvider(p.id, { enabled: !p.enabled })}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
              >
                {p.enabled ? t.revokeKey : t.activateKey}
              </button>
              <button
                type="button"
                onClick={() => onDeleteProvider(p.id)}
                aria-label="Delete provider"
                className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors ms-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Providers Table */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4 text-start">{t.colPriority}</th>
                <th className="py-3 px-4 text-start">{t.colProvider}</th>
                <th className="py-3 px-4 text-start">{t.colAdapter}</th>
                <th className="py-3 px-4 text-start">{t.colHealth}</th>
                <th className="py-3 px-4 text-end">{t.colLatency}</th>
                <th className="py-3 px-4 text-end">{t.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProviders.map((p) => (
                <tr
                  key={p.id}
                  className={`hover:bg-slate-50/70 transition-colors ${
                    !p.enabled ? 'opacity-60' : ''
                  }`}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1 font-mono tabular-nums text-xs font-semibold text-slate-800">
                      <span>{String(p.priority).padStart(2, '0')}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateProvider(p.id, {
                            priority: Math.max(1, p.priority - 1),
                          })
                        }
                        className="p-0.5 text-slate-400 hover:text-slate-900"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateProvider(p.id, { priority: p.priority + 1 })
                        }
                        className="p-0.5 text-slate-400 hover:text-slate-900"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{p.name}</span>
                      <CopyButton text={p.name} compact title={t.copy} />
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <code
                        dir="ltr"
                        className="text-xs font-mono text-slate-500 truncate max-w-[240px]"
                      >
                        {p.baseUrl}
                      </code>
                      {p.baseUrl && (
                        <CopyButton text={p.baseUrl} compact title={t.copy} />
                      )}
                    </div>
                    {p.tagline && (
                      <div className="text-[11px] text-slate-500 mt-0.5 max-w-sm truncate">
                        {p.tagline}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 text-xs text-slate-700 font-mono">
                      <span className="truncate max-w-[170px]">{p.model}</span>
                      <CopyButton text={p.model} compact title={t.copy} />
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {p.apiKeyMasked}
                      {p.freeModelsCount ? ` · ${p.freeModelsCount} models` : ''}
                    </div>
                    {p.apiKeyUrl && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <a
                          href={p.apiKeyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:underline"
                        >
                          <span>
                            {lang === 'ar' ? 'جلب مفتاح مجاني' : 'Get Free Key'}
                          </span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <CopyButton text={p.apiKeyUrl} compact title={t.copy} />
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-4">
                    {p.health === 'healthy' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {lang === 'ar' ? 'شغال / جاهز' : t.healthHealthy}
                        </span>
                      </span>
                    )}
                    {p.health === 'needs_key' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
                        <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                        <span>
                          {lang === 'ar' ? 'يحتاج مفتاح API' : 'Needs Key'}
                        </span>
                      </span>
                    )}
                    {p.health === 'degraded' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{t.healthDegraded}</span>
                      </span>
                    )}
                    {p.health === 'circuit_open' && (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{t.healthCircuitOpen}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateProvider(p.id, { resetCircuit: true })
                          }
                          className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline whitespace-nowrap"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>{t.resetCircuit}</span>
                        </button>
                      </div>
                    )}
                    {p.lastError && p.health !== 'healthy' && (
                      <div className="text-[11px] text-slate-400 truncate max-w-[160px] mt-0.5">
                        {p.lastError}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-4 text-end font-mono tabular-nums text-xs text-slate-700">
                    <div>{p.avgLatencyMs ? `${p.avgLatencyMs} ms` : '—'}</div>
                    <div className="text-[11px] text-slate-400">
                      {p.successfulRequests}/{p.totalRequests}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {p.adapter === 'sandbox-simulator' ? (
                        <select
                          value={p.simulatorBehavior}
                          onChange={(e) =>
                            onUpdateProvider(p.id, {
                              simulatorBehavior: e.target
                                .value as SimulatorBehavior,
                            })
                          }
                          className="px-2 py-1 text-xs bg-white border border-slate-300 rounded-md"
                        >
                          <option value="healthy">{t.simHealthy}</option>
                          <option value="rate_limit_429">{t.sim429}</option>
                          <option value="server_error_503">{t.sim503}</option>
                          <option value="latency_spike">{t.simLatency}</option>
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded transition-colors whitespace-nowrap"
                        >
                          {p.keyConfigured
                            ? lang === 'ar'
                              ? 'تعديل'
                              : 'Edit'
                            : lang === 'ar'
                              ? 'إضافة مفتاح'
                              : 'Set Key'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleProbeOne(p.id)}
                        disabled={probingId === p.id}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap"
                      >
                        {probingId === p.id
                          ? '...'
                          : lang === 'ar'
                            ? 'فحص'
                            : 'Probe'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onUpdateProvider(p.id, { enabled: !p.enabled })
                        }
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap"
                      >
                        {p.enabled ? t.revokeKey : t.activateKey}
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteProvider(p.id)}
                        aria-label="Delete provider"
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Centered Edit / Set API Key Modal */}
      {editingProvider && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setEditingProvider(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEdit}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {editingProvider.name}
                </h2>
                {editingProvider.apiKeyUrl && (
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <a
                      href={editingProvider.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"
                    >
                      <span>
                        {lang === 'ar'
                          ? 'افتح صفحة جلب المفتاح المجاني لهذا المزود'
                          : 'Open free API key page'}
                      </span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <CopyButton
                      text={editingProvider.apiKeyUrl}
                      compact
                      title={t.copy}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditingProvider(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editingProvider.adapter === 'gemini' && hasGeminiEnvKey && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer bg-slate-50 border border-slate-200 rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={editUseEnv}
                  onChange={(e) => setEditUseEnv(e.target.checked)}
                />
                <span>{t.providerUseEnvLabel}</span>
              </label>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.providerApiKeyLabel}
              </label>
              <div className="relative">
                <input
                  type={showEditApiKey ? 'text' : 'password'}
                  dir="ltr"
                  autoFocus
                  disabled={editUseEnv}
                  value={editUseEnv ? 'env:GEMINI_API_KEY' : editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder={
                    editingProvider.keyConfigured
                      ? `${editingProvider.apiKeyMasked} (leave empty to keep current)`
                      : 'Paste your API key here...'
                  }
                  className="w-full ps-3 pe-10 py-2 text-sm font-mono bg-white disabled:bg-slate-50 border border-slate-300 rounded-lg"
                />
                {!editUseEnv && (
                  <button
                    type="button"
                    onClick={() => setShowEditApiKey((v) => !v)}
                    aria-label={showEditApiKey ? 'Hide API key' : 'Show API key'}
                    className="absolute inset-y-0 end-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    {showEditApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  {t.providerModelLabel}
                </label>
                {editModel && <CopyButton text={editModel} compact title={t.copy} />}
              </div>
              <input
                type="text"
                dir="ltr"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            {editingProvider.adapter !== 'gemini' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    {t.providerBaseUrlLabel}
                  </label>
                  {editBaseUrl && (
                    <CopyButton text={editBaseUrl} compact title={t.copy} />
                  )}
                </div>
                <input
                  type="url"
                  dir="ltr"
                  value={editBaseUrl}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingProvider(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                {savingEdit ? '...' : lang === 'ar' ? 'حفظ وتفعيل' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Centered Routing Policy Modal */}
      {showPolicyModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setShowPolicyModal(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSavePolicy}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                {t.routingPolicyTitle}
              </h2>
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                {t.strategyLabel}
              </label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as RoutingStrategy)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="priority_failover">{t.strategyPriority}</option>
                <option value="round_robin">{t.strategyRoundRobin}</option>
                <option value="lowest_latency">{t.strategyLowestLatency}</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {t.maxRetriesLabel}
                </label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {t.circuitThresholdLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {t.cooldownLabel}
                </label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={cooldown}
                  onChange={(e) => setCooldown(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                {policySaved ? t.policySaved : t.savePolicyBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Centered Add Provider Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setShowAddModal(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateProvider}
            className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                {t.providerModalTitle}
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerNameLabel}
                </label>
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Custom Provider"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerAdapterLabel}
                </label>
                <select
                  value={pAdapter}
                  onChange={(e) =>
                    setPAdapter(e.target.value as ProviderAdapter)
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="openai-compatible">OpenAI-Compatible REST</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="anthropic">Anthropic Messages</option>
                  <option value="custom-rest">Custom REST JSON Endpoint</option>
                  <option value="sandbox-simulator">Sandbox Failover Node</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerBaseUrlLabel}
                </label>
                <input
                  type="url"
                  dir="ltr"
                  required={pAdapter !== 'sandbox-simulator'}
                  disabled={pAdapter === 'sandbox-simulator' || pAdapter === 'gemini'}
                  value={pBaseUrl}
                  onChange={(e) => setPBaseUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white disabled:bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerModelLabel}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={pModel}
                  onChange={(e) => setPModel(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {pAdapter !== 'sandbox-simulator' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerApiKeyLabel}
                </label>
                <input
                  type="password"
                  dir="ltr"
                  disabled={pUseEnv}
                  value={pUseEnv ? 'env:GEMINI_API_KEY' : pApiKey}
                  onChange={(e) => setPApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 text-sm font-mono bg-white disabled:bg-slate-50 border border-slate-300 rounded-lg"
                />
                {pAdapter === 'gemini' && hasGeminiEnvKey && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pUseEnv}
                      onChange={(e) => setPUseEnv(e.target.checked)}
                    />
                    <span>{t.providerUseEnvLabel}</span>
                  </label>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerPriorityLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={pPriority}
                  onChange={(e) => setPPriority(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {t.providerTimeoutLabel}
                </label>
                <input
                  type="number"
                  min={1000}
                  max={30000}
                  step={500}
                  value={pTimeout}
                  onChange={(e) => setPTimeout(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {formError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                {submitting ? '...' : t.saveProviderBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Centered Bulk Import Modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setShowBulkModal(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleBulkSubmit}
            className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                {t.bulkImportTitle}
              </h2>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-900">
                {lang === 'ar'
                  ? 'استخراج تلقائي من رابط GitHub أو OpenRouter'
                  : 'Auto-Extract from GitHub or OpenRouter URL'}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  dir="ltr"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://github.com/... or https://openrouter.ai/api/v1/models"
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={handleImportUrlClick}
                  disabled={importingUrl || !importUrl.trim()}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                >
                  {importingUrl
                    ? '...'
                    : lang === 'ar'
                      ? 'سحب من الرابط'
                      : 'Extract URL'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                {lang === 'ar'
                  ? 'أو الصق مصفوفة JSON يدوياً:'
                  : 'Or paste provider JSON array:'}
              </label>
              <textarea
                dir="ltr"
                rows={7}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
            {bulkStatus && (
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2">
                {bulkStatus}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                {t.bulkImportBtnSubmit}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
