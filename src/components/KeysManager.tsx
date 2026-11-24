import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Infinity as InfinityIcon,
  KeyRound,
  Pencil,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AccessKeyPublicView,
  CreatedKeySecretResponse,
  Language,
  RevealKeyResponse,
} from '../types/taygos';
import { useT } from '../i18n/translations';
import { CopyButton } from './CopyButton';

interface KeysManagerProps {
  lang: Language;
  gatewayEndpointUrl: string;
  keys: AccessKeyPublicView[];
  isCreateModalOpen: boolean;
  onOpenCreateModal: () => void;
  onCloseCreateModal: () => void;
  onCreateKey: (input: {
    name: string;
    description: string;
    requireHmac: boolean;
  }) => Promise<CreatedKeySecretResponse | null>;
  onUpdateKeyMeta: (
    keyId: string,
    patch: { name?: string; description?: string }
  ) => Promise<void>;
  onRevealKey: (keyId: string) => Promise<RevealKeyResponse | null>;
  onToggleKeyStatus: (key: AccessKeyPublicView) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<CreatedKeySecretResponse | null>;
  onDeleteKey: (keyId: string) => Promise<void>;
  onLoadInPlayground: (publicKey: string, secretKey: string) => void;
}

interface RevealedModalState {
  id: string;
  name: string;
  publicKey: string;
  secretKey: string | null;
  requiresRotation?: boolean;
  message?: string;
}

async function copyStringWithFallback(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export const KeysManager: React.FC<KeysManagerProps> = ({
  lang,
  gatewayEndpointUrl,
  keys,
  isCreateModalOpen,
  onOpenCreateModal,
  onCloseCreateModal,
  onCreateKey,
  onUpdateKeyMeta,
  onRevealKey,
  onToggleKeyStatus,
  onRotateKey,
  onDeleteKey,
  onLoadInPlayground,
}) => {
  const t = useT(lang);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [requireHmac, setRequireHmac] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalSecret, setModalSecret] = useState<RevealedModalState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Accordion state: all collapsed by default; opening one auto-closes others
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Inline tag editing for existing apps
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagText, setEditingTagText] = useState('');
  const [savingTag, setSavingTag] = useState(false);

  // Endpoint quick-switch per card ('chat' | 'images' | 'videos' | 'audio' | 'storyboard')
  const [endpointChoiceById, setEndpointChoiceById] = useState<
    Record<string, 'chat' | 'images' | 'videos' | 'audio' | 'storyboard'>
  >({});

  // Per-card visibility states (both hidden by default per user spec)
  const [visiblePublic, setVisiblePublic] = useState<Record<string, boolean>>({});
  const [visibleSecret, setVisibleSecret] = useState<Record<string, boolean>>({});
  // Ephemeral in-memory cache for fetched secrets (never persisted to storage)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [loadingSecretId, setLoadingSecretId] = useState<string | null>(null);
  const [needsRotationById, setNeedsRotationById] = useState<Record<string, boolean>>({});
  const [copiedState, setCopiedState] = useState<Record<string, boolean>>({});

  const openaiBaseUrl = gatewayEndpointUrl.replace(/\/gateway$/, '');
  const openaiChatUrl = `${openaiBaseUrl}/chat/completions`;
  const imagesEndpointUrl = `${openaiBaseUrl}/images/generations`;
  const videosEndpointUrl = `${openaiBaseUrl}/videos/generations`;
  const audioEndpointUrl = `${openaiBaseUrl}/audio/speech`;
  const storyboardEndpointUrl = `${openaiBaseUrl}/documents/storyboard`;

  const presetLabels =
    lang === 'ar'
      ? ['شات ذكاء اصطناعي', 'توليد صور وخلفيات', 'توليد فيديو', 'صوتيات TTS', 'ستوري بورد و PDF', 'شامل']
      : ['AI Chat', 'Image & Backgrounds', 'Video Gen', 'Audio TTS', 'Storyboard & PDF', 'Unified'];

  const resolveDefaultEndpointChoice = (
    desc: string
  ): 'chat' | 'images' | 'videos' | 'audio' | 'storyboard' => {
    const lower = desc.toLowerCase();
    if (/صور|خلف|image|photo|flux/.test(lower)) return 'images';
    if (/فيديو|video|veo|clips/.test(lower)) return 'videos';
    if (/صوت|audio|tts|speech|whisper/.test(lower)) return 'audio';
    if (/pdf|ستوري|story|مستند/.test(lower)) return 'storyboard';
    return 'chat';
  };

  const getUrlForChoice = (
    choice: 'chat' | 'images' | 'videos' | 'audio' | 'storyboard'
  ): string => {
    if (choice === 'images') return imagesEndpointUrl;
    if (choice === 'videos') return videosEndpointUrl;
    if (choice === 'audio') return audioEndpointUrl;
    if (choice === 'storyboard') return storyboardEndpointUrl;
    return openaiChatUrl;
  };

  const markCopied = (badgeKey: string) => {
    setCopiedState((prev) => ({ ...prev, [badgeKey]: true }));
    setTimeout(() => {
      setCopiedState((prev) => ({ ...prev, [badgeKey]: false }));
    }, 1600);
  };

  const fetchSecretIntoMemory = async (keyId: string): Promise<string | null> => {
    const cached = revealedSecrets[keyId];
    if (cached) return cached;

    setLoadingSecretId(keyId);
    const res = await onRevealKey(keyId);
    setLoadingSecretId(null);

    if (res?.secretKey) {
      const secret = res.secretKey;
      setRevealedSecrets((prev) => ({ ...prev, [keyId]: secret }));
      setNeedsRotationById((prev) => ({ ...prev, [keyId]: false }));
      return secret;
    }

    if (res?.requiresRotation) {
      setNeedsRotationById((prev) => ({ ...prev, [keyId]: true }));
    }
    return null;
  };

  const handleTogglePublicEye = (keyId: string) => {
    setVisiblePublic((prev) => ({ ...prev, [keyId]: !prev[keyId] }));
  };

  const handleToggleSecretEye = async (keyId: string) => {
    if (visibleSecret[keyId]) {
      setVisibleSecret((prev) => ({ ...prev, [keyId]: false }));
      return;
    }
    const secret = await fetchSecretIntoMemory(keyId);
    if (secret) {
      setVisibleSecret((prev) => ({ ...prev, [keyId]: true }));
    }
  };

  const handleCopyHiddenSecret = async (
    k: AccessKeyPublicView,
    mode: 'secret' | 'bearer'
  ) => {
    const badgeKey = `${mode}:${k.id}`;
    const formatValue = (sk: string) =>
      mode === 'bearer' ? `${k.publicKey}:${sk}` : sk;

    const cached = revealedSecrets[k.id];
    if (cached) {
      const ok = await copyStringWithFallback(formatValue(cached));
      if (ok) markCopied(badgeKey);
      return;
    }

    if (
      typeof ClipboardItem !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function'
    ) {
      try {
        let fetchedValue: string | null = null;
        const item = new ClipboardItem({
          'text/plain': fetchSecretIntoMemory(k.id).then((sk) => {
            fetchedValue = sk;
            if (!sk) {
              throw new Error('Secret requires rotation');
            }
            return new Blob([formatValue(sk)], { type: 'text/plain' });
          }),
        });
        await navigator.clipboard.write([item]);
        if (fetchedValue) {
          markCopied(badgeKey);
          return;
        }
      } catch {
        // Fall through
      }
    }

    const secret = await fetchSecretIntoMemory(k.id);
    if (!secret) return;
    const ok = await copyStringWithFallback(formatValue(secret));
    if (ok) markCopied(badgeKey);
  };

  const handlePlaygroundClick = async (k: AccessKeyPublicView) => {
    const secret = (await fetchSecretIntoMemory(k.id)) || '';
    onLoadInPlayground(k.publicKey, secret);
  };

  const handleSaveTag = async (keyId: string) => {
    setSavingTag(true);
    await onUpdateKeyMeta(keyId, { description: editingTagText.trim() });
    setSavingTag(false);
    setEditingTagId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const created = await onCreateKey({
      name: name.trim(),
      description: description.trim(),
      requireHmac,
    });
    setSubmitting(false);
    if (created) {
      setRevealedSecrets((prev) => ({
        ...prev,
        [created.key.id]: created.secretKey,
      }));
      setNeedsRotationById((prev) => ({ ...prev, [created.key.id]: false }));
      setExpandedId(created.key.id);
      setModalSecret({
        id: created.key.id,
        name: created.key.name,
        publicKey: created.key.publicKey,
        secretKey: created.secretKey,
      });
      setName('');
      setDescription('');
      setRequireHmac(false);
      onCloseCreateModal();
    }
  };

  const handleRotate = async (keyId: string) => {
    const rotated = await onRotateKey(keyId);
    if (rotated) {
      setRevealedSecrets((prev) => ({
        ...prev,
        [rotated.key.id]: rotated.secretKey,
      }));
      setNeedsRotationById((prev) => ({ ...prev, [rotated.key.id]: false }));
      setModalSecret({
        id: rotated.key.id,
        name: rotated.key.name,
        publicKey: rotated.key.publicKey,
        secretKey: rotated.secretKey,
      });
    }
  };

  const envBlockText = modalSecret?.secretKey
    ? `TAYGOS_GATEWAY_URL="${gatewayEndpointUrl}"\nTAYGOS_OPENAI_BASE_URL="${openaiBaseUrl}"\nTAYGOS_PUBLIC_KEY="${modalSecret.publicKey}"\nTAYGOS_SECRET_KEY="${modalSecret.secretKey}"`
    : '';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Compact Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
            {t.navKeys}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            {lang === 'ar'
              ? 'اضغط على السهم بجانب أي تطبيق لفتحه وأخذ مفاتيحه — يتقفل تلقائياً عند فتح تطبيق آخر.'
              : 'Tap any app arrow to expand its credentials — opening another app collapses the previous one.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>{t.newKeyCta}</span>
        </button>
      </div>

      {/* Accordion App Cards (All Closed by Default) */}
      {keys.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <KeyRound className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-slate-900">
            {t.emptyKeysTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md mx-auto">
            {t.emptyKeysDesc}
          </p>
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{t.newKeyCta}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => {
            const isExpanded = expandedId === k.id;
            const isEditingTag = editingTagId === k.id;
            const isPublicShown = Boolean(visiblePublic[k.id]);
            const isSecretShown = Boolean(visibleSecret[k.id]);
            const secretPlain = revealedSecrets[k.id];
            const secretCopied = Boolean(copiedState[`secret:${k.id}`]);
            const bearerCopied = Boolean(copiedState[`bearer:${k.id}`]);
            const isLoadingSecret = loadingSecretId === k.id;
            const requiresRotation = Boolean(needsRotationById[k.id]);
            const activeChoice =
              endpointChoiceById[k.id] ||
              resolveDefaultEndpointChoice(k.description || '');
            const activeEndpointUrl = getUrlForChoice(activeChoice);

            return (
              <article
                key={k.id}
                className={`bg-white border rounded-xl transition-colors ${
                  isExpanded
                    ? 'border-teal-300 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Collapsed Summary Header (Always Visible, Click Arrow/Row to Expand or Collapse) */}
                <div
                  onClick={() =>
                    setExpandedId((prev) => (prev === k.id ? null : k.id))
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId((prev) => (prev === k.id ? null : k.id));
                    }
                  }}
                  aria-expanded={isExpanded}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-2.5 cursor-pointer select-none"
                >
                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm sm:text-base font-semibold text-slate-900 break-words">
                      {k.name}
                    </span>

                    {/* Descriptive Word / Tag right next to the App Name */}
                    {k.description ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md">
                        <span>{k.description}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] text-slate-400 bg-slate-50 border border-slate-200 rounded-md">
                        {lang === 'ar' ? 'بدون وصف' : 'Untagged'}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTagId(isEditingTag ? null : k.id);
                        setEditingTagText(k.description || '');
                      }}
                      title={
                        lang === 'ar'
                          ? 'تعديل الكلمة التعريفية'
                          : 'Edit tag'
                      }
                      aria-label={
                        lang === 'ar' ? 'تعديل الكلمة التعريفية' : 'Edit tag'
                      }
                      className="p-1 text-slate-400 hover:text-teal-700 hover:bg-slate-100 rounded transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <CopyButton
                      text={k.name}
                      compact
                      title={t.copy}
                      copiedLabel={lang === 'ar' ? 'تم' : 'Done'}
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {k.status === 'active' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 whitespace-nowrap">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t.statusActive}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 whitespace-nowrap">
                        <ShieldOff className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t.statusRevoked}</span>
                      </span>
                    )}

                    <span className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </span>
                  </div>
                </div>

                {/* Inline Descriptive Word Editor (Works whether card is open or closed!) */}
                {isEditingTag && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="px-3.5 sm:px-4 pb-3.5 pt-2 border-t border-slate-100 bg-slate-50/70 space-y-2"
                  >
                    <div className="text-[11px] font-medium text-slate-700">
                      {lang === 'ar'
                        ? 'اكتب أو اختر كلمة تعريفية تظهر بجانب اسم التطبيق:'
                        : 'Set a short descriptive tag next to app name:'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {presetLabels.map((lbl) => (
                        <button
                          key={lbl}
                          type="button"
                          onClick={() => setEditingTagText(lbl)}
                          className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                            editingTagText === lbl
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={80}
                        value={editingTagText}
                        onChange={(e) => setEditingTagText(e.target.value)}
                        placeholder={
                          lang === 'ar'
                            ? 'مثال: توليد صور، شات، فيديو...'
                            : 'e.g., Image Gen, AI Chat...'
                        }
                        className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={savingTag}
                        onClick={() => handleSaveTag(k.id)}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap"
                      >
                        {savingTag ? '...' : lang === 'ar' ? 'حفظ' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTagId(null)}
                        className="px-2.5 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded Body (Credentials, Endpoint URL, Masked Public & Secret + Eye + Copy) */}
                {isExpanded && (
                  <div className="px-3.5 sm:px-4 pb-4 pt-3 border-t border-slate-100 space-y-3">
                    {/* 1. App Endpoint URL + Quick Switcher (Chat / Images / Videos / Storyboard) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-600">
                          {lang === 'ar'
                            ? 'رابط التطبيق الموحد:'
                            : 'Unified Endpoint URL:'}
                        </span>
                        <div className="flex flex-wrap items-center gap-1">
                          {(
                            [
                              ['chat', lang === 'ar' ? 'شات' : 'Chat'],
                              ['images', lang === 'ar' ? 'صور' : 'Images'],
                              ['videos', lang === 'ar' ? 'فيديو' : 'Videos'],
                              ['audio', lang === 'ar' ? 'صوت' : 'Audio'],
                              ['storyboard', lang === 'ar' ? 'PDF/ستوري' : 'Storyboard'],
                            ] as const
                          ).map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() =>
                                setEndpointChoiceById((prev) => ({
                                  ...prev,
                                  [k.id]: mode,
                                }))
                              }
                              className={`px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                                activeChoice === mode
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
                          className="text-xs font-mono text-slate-900 break-all select-all min-w-0 flex-1"
                        >
                          {activeEndpointUrl}
                        </code>
                        <CopyButton
                          text={activeEndpointUrl}
                          compact
                          title={t.copy}
                          copiedLabel={lang === 'ar' ? 'تم' : 'Done'}
                        />
                      </div>
                    </div>

                    {/* 2. Public Key Header Name + Masked/Toggleable Public Key Value + Copy */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="text-[11px] font-medium text-slate-600">
                            {lang === 'ar' ? 'اسم البابليك كي:' : 'Public Header:'}
                          </span>
                          <code
                            dir="ltr"
                            className="text-xs font-mono font-semibold text-slate-900 bg-white border border-slate-200 px-1.5 py-0.5 rounded break-all"
                          >
                            X-Taygos-Public-Key
                          </code>
                        </div>
                        <CopyButton
                          text="X-Taygos-Public-Key"
                          compact
                          title={t.copy}
                          copiedLabel={lang === 'ar' ? 'تم' : 'Done'}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-500 mb-0.5">
                            {t.publicKeyLabel}
                          </div>
                          <code
                            dir="ltr"
                            className="block text-xs font-mono text-slate-900 break-all"
                          >
                            {isPublicShown
                              ? k.publicKey
                              : '••••••••••••••••••••••••••••'}
                          </code>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTogglePublicEye(k.id)}
                            aria-label={
                              isPublicShown
                                ? lang === 'ar'
                                  ? 'إخفاء البابليك كي'
                                  : 'Hide public key'
                                : lang === 'ar'
                                  ? 'إظهار البابليك كي'
                                  : 'Show public key'
                            }
                            className="p-1.5 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded transition-colors"
                          >
                            {isPublicShown ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <CopyButton
                            text={k.publicKey}
                            compact
                            title={t.copy}
                            copiedLabel={lang === 'ar' ? 'تم' : 'Done'}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 3. Secret Key Header Name + Masked/Toggleable Secret Key Value + Copy */}
                    <div className="bg-slate-50 border border-teal-200/80 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="text-[11px] font-medium text-teal-800">
                            {lang === 'ar' ? 'اسم السيكريت كي:' : 'Secret Header:'}
                          </span>
                          <code
                            dir="ltr"
                            className="text-xs font-mono font-semibold text-teal-950 bg-white border border-teal-200 px-1.5 py-0.5 rounded break-all"
                          >
                            X-Taygos-Secret-Key
                          </code>
                        </div>
                        <CopyButton
                          text="X-Taygos-Secret-Key"
                          compact
                          title={t.copy}
                          copiedLabel={lang === 'ar' ? 'تم' : 'Done'}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-teal-200/60">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-teal-800 mb-0.5">
                            {t.secretKeyLabel}
                          </div>
                          <code
                            dir="ltr"
                            className="block text-xs font-mono text-teal-950 break-all"
                          >
                            {isSecretShown && secretPlain
                              ? secretPlain
                              : '••••••••••••••••••••••••••••'}
                          </code>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleSecretEye(k.id)}
                            disabled={isLoadingSecret}
                            aria-label={
                              isSecretShown
                                ? lang === 'ar'
                                  ? 'إخفاء السيكريت كي'
                                  : 'Hide secret key'
                                : lang === 'ar'
                                  ? 'إظهار السيكريت كي'
                                  : 'Show secret key'
                            }
                            className="p-1.5 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 rounded transition-colors disabled:opacity-50"
                          >
                            {isSecretShown ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyHiddenSecret(k, 'secret')}
                            disabled={isLoadingSecret}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium border rounded transition-colors shrink-0 ${
                              secretCopied
                                ? 'bg-teal-50 border-teal-300 text-teal-800'
                                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
                            }`}
                          >
                            {secretCopied ? (
                              <Check className="w-3 h-3 text-teal-700" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>
                              {isLoadingSecret
                                ? '...'
                                : secretCopied
                                  ? lang === 'ar'
                                    ? 'تم'
                                    : 'Done'
                                  : t.copy}
                            </span>
                          </button>
                        </div>
                      </div>

                      {requiresRotation && (
                        <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900">
                          <span>
                            {lang === 'ar'
                              ? 'مفتاح قديم قبل تفعيل التشفير الدائم — اضغط تدوير ليصبح قابل للعرض والنسخ دائماً.'
                              : 'Legacy key without sealed vault copy. Rotate once to enable instant copy/reveal.'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRotate(k.id)}
                            className="px-2.5 py-1 font-medium text-white bg-slate-900 hover:bg-slate-800 rounded whitespace-nowrap"
                          >
                            {t.rotateSecret}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 4. Compact Footer Stats & Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyHiddenSecret(k, 'bearer')}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap ${
                            bearerCopied
                              ? 'bg-teal-50 border-teal-300 text-teal-800'
                              : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {bearerCopied ? (
                            <Check className="w-3 h-3 text-teal-700" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>
                            {bearerCopied ? t.copied : t.copyBearerPair}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handlePlaygroundClick(k)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Play className="w-3 h-3" />
                          <span>{lang === 'ar' ? 'تجربة' : 'Test'}</span>
                        </button>

                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-mono tabular-nums">
                          <InfinityIcon className="w-3 h-3 text-teal-700" />
                          <span>
                            {k.requestCount} / {k.failoverCount}
                          </span>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRotate(k.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>{t.rotateSecret}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onToggleKeyStatus(k)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {k.status === 'active' ? t.revokeKey : t.activateKey}
                        </button>

                        {confirmDeleteId === k.id ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteKey(k.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
                          >
                            {t.confirmDelete}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(k.id)}
                            aria-label={t.deleteKey}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Centered Create Key Modal (with Quick Descriptive Word Presets!) */}
      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={onCloseCreateModal}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                {t.createKeyTitle}
              </h2>
              <button
                type="button"
                onClick={onCloseCreateModal}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.keyNameLabel}
              </label>
              <input
                type="text"
                required
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.keyNamePlaceholder}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">
                {lang === 'ar'
                  ? 'الكلمة التعريفية بجانب الاسم (تقدر تغيرها في أي وقت)'
                  : 'Descriptive Tag (shown next to app name)'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {presetLabels.map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => setDescription(lbl)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      description === lbl
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <input
                type="text"
                maxLength={200}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  lang === 'ar'
                    ? 'أو اكتب كلمة تعريفية بنفسك: توليد صور، شات...'
                    : 'Or enter custom label: Image Gen, AI Chat...'
                }
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={requireHmac}
                onChange={(e) => setRequireHmac(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <span>{t.requireHmacLabel}</span>
            </label>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onCloseCreateModal}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                {submitting ? '...' : t.createKeyBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Centered Just-Created / Rotated Secret Modal */}
      {modalSecret && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setModalSecret(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-5 sm:p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {lang === 'ar'
                    ? 'بيانات المفاتيح الجاهزة للنسخ'
                    : 'Access Key Credentials'}
                </h2>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {modalSecret.name}
                  </span>
                  <CopyButton
                    text={modalSecret.name}
                    compact
                    title={t.copy}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalSecret(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-medium text-slate-600">
                    {t.publicKeyLabel}
                  </span>
                  <CopyButton
                    text={modalSecret.publicKey}
                    label={t.copy}
                    copiedLabel={t.copied}
                    className="bg-white"
                  />
                </div>
                <code
                  dir="ltr"
                  className="block text-xs font-mono text-slate-900 break-all select-all"
                >
                  {modalSecret.publicKey}
                </code>
              </div>

              {modalSecret.secretKey && (
                <>
                  <div className="bg-slate-50 border border-teal-200 rounded-lg p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-medium text-teal-800">
                        {t.secretKeyLabel}
                      </span>
                      <CopyButton
                        text={modalSecret.secretKey}
                        label={t.copy}
                        copiedLabel={t.copied}
                        className="bg-white"
                      />
                    </div>
                    <code
                      dir="ltr"
                      className="block text-xs font-mono text-teal-900 font-medium break-all select-all"
                    >
                      {modalSecret.secretKey}
                    </code>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-medium text-slate-600">
                        {lang === 'ar'
                          ? 'مفتاح الشات الموحد (Bearer pk:sk)'
                          : 'Unified Bearer Key (pk:sk)'}
                      </span>
                      <CopyButton
                        text={`${modalSecret.publicKey}:${modalSecret.secretKey}`}
                        label={t.copy}
                        copiedLabel={t.copied}
                        className="bg-white"
                      />
                    </div>
                    <code
                      dir="ltr"
                      className="block text-xs font-mono text-slate-800 break-all select-all"
                    >
                      {modalSecret.publicKey}:{modalSecret.secretKey}
                    </code>
                  </div>

                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between bg-slate-900 px-4 py-2 border-b border-slate-800">
                      <span className="text-xs font-mono text-slate-300">
                        .env
                      </span>
                      <CopyButton
                        text={envBlockText}
                        label={lang === 'ar' ? 'نسخ الكود بالكامل' : 'Copy Code'}
                        copiedLabel={t.copied}
                        className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                      />
                    </div>
                    <pre
                      dir="ltr"
                      className="p-3.5 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto"
                    >
                      {envBlockText}
                    </pre>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
              {modalSecret.secretKey && (
                <button
                  type="button"
                  onClick={() => {
                    const sk = modalSecret.secretKey!;
                    const pk = modalSecret.publicKey;
                    setModalSecret(null);
                    onLoadInPlayground(pk, sk);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{t.useInPlayground}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setModalSecret(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                {t.dismissReveal}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
