import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  KeyRound,
  MessageSquare,
  Mic,
  Plus,
  Video,
  XCircle,
} from 'lucide-react';
import type {
  AccessKeyPublicView,
  CreatedKeySecretResponse,
  ImageSpecialty,
  Language,
  ProviderCategory,
  UpstreamProviderPublicView,
} from '../types/taygos';
import { CopyButton } from './CopyButton';
import type { WorkspaceTab } from './TopBar';

interface HomeDashboardProps {
  lang: Language;
  gatewayEndpointUrl: string;
  keys: AccessKeyPublicView[];
  providers: UpstreamProviderPublicView[];
  onCreateKey: (input: {
    name: string;
    description: string;
    requireHmac: boolean;
  }) => Promise<CreatedKeySecretResponse | null>;
  onProbeAllProviders: () => Promise<{
    checkedCount: number;
    operationalCount: number;
  } | null>;
  onNavigate: (tab: WorkspaceTab, imageSpecialty?: ImageSpecialty) => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  lang,
  gatewayEndpointUrl,
  keys,
  providers,
  onCreateKey,
  onProbeAllProviders,
  onNavigate,
}) => {
  const [quickAppName, setQuickAppName] = useState('');
  const [creating, setCreating] = useState(false);
  const [generated, setGenerated] = useState<CreatedKeySecretResponse | null>(null);
  const [showPublic, setShowPublic] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<
    'chat' | 'images' | 'videos' | 'audio' | 'documents'
  >('chat');

  const [probingAll, setProbingAll] = useState(false);
  const [probeResultText, setProbeResultText] = useState<string | null>(null);

  const baseApi = gatewayEndpointUrl.replace(/\/gateway$/, '');
  const endpointUrls = {
    chat: `${baseApi}/chat/completions`,
    images: `${baseApi}/images/generations`,
    videos: `${baseApi}/videos/generations`,
    audio: `${baseApi}/audio/speech`,
    documents: `${baseApi}/documents/storyboard`,
  };

  const handleQuickGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const label =
      quickAppName.trim() ||
      (lang === 'ar'
        ? `تطبيق موحد #${keys.length + 1}`
        : `Unified App #${keys.length + 1}`);
    const res = await onCreateKey({
      name: label,
      description: lang === 'ar' ? 'شامل (صور + شات + فيديو + صوت)' : 'Unified Multi-Modal',
      requireHmac: false,
    });
    setCreating(false);
    if (res) {
      setGenerated(res);
      setQuickAppName('');
      setShowSecret(false);
    }
  };

  const handleProbeAll = async () => {
    setProbingAll(true);
    setProbeResultText(null);
    const res = await onProbeAllProviders();
    setProbingAll(false);
    if (res) {
      setProbeResultText(
        lang === 'ar'
          ? `تم الفحص الحي لـ ${res.checkedCount} مزودين: ${res.operationalCount} شغال بنجاح`
          : `Checked ${res.checkedCount} live providers: ${res.operationalCount} operational`
      );
    }
  };

  const categoryConfigs: Array<{
    category: ProviderCategory;
    tab: WorkspaceTab;
    title: string;
    subtitle: string;
    endpointUrl: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      category: 'llm',
      tab: 'providers',
      title: lang === 'ar' ? 'الشات والنصوص والبرمجة' : 'Chat, Text & Vision LLMs',
      subtitle: lang === 'ar' ? 'Groq, Gemini, OpenRouter, Pollinations...' : 'Groq, Gemini, OpenRouter, Pollinations...',
      endpointUrl: endpointUrls.chat,
      icon: MessageSquare,
    },
    {
      category: 'image',
      tab: 'images',
      title: lang === 'ar' ? 'الصور وتفريغ وتعديل الخلفيات' : 'Images, BG Removal & Relighting',
      subtitle: lang === 'ar' ? 'RMBG-2.0, IC-Light, Flux, Imagen, Sana' : 'RMBG-2.0, IC-Light, Flux, Imagen, Sana',
      endpointUrl: endpointUrls.images,
      icon: ImageIcon,
    },
    {
      category: 'video',
      tab: 'videos',
      title: lang === 'ar' ? 'توليد الفيديو والمونتاج' : 'Video Generation & Stock',
      subtitle: lang === 'ar' ? 'Wan2.1, CogVideoX, Veo, WaveSpeed, Pixabay' : 'Wan2.1, CogVideoX, Veo, WaveSpeed, Pixabay',
      endpointUrl: endpointUrls.videos,
      icon: Video,
    },
    {
      category: 'audio',
      tab: 'audio',
      title: lang === 'ar' ? 'الصوتيات (تحويل نص لصوت والعكس)' : 'Audio & Voice (TTS + Whisper STT)',
      subtitle: lang === 'ar' ? 'Pollinations Audio, Kokoro-82M, Whisper v3' : 'Pollinations Audio, Kokoro-82M, Whisper v3',
      endpointUrl: endpointUrls.audio,
      icon: Mic,
    },
    {
      category: 'documents',
      tab: 'documents',
      title: lang === 'ar' ? 'ملفات PDF والستوري بورد' : 'PDF & Storyboard Export',
      subtitle: lang === 'ar' ? 'محرك Storyboard المدمج + Gotenberg' : 'Built-in Storyboard + Gotenberg',
      endpointUrl: endpointUrls.documents,
      icon: FileText,
    },
  ];

  const overallStats = useMemo(() => {
    const working = providers.filter(
      (p) => p.enabled && p.keyConfigured && p.health !== 'circuit_open'
    );
    const notWorking = providers.filter(
      (p) => !p.enabled || !p.keyConfigured || p.health === 'circuit_open'
    );
    return {
      total: providers.length,
      workingCount: working.length,
      notWorkingCount: notWorking.length,
    };
  }, [providers]);

  const DirectionalArrow = lang === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <div className="space-y-5">
      {/* 1) TOP SECTION: Single Unified API Generator (Public + Secret + 1 Link) */}
      <section className="bg-white border border-teal-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900">
              {lang === 'ar'
                ? 'توليد API واحد موحد (Public + Secret)'
                : 'Generate One Unified API (Public + Secret)'}
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              {lang === 'ar'
                ? 'اعمل مفتاح واحد دائم يشغّل كل الأقسام (شات، صور، عزل خلفيات، فيديو، صوت، PDF) مع تبديل تلقائي بين المزودين.'
                : 'Issue one perpetual key pair that powers Chat, Images, Video, Audio, and PDF with automatic provider failover.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('keys')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>
              {lang === 'ar'
                ? `تطبيقاتي المحفوظة (${keys.length})`
                : `Saved Apps (${keys.length})`}
            </span>
          </button>
        </div>

        <form onSubmit={handleQuickGenerate} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            maxLength={80}
            value={quickAppName}
            onChange={(e) => setQuickAppName(e.target.value)}
            placeholder={
              lang === 'ar'
                ? 'اكتب اسم التطبيق (مثلاً: متجري أو الشمساوية) — اختياري'
                : 'App name (e.g. My Store or Chat App) — optional'
            }
            className="flex-1 min-w-0 px-3.5 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>
              {creating
                ? '...'
                : lang === 'ar'
                  ? 'توليد Public + Secret الآن'
                  : 'Generate Public + Secret'}
            </span>
          </button>
        </form>

        {/* Quick Unified Endpoint Switcher + Copyable Keys */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-700">
              {lang === 'ar' ? 'الرابط الموحد للتطبيق:' : 'Unified Endpoint URL:'}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['chat', lang === 'ar' ? 'شات' : 'Chat'],
                  ['images', lang === 'ar' ? 'صور وخلفيات' : 'Images'],
                  ['videos', lang === 'ar' ? 'فيديو' : 'Videos'],
                  ['audio', lang === 'ar' ? 'صوت' : 'Audio'],
                  ['documents', lang === 'ar' ? 'PDF/ستوري' : 'PDF'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedEndpoint(id)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                    selectedEndpoint === id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <code
              dir="ltr"
              className="text-xs font-mono text-slate-900 break-all select-all flex-1 min-w-0"
            >
              {endpointUrls[selectedEndpoint]}
            </code>
            <CopyButton
              text={endpointUrls[selectedEndpoint]}
              label={lang === 'ar' ? 'نسخ' : 'Copy'}
              copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
              className="bg-white"
            />
          </div>

          {generated && (
            <div className="pt-2.5 border-t border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-emerald-800">
                {lang === 'ar'
                  ? `تم التوليد بنجاح لـ "${generated.key.name}" — جاهز للنسخ:`
                  : `Issued for "${generated.key.name}" — Ready to copy:`}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-slate-500">Public Key (X-Taygos-Public-Key)</div>
                    <code dir="ltr" className="font-mono text-slate-900 break-all block">
                      {showPublic ? generated.key.publicKey : '••••••••••••••••••••'}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowPublic((v) => !v)}
                      className="p-1 border border-slate-200 rounded text-slate-600 hover:text-slate-900"
                    >
                      {showPublic ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <CopyButton text={generated.key.publicKey} compact />
                  </div>
                </div>

                <div className="bg-white border border-teal-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-teal-700">Secret Key (X-Taygos-Secret-Key)</div>
                    <code dir="ltr" className="font-mono text-teal-950 break-all block">
                      {showSecret ? generated.secretKey : '••••••••••••••••••••'}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="p-1 border border-slate-200 rounded text-slate-600 hover:text-slate-900"
                    >
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <CopyButton text={generated.secretKey} compact />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] text-slate-500 block">
                    {lang === 'ar'
                      ? 'صيغة مفتاح واحد للتطبيقات (Authorization: Bearer pk:sk):'
                      : 'Combined Single API Key (Bearer pk:sk):'}
                  </span>
                  <code dir="ltr" className="font-mono text-slate-800 break-all">
                    {showSecret
                      ? `${generated.key.publicKey}:${generated.secretKey}`
                      : `${generated.key.publicKey}:••••••••••••••••`}
                  </code>
                </div>
                <CopyButton
                  text={`${generated.key.publicKey}:${generated.secretKey}`}
                  label={lang === 'ar' ? 'نسخ Bearer' : 'Copy Bearer'}
                  copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2) DIRECTLY BELOW: Providers Inventory — Working vs Not Working */}
      <section className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900">
              {lang === 'ar'
                ? 'حالة المزودات عندنا (الشغال الآن vs غير المفعل)'
                : 'Providers Status (Working vs Needs Key / Inactive)'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                {lang === 'ar' ? 'الإجمالي:' : 'Total:'}{' '}
                <strong className="font-mono text-slate-900">{overallStats.total}</strong>
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {lang === 'ar' ? 'شغال وجاهز الآن:' : 'Working Ready:'}{' '}
                  <strong className="font-mono">{overallStats.workingCount}</strong>
                </span>
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <XCircle className="w-3.5 h-3.5" />
                <span>
                  {lang === 'ar' ? 'يحتاج مفتاح أو معطل:' : 'Needs Key / Off:'}{' '}
                  <strong className="font-mono">{overallStats.notWorkingCount}</strong>
                </span>
              </span>
            </div>
            {probeResultText && (
              <div className="mt-2 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1 rounded-lg inline-block">
                {probeResultText}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleProbeAll}
            disabled={probingAll}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
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
        </div>

        {/* 5 Category Cards: Open Each Section Directly at Top */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {categoryConfigs.map((cfg) => {
            const Icon = cfg.icon;
            const list = providers.filter((p) => (p.category || 'llm') === cfg.category);
            const workingList = list.filter(
              (p) => p.enabled && p.keyConfigured && p.health !== 'circuit_open'
            );
            const inactiveList = list.filter(
              (p) => !p.enabled || !p.keyConfigured || p.health === 'circuit_open'
            );

            return (
              <div
                key={cfg.category}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3 hover:border-teal-300 transition-colors"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="p-2 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 truncate">
                          {cfg.title}
                        </h3>
                        <p className="text-[11px] text-slate-500 truncate">{cfg.subtitle}</p>
                      </div>
                    </div>
                  </div>

                  {/* Working vs Not Working Count Bar */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-emerald-800 font-medium">
                        {lang === 'ar' ? 'شغال' : 'Working'}
                      </span>
                      <strong className="font-mono text-emerald-900">
                        {workingList.length}
                      </strong>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">
                        {lang === 'ar' ? 'غير مفعل' : 'Inactive'}
                      </span>
                      <strong className="font-mono text-slate-800">
                        {inactiveList.length}
                      </strong>
                    </div>
                  </div>

                  {/* Names of Working Providers Right Here */}
                  <div className="text-[11px] text-slate-600 space-y-1">
                    <div className="font-medium text-slate-700">
                      {lang === 'ar' ? 'الشغال مجاناً حالياً:' : 'Currently working:'}
                    </div>
                    {workingList.length > 0 ? (
                      <div className="text-emerald-800 leading-relaxed line-clamp-2">
                        {workingList.slice(0, 4).map((p) => p.name).join(' · ')}
                        {workingList.length > 4 ? ` (+${workingList.length - 4})` : ''}
                      </div>
                    ) : (
                      <div className="text-amber-700">
                        {lang === 'ar'
                          ? 'يحتاج إضافة مفتاح مجاني من داخل القسم'
                          : 'Add a free API key inside to activate'}
                      </div>
                    )}
                  </div>

                  {/* Direct Sub-Specialty Shortcuts for Images */}
                  {cfg.category === 'image' && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {(
                        [
                          ['bg_removal', lang === 'ar' ? 'عزل الصور' : 'BG Removal'],
                          ['bg_edit', lang === 'ar' ? 'تعديل الخلفية' : 'BG Edit'],
                          ['generate', lang === 'ar' ? 'توليد صور' : 'Generate'],
                        ] as const
                      ).map(([spec, label]) => (
                        <button
                          key={spec}
                          type="button"
                          onClick={() => onNavigate('images', spec)}
                          className="px-2 py-0.5 text-[11px] font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Endpoint Copy + Open Section Button */}
                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  <CopyButton
                    text={cfg.endpointUrl}
                    label={lang === 'ar' ? 'نسخ الرابط' : 'Copy URL'}
                    copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
                    className="bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate(cfg.tab, cfg.category === 'image' ? 'all' : undefined)
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>
                      {lang === 'ar' ? `دخول (${list.length})` : `Open (${list.length})`}
                    </span>
                    <DirectionalArrow className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
