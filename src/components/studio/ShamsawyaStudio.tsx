import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crop,
  Download,
  Eraser,
  FolderKanban,
  Globe,
  Hand,
  LayoutGrid,
  Loader2,
  MousePointer2,
  Paintbrush,
  RotateCcw,
  RotateCw,
  Ruler,
  Scissors,
  Send,
  Share2,
  Sparkles,
  SunMedium,
  Undo2,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import {
  saveCloudStudioProject,
  deleteCloudStudioProject,
} from '../../lib/cloudVault';
import { auth } from '../../lib/firebase';
import {
  applyBrushStrokeLineToMask,
  applyMagicWandToMask,
  cloneCanvas,
  computeProductDrawRect,
  createFittedImageCanvas,
  createFullOpaqueMask,
  exportCompositeInFormat,
  extractMaskFromCutoutResult,
  getTargetCanvasDimensions,
  loadImageElement,
  performSmartLocalCutout,
  renderStudioComposite,
} from '../../lib/studioEngine';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_LIGHTING,
  DEFAULT_SHADOW,
  SHAMSAWYA_LOGO_URL,
  STUDIO_SAMPLE_PRODUCTS,
} from '../../lib/studioPresets';
import {
  compressThumbnailDataUrl,
  deleteLocalStudioProject,
  listLocalStudioProjects,
  saveLocalStudioProject,
} from '../../lib/studioStorage';
import type {
  BackgroundConfig,
  CascadeTraceLog,
  DimensionOverlay,
  ImageExportFormat,
  LightingConfig,
  RetouchBrushMode,
  ShadowConfig,
  StoryboardSlide,
  StudioAssetItem,
  StudioProjectRecord,
  StudioToolTab,
  VideoAspectRatio,
  VideoGenerationMode,
} from '../../types/studio';
import type { FailoverAttempt, Language } from '../../types/taygos';
import { StudioCanvas } from './StudioCanvas';
import { StudioCropPanel } from './StudioCropPanel';
import { StudioDimensionsPanel } from './StudioDimensionsPanel';
import { StudioExportModal } from './StudioExportModal';
import { StudioLightingPanel } from './StudioLightingPanel';
import { StudioProjectsPanel } from './StudioProjectsPanel';
import { StudioScenesPanel } from './StudioScenesPanel';
import { StudioStoryboardPanel } from './StudioStoryboardPanel';
import { StudioVideoPanel } from './StudioVideoPanel';

interface ShamsawyaStudioProps {
  lang: Language;
  onToggleLang: () => void;
  getBearerToken: () => Promise<string | null>;
  isStandalone?: boolean;
  isEmbed?: boolean;
  onOpenGatewaySettings?: () => void;
}

function extractImageDataUrlFromGateway(body: Record<string, unknown>): string {
  const dataObj = body.data as Record<string, unknown> | undefined;
  const arr = Array.isArray(dataObj?.data) ? dataObj?.data : [];
  const first = arr[0] as Record<string, unknown> | undefined;
  if (typeof first?.url === 'string' && first.url) return first.url;
  if (typeof first?.b64_json === 'string' && first.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }
  if (typeof dataObj?.dataUrl === 'string') return dataObj.dataUrl;
  if (typeof dataObj?.url === 'string') return dataObj.url;
  return '';
}

function extractTextFromGateway(body: Record<string, unknown>): string {
  const dataObj = body.data as Record<string, unknown> | undefined;
  if (typeof dataObj?.output === 'string' && dataObj.output.trim()) {
    return dataObj.output.trim();
  }
  const choices = Array.isArray(dataObj?.choices) ? dataObj?.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const msg = firstChoice?.message as Record<string, unknown> | undefined;
  if (typeof msg?.content === 'string' && msg.content.trim()) {
    return msg.content.trim();
  }
  const contentArr = Array.isArray(dataObj?.content) ? dataObj?.content : [];
  const firstBlock = contentArr[0] as Record<string, unknown> | undefined;
  if (typeof firstBlock?.text === 'string' && firstBlock.text.trim()) {
    return firstBlock.text.trim();
  }
  return '';
}

export const ShamsawyaStudio: React.FC<ShamsawyaStudioProps> = ({
  lang,
  onToggleLang,
  getBearerToken,
  isStandalone = false,
  isEmbed = false,
  onOpenGatewaySettings,
}) => {
  const [activeTool, setActiveTool] = useState<StudioToolTab>('cutout');
  const [projectId, setProjectId] = useState<string>(() => `proj_${Date.now()}`);
  const [projectTitle, setProjectTitle] = useState<string>(
    lang === 'ar'
      ? STUDIO_SAMPLE_PRODUCTS[0].titleAr
      : STUDIO_SAMPLE_PRODUCTS[0].titleEn
  );
  const [craftType, setCraftType] =
    useState<StudioProjectRecord['craftType']>('macrame');
  const [activePrompt, setActivePrompt] = useState<string>(
    STUDIO_SAMPLE_PRODUCTS[0].defaultPrompt
  );

  const [originalCanvas, setOriginalCanvas] = useState<HTMLCanvasElement | null>(
    null
  );
  const [rawMaskCanvas, setRawMaskCanvas] = useState<HTMLCanvasElement | null>(
    null
  );
  const [compositeCanvas, setCompositeCanvas] =
    useState<HTMLCanvasElement | null>(null);
  const [compositePreviewUrl, setCompositePreviewUrl] = useState<string>('');

  const [maskUndoStack, setMaskUndoStack] = useState<HTMLCanvasElement[]>([]);
  const [maskRedoStack, setMaskRedoStack] = useState<HTMLCanvasElement[]>([]);
  const rawMaskRef = useRef<HTMLCanvasElement | null>(null);
  const studioTokenRef = useRef<string | null>(null);
  const rafPreviewBusyRef = useRef(false);

  const [brushMode, setBrushMode] = useState<RetouchBrushMode>('none');
  const [brushSize, setBrushSize] = useState<number>(34);
  const [brushHardness, setBrushHardness] = useState<number>(0.8);
  const [wandTolerance, setWandTolerance] = useState<number>(32);
  const [wandContiguous, setWandContiguous] = useState<boolean>(true);
  const [wandMode, setWandMode] = useState<'erase' | 'restore'>('erase');

  const [edgeExpand, setEdgeExpand] = useState<number>(0);
  const [edgeFeather, setEdgeFeather] = useState<number>(1);
  const [localCutoutTolerance, setLocalCutoutTolerance] = useState<number>(40);

  const [lighting, setLighting] = useState<LightingConfig>(DEFAULT_LIGHTING);
  const [shadow, setShadow] = useState<ShadowConfig>(DEFAULT_SHADOW);
  const [background, setBackground] =
    useState<BackgroundConfig>(DEFAULT_BACKGROUND);

  const [dimensions, setDimensions] = useState<DimensionOverlay[]>([]);
  const [selectedDimId, setSelectedDimId] = useState<string | null>(null);
  const [storyboardSlides, setStoryboardSlides] = useState<StoryboardSlide[]>([]);
  const [savedAssets, setSavedAssets] = useState<StudioAssetItem[]>([]);
  const [savedProjects, setSavedProjects] = useState<StudioProjectRecord[]>([]);
  const [cascadeLogs, setCascadeLogs] = useState<CascadeTraceLog[]>([]);

  const [showBeforeAfter, setShowBeforeAfter] = useState(false);
  const [isStageExpanded, setIsStageExpanded] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [magicPrompt, setMagicPrompt] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);

  useEffect(() => {
    rawMaskRef.current = rawMaskCanvas;
  }, [rawMaskCanvas]);

  const getStudioAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const bearer = await getBearerToken();
    if (bearer) {
      return { Authorization: `Bearer ${bearer}` };
    }
    if (studioTokenRef.current) {
      return { 'X-Studio-Token': studioTokenRef.current };
    }
    try {
      const res = await fetch('/api/studio/session');
      if (res.ok) {
        const data = (await res.json()) as { studioToken?: string };
        if (data.studioToken) {
          studioTokenRef.current = data.studioToken;
          return { 'X-Studio-Token': data.studioToken };
        }
      }
    } catch {
      // Fallback gracefully
    }
    return {};
  }, [getBearerToken]);

  const loadSourceImageIntoStudio = useCallback(
    async (
      src: string,
      nextTitle?: string,
      nextCraft?: StudioProjectRecord['craftType'],
      nextPrompt?: string
    ) => {
      try {
        const img = await loadImageElement(src);
        const fitted = createFittedImageCanvas(img, 1280);
        const fullMask = createFullOpaqueMask(fitted.width, fitted.height);
        setOriginalCanvas(fitted);
        setRawMaskCanvas(fullMask);
        rawMaskRef.current = fullMask;
        setMaskUndoStack([]);
        setMaskRedoStack([]);
        setBackground((b) => ({
          ...b,
          aspectPreset: 'original',
          productScale: 1,
          productOffsetX: 0,
          productOffsetY: 0,
        }));
        if (nextTitle) setProjectTitle(nextTitle);
        if (nextCraft) setCraftType(nextCraft);
        if (nextPrompt) setActivePrompt(nextPrompt);
      } catch {
        setNotice({
          tone: 'warn',
          text:
            lang === 'ar'
              ? 'تعذر تحميل الصورة المختارة.'
              : 'Failed to load selected image.',
        });
      }
    },
    [lang]
  );

  useEffect(() => {
    const first = STUDIO_SAMPLE_PRODUCTS[0];
    void loadSourceImageIntoStudio(
      first.imageUrl,
      lang === 'ar' ? first.titleAr : first.titleEn,
      first.craftType,
      first.defaultPrompt
    );
    void listLocalStudioProjects().then(setSavedProjects);
    void getStudioAuthHeaders();
  }, [loadSourceImageIntoStudio, getStudioAuthHeaders, lang]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const payload = ev.data as Record<string, unknown> | undefined;
      if (
        payload?.type === 'SHAMSAWYA_LOAD_IMAGE' &&
        typeof payload.imageUrl === 'string'
      ) {
        void loadSourceImageIntoStudio(
          payload.imageUrl,
          typeof payload.title === 'string'
            ? payload.title
            : lang === 'ar'
              ? 'منتج وارد من المنظومة'
              : 'Imported Product'
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [loadSourceImageIntoStudio, lang]);

  const rebuildComposite = useCallback(async () => {
    if (!originalCanvas || !rawMaskCanvas) return;
    const next = await renderStudioComposite({
      originalCanvas,
      rawMaskCanvas,
      edgeExpand,
      edgeFeather,
      lighting,
      shadow,
      background,
      dimensions,
      bakeDimensions: false,
    });
    setCompositeCanvas(next);
    setCompositePreviewUrl(next.toDataURL('image/png'));
  }, [
    originalCanvas,
    rawMaskCanvas,
    edgeExpand,
    edgeFeather,
    lighting,
    shadow,
    background,
    dimensions,
  ]);

  useEffect(() => {
    void rebuildComposite();
  }, [rebuildComposite]);

  const pushMaskUndo = useCallback((snapshotCanvas: HTMLCanvasElement) => {
    setMaskUndoStack((prev) => [...prev.slice(-18), cloneCanvas(snapshotCanvas)]);
    setMaskRedoStack([]);
  }, []);

  const handleUndoMask = () => {
    if (maskUndoStack.length === 0 || !rawMaskCanvas) return;
    const prev = maskUndoStack[maskUndoStack.length - 1];
    setMaskRedoStack((r) => [...r, cloneCanvas(rawMaskCanvas)]);
    setMaskUndoStack((u) => u.slice(0, -1));
    setRawMaskCanvas(prev);
    rawMaskRef.current = prev;
  };

  const handleRedoMask = () => {
    if (maskRedoStack.length === 0 || !rawMaskCanvas) return;
    const next = maskRedoStack[maskRedoStack.length - 1];
    setMaskUndoStack((u) => [...u, cloneCanvas(rawMaskCanvas)]);
    setMaskRedoStack((r) => r.slice(0, -1));
    setRawMaskCanvas(next);
    rawMaskRef.current = next;
  };

  const handleBrushStrokeSegment = useCallback(
    (
      x0Norm: number,
      y0Norm: number,
      x1Norm: number,
      y1Norm: number,
      isStrokeStart: boolean
    ) => {
      const mask = rawMaskRef.current;
      if (!mask || !originalCanvas) return;
      if (brushMode !== 'erase' && brushMode !== 'restore') return;

      if (isStrokeStart) {
        pushMaskUndo(mask);
      }

      applyBrushStrokeLineToMask(
        mask,
        x0Norm * mask.width,
        y0Norm * mask.height,
        x1Norm * mask.width,
        y1Norm * mask.height,
        brushSize,
        brushMode === 'erase' ? 'erase' : 'restore',
        brushHardness
      );

      if (!rafPreviewBusyRef.current) {
        rafPreviewBusyRef.current = true;
        requestAnimationFrame(() => {
          void renderStudioComposite({
            originalCanvas,
            rawMaskCanvas: mask,
            edgeExpand,
            edgeFeather,
            lighting,
            shadow,
            background,
          })
            .then((next) => {
              setCompositeCanvas(next);
            })
            .finally(() => {
              rafPreviewBusyRef.current = false;
            });
        });
      }
    },
    [
      originalCanvas,
      brushMode,
      brushSize,
      brushHardness,
      pushMaskUndo,
      edgeExpand,
      edgeFeather,
      lighting,
      shadow,
      background,
    ]
  );

  const handleBrushEnd = useCallback(() => {
    if (rawMaskRef.current) {
      setRawMaskCanvas(cloneCanvas(rawMaskRef.current));
    }
  }, []);

  const handleMagicWandClick = useCallback(
    (maskNormX: number, maskNormY: number) => {
      if (!originalCanvas || !rawMaskRef.current) return;
      pushMaskUndo(rawMaskRef.current);
      const nextMask = cloneCanvas(rawMaskRef.current);
      const { matchedPixels } = applyMagicWandToMask({
        originalCanvas,
        maskCanvas: nextMask,
        normX: maskNormX,
        normY: maskNormY,
        tolerance: wandTolerance,
        contiguous: wandContiguous,
        mode: wandMode,
      });
      rawMaskRef.current = nextMask;
      setRawMaskCanvas(nextMask);
      setNotice({
        tone: 'ok',
        text:
          lang === 'ar'
            ? `تم تحديد ${matchedPixels.toLocaleString()} بكسل بالعصا السحرية.`
            : `Magic Wand ${wandMode === 'erase' ? 'erased' : 'restored'} ${matchedPixels.toLocaleString()} px.`,
      });
    },
    [originalCanvas, pushMaskUndo, wandTolerance, wandContiguous, wandMode, lang]
  );

  const handleApplyPermanentCrop = async () => {
    if (!originalCanvas || !rawMaskCanvas) return;
    const { width: targetW, height: targetH } = getTargetCanvasDimensions(
      originalCanvas.width,
      originalCanvas.height,
      background.aspectPreset || 'original'
    );
    const { drawX, drawY, drawW, drawH } = computeProductDrawRect(
      targetW,
      targetH,
      originalCanvas.width,
      originalCanvas.height,
      background
    );

    const newOrig = document.createElement('canvas');
    newOrig.width = targetW;
    newOrig.height = targetH;
    const oCtx = newOrig.getContext('2d');
    if (oCtx) {
      oCtx.drawImage(originalCanvas, drawX, drawY, drawW, drawH);
    }

    const newMask = document.createElement('canvas');
    newMask.width = targetW;
    newMask.height = targetH;
    const mCtx = newMask.getContext('2d');
    if (mCtx) {
      mCtx.drawImage(rawMaskCanvas, drawX, drawY, drawW, drawH);
    }

    setMaskUndoStack([]);
    setMaskRedoStack([]);
    setOriginalCanvas(newOrig);
    setRawMaskCanvas(newMask);
    rawMaskRef.current = newMask;
    setBackground((b) => ({
      ...b,
      aspectPreset: 'original',
      fitMode: 'contain',
      productScale: 1,
      productOffsetX: 0,
      productOffsetY: 0,
    }));
    setNotice({
      tone: 'ok',
      text:
        lang === 'ar'
          ? `تم تثبيت القص الجديد (${targetW}×${targetH}px) بنجاح.`
          : `Cropped & committed (${targetW}×${targetH}px).`,
    });
  };

  const appendCascadeTrace = useCallback(
    (taskLabel: string, body: Record<string, unknown>) => {
      const provider = body.provider as Record<string, unknown> | undefined;
      const trace: CascadeTraceLog = {
        id: `trace_${Date.now()}`,
        taskLabel,
        ok: Boolean(body.ok),
        providerName:
          typeof provider?.name === 'string'
            ? provider.name
            : lang === 'ar'
              ? 'النظام التلقائي'
              : 'Auto Cascade',
        modelName: typeof provider?.model === 'string' ? provider.model : '-',
        latencyMs: Number(body.totalLatencyMs) || 0,
        failoverTriggered: Boolean(body.failoverTriggered),
        attempts: Array.isArray(body.attempts)
          ? (body.attempts as FailoverAttempt[])
          : [],
        message:
          typeof body.error === 'string'
            ? body.error
            : lang === 'ar'
              ? 'تم التنفيذ بنجاح'
              : 'Completed',
        timestamp: new Date().toISOString(),
      };
      setCascadeLogs((prev) => [trace, ...prev].slice(0, 30));
    },
    [lang]
  );

  const handleUploadProductFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void loadSourceImageIntoStudio(
          reader.result,
          file.name.replace(/\.[^.]+$/, '') ||
            (lang === 'ar' ? 'منتج جديد' : 'New Product')
        );
        setNotice({
          tone: 'ok',
          text:
            lang === 'ar'
              ? 'تم تحميل الصورة في الاستوديو بنجاح.'
              : 'Image loaded cleanly into studio.',
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLocalSmartCutout = () => {
    if (!originalCanvas || !rawMaskCanvas) return;
    pushMaskUndo(rawMaskCanvas);
    const mask = performSmartLocalCutout(originalCanvas, localCutoutTolerance);
    setRawMaskCanvas(mask);
    rawMaskRef.current = mask;
    setNotice({
      tone: 'ok',
      text:
        lang === 'ar'
          ? 'تم العزل الفوري. استخدم العصا السحرية لتفريغ الفتحات الداخلية إن وجدت.'
          : 'Instant cutout applied. Use Magic Wand to clear any inner openings.',
    });
  };

  const handleResetMaskFull = () => {
    if (!originalCanvas || !rawMaskCanvas) return;
    pushMaskUndo(rawMaskCanvas);
    const full = createFullOpaqueMask(originalCanvas.width, originalCanvas.height);
    setRawMaskCanvas(full);
    rawMaskRef.current = full;
  };

  const handleAiCutout = async () => {
    if (!originalCanvas || !rawMaskCanvas) return;
    setBusyAction('ai_cutout');
    setNotice(null);
    try {
      const headers = await getStudioAuthHeaders();
      const res = await fetch('/api/studio/remove-bg', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ image: originalCanvas.toDataURL('image/jpeg', 0.92) }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      appendCascadeTrace(
        lang === 'ar' ? 'عزل الخلفية بالـ AI' : 'AI Background Removal',
        body
      );
      const outImg = extractImageDataUrlFromGateway(body);
      if (res.ok && outImg) {
        pushMaskUndo(rawMaskCanvas);
        const extracted = await extractMaskFromCutoutResult(
          outImg,
          originalCanvas.width,
          originalCanvas.height
        );
        setRawMaskCanvas(extracted);
        rawMaskRef.current = extracted;
        setNotice({
          tone: 'ok',
          text:
            lang === 'ar'
              ? 'تم العزل بالذكاء الاصطناعي بنجاح! يمكنك التنقيح بالفرشاة أو العصا السحرية.'
              : 'AI cutout completed! Refine further with Eraser or Magic Wand.',
        });
      } else {
        handleLocalSmartCutout();
        setNotice({
          tone: 'warn',
          text:
            lang === 'ar'
              ? 'مزودو العزل الخارجي غير متاحين الآن — تم تطبيق العزل المحلي الفوري.'
              : 'External RMBG unavailable — applied local edge cutout instead.',
        });
      }
    } catch {
      handleLocalSmartCutout();
    } finally {
      setBusyAction(null);
    }
  };

  const handleEnhancePromptWithAi = async () => {
    setBusyAction('enhance_prompt');
    setNotice(null);
    try {
      const headers = await getStudioAuthHeaders();
      const res = await fetch('/api/studio/copywriter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          prompt: `You are an art director for Al-Shamsawya Studio (الشمس كرافت) handmade Egyptian macrame, cotton cord, burlap, and boho home decor. Rewrite the following scene description into a concise, ultra-realistic studio backdrop photography prompt in English (max 65 words) focused on natural daylight, authentic Egyptian surfaces, and keeping center space clear for the product:\n\n"${activePrompt}"`,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      appendCascadeTrace(
        lang === 'ar' ? 'تحسين البرومبت الإعلاني' : 'AI Prompt Enhancement',
        body
      );
      const text = extractTextFromGateway(body);
      if (res.ok && text) {
        setActivePrompt(text);
        setNotice({
          tone: 'ok',
          text:
            lang === 'ar'
              ? 'تم تحسين وصف المشهد عبر سلسلة الـ AI.'
              : 'Scene prompt enhanced via AI cascade.',
        });
      } else {
        setNotice({
          tone: 'warn',
          text:
            lang === 'ar'
              ? 'لم يرد مزود نصي متاح حالياً.'
              : 'No active text AI provider responded.',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunAiMagic = async (
    desiredAction: 'auto' | 'cutout' | 'scene_edit' | 'scene_composite' | 'video' = 'auto',
    promptOverride?: string
  ) => {
    if (!originalCanvas || !rawMaskCanvas) return;
    const effectivePrompt = (promptOverride ?? magicPrompt).trim();
    if (!effectivePrompt && desiredAction === 'auto') {
      setNotice({
        tone: 'warn',
        text:
          lang === 'ar'
            ? 'اكتب أمرك في الخانة أولاً (مثال: حطها في صالون بوهو مصري، أو اعزل الخلفية).'
            : 'Type a prompt first (e.g. place in a sunlit boho living room, or isolate product).',
      });
      return;
    }

    setBusyAction(`ai_magic_${desiredAction}`);
    setNotice(null);
    try {
      const headers = await getStudioAuthHeaders();
      const sourceForAi =
        compositeCanvas && background.mode !== 'transparent'
          ? originalCanvas.toDataURL('image/jpeg', 0.9)
          : originalCanvas.toDataURL('image/jpeg', 0.9);

      const res = await fetch('/api/studio/ai-magic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          prompt: effectivePrompt || activePrompt,
          image: sourceForAi,
          desiredAction,
          aspectRatio: '9:16',
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        action?: string;
        editedFullImageUrl?: string;
        cutoutImageUrl?: string;
        sceneImageUrl?: string;
        videoUrl?: string;
        visionPlan?: {
          productTitleAr?: string;
          editPromptEn?: string;
          lightingAdjust?: Partial<LightingConfig>;
          shadowPreset?: Partial<ShadowConfig>;
          replyAr?: string;
        };
        traces?: Array<Record<string, unknown>>;
        error?: string;
      };

      if (Array.isArray(body.traces)) {
        for (const t of body.traces) {
          appendCascadeTrace(
            lang === 'ar' ? `تنفيذ ذكي (${body.action || desiredAction})` : `AI Magic (${body.action || desiredAction})`,
            t
          );
        }
      }

      if (!res.ok || !body.ok) {
        setNotice({
          tone: 'warn',
          text:
            body.error ||
            (lang === 'ar'
              ? 'مزودو الذكاء الاصطناعي مشغولون الآن، حاول مرة أخرى بعد ثوانٍ.'
              : 'AI providers are busy right now; please retry in a moment.'),
        });
        return;
      }

      if (body.visionPlan?.productTitleAr) {
        setProjectTitle(body.visionPlan.productTitleAr);
      }
      if (body.visionPlan?.editPromptEn) {
        setActivePrompt(body.visionPlan.editPromptEn);
      }
      if (body.visionPlan?.lightingAdjust) {
        setLighting((l) => ({ ...l, ...body.visionPlan!.lightingAdjust }));
      }
      if (body.visionPlan?.shadowPreset) {
        setShadow((s) => ({ ...s, ...body.visionPlan!.shadowPreset }));
      }

      if (body.editedFullImageUrl) {
        await loadSourceImageIntoStudio(
          body.editedFullImageUrl,
          body.visionPlan?.productTitleAr || projectTitle
        );
        setBackground((b) => ({ ...b, mode: 'white', sceneImageUrl: '' }));
        setSavedAssets((prev) => [
          {
            id: `asset_${Date.now()}`,
            kind: 'scene',
            title: `${lang === 'ar' ? 'مشهد AI:' : 'AI Scene:'} ${body.visionPlan?.productTitleAr || projectTitle}`,
            dataUrl: body.editedFullImageUrl!,
            mimeType: 'image/png',
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else {
        if (body.cutoutImageUrl) {
          pushMaskUndo(rawMaskCanvas);
          const extracted = await extractMaskFromCutoutResult(
            body.cutoutImageUrl,
            originalCanvas.width,
            originalCanvas.height
          );
          setRawMaskCanvas(extracted);
          rawMaskRef.current = extracted;
        }
        if (body.sceneImageUrl) {
          setBackground((b) => ({
            ...b,
            mode: 'scene_image',
            sceneImageUrl: body.sceneImageUrl!,
          }));
          setSavedAssets((prev) => [
            {
              id: `asset_${Date.now()}`,
              kind: 'scene',
              title: `${lang === 'ar' ? 'خلفية AI:' : 'AI Backdrop:'} ${projectTitle}`,
              dataUrl: body.sceneImageUrl!,
              mimeType: 'image/png',
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        }
      }

      if (body.videoUrl) {
        setSavedAssets((prev) => [
          {
            id: `asset_${Date.now()}`,
            kind: 'video',
            title: `AI Video: ${body.visionPlan?.productTitleAr || projectTitle}`,
            dataUrl: body.videoUrl!,
            mimeType: 'video/mp4',
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setActiveTool('video');
      }

      setNotice({
        tone: 'ok',
        text:
          body.visionPlan?.replyAr ||
          (lang === 'ar'
            ? 'تم تنفيذ طلبك بالذكاء الاصطناعي بنجاح!'
            : 'AI Magic request completed successfully!'),
      });
    } catch {
      setNotice({
        tone: 'warn',
        text:
          lang === 'ar'
            ? 'تعذر الاتصال بخدمة الذكاء الاصطناعي حالياً.'
            : 'Failed to reach AI Magic service.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateAiScene = async (compositeProductOnTop: boolean) => {
    if (!originalCanvas) return;
    setBusyAction('generate_scene');
    setNotice(null);
    try {
      const headers = await getStudioAuthHeaders();
      const res = await fetch('/api/studio/generate-scene', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          mode: compositeProductOnTop ? 'generate' : 'bg_edit',
          prompt: activePrompt,
          image: compositeProductOnTop
            ? undefined
            : originalCanvas.toDataURL('image/jpeg', 0.88),
          width: 1024,
          height: 1024,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      appendCascadeTrace(
        lang === 'ar' ? 'توليد خلفية / مشهد إعلاني' : 'AI Scene Generation',
        body
      );
      const sceneUrl = extractImageDataUrlFromGateway(body);
      if (res.ok && sceneUrl) {
        if (!compositeProductOnTop) {
          await loadSourceImageIntoStudio(sceneUrl, projectTitle);
          setBackground((b) => ({ ...b, mode: 'white', sceneImageUrl: '' }));
        } else {
          setBackground((b) => ({
            ...b,
            mode: 'scene_image',
            sceneImageUrl: sceneUrl,
          }));
        }
        setSavedAssets((prev) => [
          {
            id: `asset_${Date.now()}`,
            kind: 'scene',
            title: `${lang === 'ar' ? 'مشهد:' : 'Scene:'} ${projectTitle}`,
            dataUrl: sceneUrl,
            mimeType: 'image/png',
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setNotice({
          tone: 'ok',
          text: !compositeProductOnTop
            ? lang === 'ar'
              ? 'تم دمج المنتج بالذكاء الاصطناعي داخل المشهد الجديد بنجاح.'
              : 'Product merged directly into the new AI scene.'
            : lang === 'ar'
              ? 'تم توليد المشهد وتثبيت منتجك المعزول فوقه.'
              : 'Studio scene generated and placed behind cutout.',
        });
      } else {
        setNotice({
          tone: 'warn',
          text:
            lang === 'ar'
              ? 'مزودو توليد الصور مشغولون الآن. جرّب مرة أخرى أو اختر خلفية لونية مؤقتة.'
              : 'Image AI providers are busy right now. Retry or choose a solid studio swatch.',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportFormat = async (opts: {
    format: ImageExportFormat;
    bakeDimensions: boolean;
    transparentBg: boolean;
    targetSizePx?: number;
  }) => {
    if (!originalCanvas || !rawMaskCanvas) return;
    const rendered = await renderStudioComposite({
      originalCanvas,
      rawMaskCanvas,
      edgeExpand,
      edgeFeather,
      lighting,
      shadow,
      background: opts.transparentBg ? { ...background, mode: 'transparent' } : background,
      dimensions,
      bakeDimensions: opts.bakeDimensions,
    });
    const { dataUrl, extension } = await exportCompositeInFormat({
      canvas: rendered,
      format: opts.format,
      targetSizePx: opts.targetSizePx,
    });
    if (!dataUrl) return;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${projectTitle.replace(/\s+/g, '_')}-${Date.now()}.${extension}`;
    a.click();

    const kind: StudioAssetItem['kind'] =
      opts.transparentBg || background.mode === 'transparent' ? 'cutout' : 'image';
    setSavedAssets((prev) => [
      {
        id: `asset_${Date.now()}`,
        kind,
        title: `${projectTitle} (${extension.toUpperCase()})`,
        dataUrl,
        mimeType:
          extension === 'png'
            ? 'image/png'
            : extension === 'jpg'
              ? 'image/jpeg'
              : extension === 'webp'
                ? 'image/webp'
                : extension === 'svg'
                  ? 'image/svg+xml'
                  : 'image/x-icon',
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setNotice({
      tone: 'ok',
      text:
        lang === 'ar'
          ? `تم تصدير الصورة بصيغة ${extension.toUpperCase()} وحفظها في الأصول.`
          : `Exported ${extension.toUpperCase()} image successfully.`,
    });
  };

  const handleCaptureSlide = async () => {
    if (!originalCanvas || !rawMaskCanvas) return;
    const snap = await renderStudioComposite({
      originalCanvas,
      rawMaskCanvas,
      edgeExpand,
      edgeFeather,
      lighting,
      shadow,
      background,
      dimensions,
      bakeDimensions: true,
    });
    setStoryboardSlides((prev) => [
      ...prev,
      {
        id: `slide_${Date.now()}`,
        title: projectTitle || `${lang === 'ar' ? 'لقطة' : 'Shot'} ${prev.length + 1}`,
        caption:
          lang === 'ar'
            ? 'صناعة يدوية مصرية من الشمس كرافت'
            : 'Authentic handmade craft by Al-Shams Craft',
        imageUrl: snap.toDataURL('image/png'),
      },
    ]);
  };

  const handleAutoGenerateCaptions = async () => {
    if (storyboardSlides.length === 0) return;
    setBusyAction('storyboard_captions');
    try {
      const headers = await getStudioAuthHeaders();
      const res = await fetch('/api/studio/copywriter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          prompt:
            lang === 'ar'
              ? `اكتب ${storyboardSlides.length} جمل تسويقية قصيرة بالعربية المصرية الراقية (كل جملة لا تزيد عن 7 كلمات) لمنتج "${projectTitle}" من متجر الشمس كرافت للمكرمية والخيش. أرجع كل جملة في سطر مستقل بدون أرقام.`
              : `Write ${storyboardSlides.length} short boutique marketing captions (max 8 words each, one per line, no numbering) for "${projectTitle}" handmade macrame/burlap craft.`,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      appendCascadeTrace(
        lang === 'ar' ? 'نصوص الستوري بورد' : 'AI Storyboard Copy',
        body
      );
      const raw = extractTextFromGateway(body);
      if (res.ok && raw) {
        const lines = raw
          .split('\n')
          .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
          .filter(Boolean);
        setStoryboardSlides((prev) =>
          prev.map((sl, i) => ({
            ...sl,
            caption: lines[i] || sl.caption,
          }))
        );
        setNotice({
          tone: 'ok',
          text:
            lang === 'ar'
              ? 'تم توليد النصوص التسويقية للشرائح بنجاح.'
              : 'Marketing captions generated.',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateAiVideo = async (params: {
    mode: VideoGenerationMode;
    prompt: string;
    startImage?: string;
    endImage?: string;
    aspectRatio: VideoAspectRatio;
    durationSec: number;
  }): Promise<string | null> => {
    setBusyAction('generate_video');
    setNotice(null);
    try {
      const headers = await getStudioAuthHeaders();
      const res = await fetch('/api/studio/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          mode: params.mode,
          prompt: params.prompt,
          startImage: params.startImage,
          endImage: params.endImage,
          aspectRatio: params.aspectRatio,
          duration: String(params.durationSec),
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      appendCascadeTrace(
        lang === 'ar' ? `توليد فيديو (${params.mode})` : `AI Video (${params.mode})`,
        body
      );
      const url = extractImageDataUrlFromGateway(body);
      if (res.ok && url) {
        setSavedAssets((prev) => [
          {
            id: `asset_${Date.now()}`,
            kind: 'video',
            title: `AI Video: ${projectTitle}`,
            dataUrl: url,
            mimeType: 'video/mp4',
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setNotice({
          tone: 'ok',
          text:
            lang === 'ar'
              ? 'تم توليد الفيديو وحفظه في المشروع بنجاح.'
              : 'AI video generated and saved to assets.',
        });
        return url;
      }
      setNotice({
        tone: 'warn',
        text:
          lang === 'ar'
            ? 'مزودو فيديو الذكاء الاصطناعي الخارجيين غير متاحين حالياً — استخدم زر التصوير الفوري (MP4/WebM) بالأسفل.'
            : 'External AI Video providers unavailable — use Instant Studio Render (MP4/WebM) below.',
      });
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveProject = async () => {
    if (!originalCanvas || !rawMaskCanvas || !compositeCanvas) return;
    setSavingProject(true);
    try {
      const thumb = compressThumbnailDataUrl(compositeCanvas, 420);
      const record: StudioProjectRecord = {
        id: projectId,
        title:
          projectTitle.trim() ||
          (lang === 'ar' ? 'مشروع بدون عنوان' : 'Untitled Project'),
        craftType,
        thumbnailDataUrl: thumb,
        originalDataUrl: originalCanvas.toDataURL('image/jpeg', 0.88),
        maskDataUrl: rawMaskCanvas.toDataURL('image/png'),
        activePrompt,
        lighting,
        shadow,
        background,
        edgeExpand,
        edgeFeather,
        dimensions,
        storyboardSlides,
        assets: savedAssets,
        updatedAt: new Date().toISOString(),
      };
      await saveLocalStudioProject(record);
      if (auth.currentUser) {
        await saveCloudStudioProject(auth.currentUser.uid, {
          id: record.id,
          title: record.title,
          craftType: record.craftType,
          thumbnailDataUrl: record.thumbnailDataUrl,
          activePrompt: record.activePrompt,
          assetCount: record.assets.length,
          dimensionCount: record.dimensions.length,
        });
      }
      setSavedProjects(await listLocalStudioProjects());
      setNotice({
        tone: 'ok',
        text: auth.currentUser
          ? lang === 'ar'
            ? 'تم حفظ المشروع محلياً ومزامنته سحابياً.'
            : 'Project saved locally & synced to cloud.'
          : lang === 'ar'
            ? 'تم حفظ المشروع داخل الاستوديو بنجاح.'
            : 'Project saved inside Studio storage.',
      });
    } finally {
      setSavingProject(false);
    }
  };

  const handleLoadProject = async (proj: StudioProjectRecord) => {
    setProjectId(proj.id);
    setProjectTitle(proj.title);
    setCraftType(proj.craftType);
    setActivePrompt(proj.activePrompt);
    setLighting({ ...DEFAULT_LIGHTING, ...proj.lighting });
    setShadow({ ...DEFAULT_SHADOW, ...proj.shadow });
    setBackground({ ...DEFAULT_BACKGROUND, ...proj.background });
    setEdgeExpand(proj.edgeExpand);
    setEdgeFeather(proj.edgeFeather);
    setDimensions(proj.dimensions || []);
    setStoryboardSlides(proj.storyboardSlides || []);
    setSavedAssets(proj.assets || []);

    const origImg = await loadImageElement(proj.originalDataUrl);
    const origC = createFittedImageCanvas(origImg, 1280);
    setOriginalCanvas(origC);

    if (proj.maskDataUrl) {
      const mImg = await loadImageElement(proj.maskDataUrl);
      const mC = document.createElement('canvas');
      mC.width = origC.width;
      mC.height = origC.height;
      mC.getContext('2d')?.drawImage(mImg, 0, 0, origC.width, origC.height);
      setRawMaskCanvas(mC);
      rawMaskRef.current = mC;
    } else {
      const full = createFullOpaqueMask(origC.width, origC.height);
      setRawMaskCanvas(full);
      rawMaskRef.current = full;
    }
    setNotice({
      tone: 'ok',
      text:
        lang === 'ar'
          ? `تم فتح مشروع "${proj.title}".`
          : `Opened project "${proj.title}".`,
    });
  };

  const handleDeleteProject = async (id: string) => {
    await deleteLocalStudioProject(id);
    if (auth.currentUser) {
      await deleteCloudStudioProject(auth.currentUser.uid, id);
    }
    setSavedProjects(await listLocalStudioProjects());
  };

  const handleSendExportToParent = () => {
    if (!compositePreviewUrl) return;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'SHAMSAWYA_EXPORT_ASSET',
          projectId,
          title: projectTitle,
          craftType,
          dataUrl: compositePreviewUrl,
          dimensions,
        },
        '*'
      );
      setNotice({
        tone: 'ok',
        text:
          lang === 'ar'
            ? 'تم إرسال الصورة المصدرة مباشرة إلى منظومة الشمساوية.'
            : 'Composite sent directly to parent Al-Shamsawya app.',
      });
    } else {
      setNotice({
        tone: 'ok',
        text:
          lang === 'ar'
            ? 'جاهز للربط! انسخ رابط ?embed=1 من تبويب المشاريع لتضمينه في منظومة الشمساوية.'
            : 'Bridge ready! Copy the /studio?embed=1 URL from the Projects tab to embed in your external app.',
      });
    }
  };

  const toolRails = useMemo(
    () => [
      { id: 'cutout' as StudioToolTab, labelAr: 'العزل', labelEn: 'Cutout', icon: Scissors },
      { id: 'scenes' as StudioToolTab, labelAr: 'المشاهد', labelEn: 'Scenes', icon: Sparkles },
      { id: 'video' as StudioToolTab, labelAr: 'فيديو', labelEn: 'Video', icon: Video },
      { id: 'lighting' as StudioToolTab, labelAr: 'الإضاءة', labelEn: 'Filters', icon: SunMedium },
      { id: 'crop' as StudioToolTab, labelAr: 'القص', labelEn: 'Crop', icon: Crop },
      { id: 'dimensions' as StudioToolTab, labelAr: 'القياسات', labelEn: 'Measure', icon: Ruler },
      { id: 'storyboard' as StudioToolTab, labelAr: 'كتالوج', labelEn: 'Board', icon: LayoutGrid },
      { id: 'projects' as StudioToolTab, labelAr: 'مشاريع', labelEn: 'Projects', icon: FolderKanban },
    ],
    []
  );

  const activeToolMeta = toolRails.find((t) => t.id === activeTool) || toolRails[0];
  const ReturnIcon = lang === 'ar' ? ArrowRight : ArrowLeft;
  const shortShareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/s` : 'https://taygos-studio.app/s';

  const handleCopyShortLink = async () => {
    try {
      await navigator.clipboard.writeText(shortShareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-[#F7F4EE] overflow-hidden">
      {/* Studio Top Bar: Mobile shows ONLY clean transparent PNG logo on start side; Desktop shows brand + sample strip */}
      <header className="bg-[#FCFBF8] border-b border-[#E4DDD0] px-2.5 sm:px-5 h-14 flex items-center justify-between gap-2 sm:gap-3 shrink-0">
        {/* Start: Optional Back button (Admin mode only) + Clean Transparent PNG Logo */}
        <div className="flex items-center gap-2 min-w-0">
          {!isStandalone && !isEmbed && onOpenGatewaySettings && (
            <button
              type="button"
              onClick={onOpenGatewaySettings}
              title={lang === 'ar' ? 'العودة إلى Taygos APIs' : 'Back to Taygos APIs'}
              className="p-2 -ms-1 text-slate-600 hover:text-slate-900 hover:bg-[#EFECE4] rounded-lg transition-colors shrink-0"
            >
              <ReturnIcon className="w-4 h-4" />
            </button>
          )}

          <img
            src={SHAMSAWYA_LOGO_URL}
            alt="استوديو الشمساوية"
            className="w-9 h-9 sm:w-10 sm:h-10 object-contain shrink-0"
          />
          <div className="hidden sm:block min-w-0 leading-tight">
            <h1 className="text-sm sm:text-base font-bold text-[#171614] whitespace-nowrap">
              {lang === 'ar' ? 'استوديو الشمساوية' : 'Al-Shamsawya Studio'}
            </h1>
            <span className="block text-[11px] font-medium text-[#8C6226] whitespace-nowrap">
              {lang === 'ar' ? 'الشمس كرافت للهاند ميد' : 'Al-Shams Craft Studio'}
            </span>
          </div>

          {/* Desktop Quick Sample Switcher */}
          <div className="hidden xl:flex items-center gap-1.5 border-s border-[#E4DDD0] ps-3 ms-1">
            {STUDIO_SAMPLE_PRODUCTS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() =>
                  void loadSourceImageIntoStudio(
                    sample.imageUrl,
                    lang === 'ar' ? sample.titleAr : sample.titleEn,
                    sample.craftType,
                    sample.defaultPrompt
                  )
                }
                className="inline-flex items-center gap-1.5 pe-2.5 ps-1 py-1 bg-white border border-[#E4DDD0] hover:border-[#0F5C54] rounded-lg text-[11px] font-medium text-slate-800 shrink-0 transition-colors"
              >
                <img
                  src={sample.imageUrl}
                  alt={lang === 'ar' ? sample.titleAr : sample.titleEn}
                  className="w-5 h-5 rounded object-cover"
                />
                <span className="whitespace-nowrap">
                  {lang === 'ar' ? sample.titleAr : sample.titleEn}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* End: Clean Non-Wrapping Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="hidden md:flex items-center border border-[#E4DDD0] rounded-lg bg-white overflow-hidden">
            <button
              type="button"
              disabled={maskUndoStack.length === 0}
              onClick={handleUndoMask}
              title={lang === 'ar' ? 'تراجع' : 'Undo'}
              className="p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-30"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={maskRedoStack.length === 0}
              onClick={handleRedoMask}
              title={lang === 'ar' ? 'إعادة' : 'Redo'}
              className="p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-30 border-s border-[#E4DDD0]"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <label
            title={lang === 'ar' ? 'رفع صورة منتج' : 'Upload Product Photo'}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {lang === 'ar' ? 'رفع صورة' : 'Upload'}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleUploadProductFile}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            title={lang === 'ar' ? 'مشاركة رابط الاستوديو' : 'Share Studio Link'}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-[#E4DDD0] hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
          >
            <Share2 className="w-3.5 h-3.5 text-[#0F5C54] shrink-0" />
            <span className="hidden sm:inline">
              {lang === 'ar' ? 'مشاركة' : 'Share'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsExportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-white bg-[#171614] hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#D9A760] shrink-0" />
            <span>{lang === 'ar' ? 'تصدير' : 'Export'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleLang}
            title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-[#E4DDD0] hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span>{lang === 'ar' ? 'EN' : 'ع'}</span>
          </button>

          {isEmbed && (
            <button
              type="button"
              onClick={handleSendExportToParent}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-[#0F5C54] bg-[#EDF5F4] border border-[#B8D7D3] hover:bg-[#E1EFED] rounded-lg whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {lang === 'ar' ? 'إرسال' : 'Send'}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Main Studio Body: Desktop = 3-Pane / Mobile = Generous Warm Stage + Prompt-First Inspector + Thumb Bar */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Desktop Side Tool Dock (Hidden on mobile — mobile uses bottom thumb dock!) */}
        <nav
          aria-label={lang === 'ar' ? 'أدوات الاستوديو' : 'Studio Tools'}
          className="hidden lg:flex w-[88px] bg-[#FCFBF8] border-e border-[#E4DDD0] flex-col gap-1.5 p-2 overflow-y-auto shrink-0"
        >
          {toolRails.map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setActiveTool(tool.id);
                  if (tool.id !== 'cutout' && tool.id !== 'crop') {
                    setBrushMode('none');
                  }
                }}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0F5C54] text-white shadow-sm'
                    : 'text-slate-700 hover:bg-[#EFEBE2]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{lang === 'ar' ? tool.labelAr : tool.labelEn}</span>
              </button>
            );
          })}
        </nav>

        {/* Central Stage (Mobile 45dvh or expanded 62dvh; Desktop fills center) */}
        <main
          className={`flex flex-col relative shrink-0 lg:shrink lg:flex-1 min-w-0 lg:h-full transition-[height] duration-200 ${
            isStageExpanded ? 'h-[62dvh]' : 'h-[45dvh] min-h-[260px]'
          }`}
        >
          {notice && (
            <div
              className={`px-3 py-1.5 text-xs font-medium flex items-center justify-between gap-2 border-b shrink-0 ${
                notice.tone === 'ok'
                  ? 'bg-[#EDF5F4] text-[#0F5C54] border-[#B8D7D3]'
                  : 'bg-amber-50 text-amber-900 border-amber-200'
              }`}
            >
              <span className="truncate">{notice.text}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="p-0.5 hover:opacity-70 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <StudioCanvas
              lang={lang}
              originalCanvas={originalCanvas}
              compositeCanvas={compositeCanvas}
              dimensions={dimensions}
              selectedDimId={selectedDimId}
              brushMode={brushMode}
              brushSize={brushSize}
              background={background}
              showBeforeAfter={showBeforeAfter}
              isStageExpanded={isStageExpanded}
              onToggleStageExpand={() => setIsStageExpanded((v) => !v)}
              onChangeBrushMode={setBrushMode}
              onToggleBeforeAfter={() => setShowBeforeAfter((v) => !v)}
              onSelectDimension={setSelectedDimId}
              onUpdateDimension={(id, patch) =>
                setDimensions((prev) =>
                  prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
                )
              }
              onUpdateBackgroundOffset={(ox, oy) =>
                setBackground((b) => ({
                  ...b,
                  productOffsetX: ox,
                  productOffsetY: oy,
                }))
              }
              onUpdateProductScale={(scale) =>
                setBackground((b) => ({ ...b, productScale: scale }))
              }
              onMagicWandClick={handleMagicWandClick}
              onBrushStrokeSegment={handleBrushStrokeSegment}
              onBrushEnd={handleBrushEnd}
            />
          </div>
        </main>

        {/* Generous Scrollable Tool Inspector (Takes remaining ~50% height on mobile, 390px pane on desktop) */}
        <aside className="flex-1 lg:flex-none w-full lg:w-[390px] bg-white border-t lg:border-t-0 lg:border-s border-[#E4DDD0] flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#EFECE4] flex items-center justify-between gap-2 shrink-0 bg-[#FCFBF8]">
            <h2 className="text-xs font-bold text-[#171614] flex items-center gap-1.5 whitespace-nowrap">
              <activeToolMeta.icon className="w-3.5 h-3.5 text-[#0F5C54]" />
              <span>
                {lang === 'ar' ? activeToolMeta.labelAr : activeToolMeta.labelEn}
              </span>
            </h2>

            <div className="flex items-center gap-2 min-w-0">
              <div className="flex md:hidden items-center gap-1">
                <button
                  type="button"
                  disabled={maskUndoStack.length === 0}
                  onClick={handleUndoMask}
                  title={lang === 'ar' ? 'تراجع' : 'Undo'}
                  className="p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30 rounded"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={maskRedoStack.length === 0}
                  onClick={handleRedoMask}
                  title={lang === 'ar' ? 'إعادة' : 'Redo'}
                  className="p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30 rounded"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="text-[11px] font-medium text-slate-500 truncate max-w-[160px]">
                {projectTitle}
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-5">
            {/* Prompt-First AI Magic Director Bar */}
            {activeTool !== 'projects' && (
              <div className="p-3 rounded-xl bg-[#FAF8F4] border border-[#DDD5C5] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#171614] inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#B47B2B]" />
                    <span>
                      {lang === 'ar'
                        ? 'مخرج الشمساوية الذكي (بالأمر المباشر)'
                        : 'Al-Shamsawya AI Prompt Director'}
                    </span>
                  </span>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRunAiMagic('auto');
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={magicPrompt}
                    onChange={(e) => setMagicPrompt(e.target.value)}
                    placeholder={
                      lang === 'ar'
                        ? 'اكتب أمرك عادي: حطها في صالون بوهو، اعزلها، اعملها فيديو...'
                        : 'Describe what you want: boho living room, remove bg, reel video...'
                    }
                    className="flex-1 min-w-0 px-3 py-2 text-xs bg-white border border-[#D8D0C0] rounded-lg focus:outline-none focus:border-[#0F5C54]"
                  />
                  <button
                    type="submit"
                    disabled={Boolean(busyAction)}
                    className="inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {busyAction?.startsWith('ai_magic') ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    <span>{lang === 'ar' ? 'تنفيذ' : 'Run'}</span>
                  </button>
                </form>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void handleRunAiMagic('cutout', 'Remove background cleanly')}
                    className="px-2 py-1.5 text-[11px] font-semibold text-slate-800 bg-white border border-[#DDD5C5] hover:border-[#0F5C54] hover:text-[#0F5C54] disabled:opacity-50 rounded-lg whitespace-nowrap truncate"
                  >
                    {lang === 'ar' ? 'عزل AI فوري' : 'AI Cutout'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void handleRunAiMagic(
                        'scene_edit',
                        magicPrompt.trim() ||
                          'Place this handmade item cleanly in a warm sunlit Egyptian bohemian room'
                      )
                    }
                    className="px-2 py-1.5 text-[11px] font-semibold text-slate-800 bg-white border border-[#DDD5C5] hover:border-[#0F5C54] hover:text-[#0F5C54] disabled:opacity-50 rounded-lg whitespace-nowrap truncate"
                  >
                    {lang === 'ar' ? 'دمج في مشهد' : 'AI Scene'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void handleRunAiMagic(
                        'video',
                        magicPrompt.trim() ||
                          'Smooth slow cinematic showcase video of this handmade craft'
                      )
                    }
                    className="px-2 py-1.5 text-[11px] font-semibold text-slate-800 bg-white border border-[#DDD5C5] hover:border-[#0F5C54] hover:text-[#0F5C54] disabled:opacity-50 rounded-lg whitespace-nowrap truncate"
                  >
                    {lang === 'ar' ? 'فيديو AI' : 'AI Video'}
                  </button>
                </div>
              </div>
            )}

            {activeTool === 'cutout' && (
              <div className="space-y-5">
                {/* Mobile/Tablet Quick Sample Switcher */}
                <div className="xl:hidden space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">
                    {lang === 'ar' ? 'نماذج سريعة للتجربة:' : 'Try Sample Crafts:'}
                  </span>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {STUDIO_SAMPLE_PRODUCTS.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        onClick={() =>
                          void loadSourceImageIntoStudio(
                            sample.imageUrl,
                            lang === 'ar' ? sample.titleAr : sample.titleEn,
                            sample.craftType,
                            sample.defaultPrompt
                          )
                        }
                        className="inline-flex items-center gap-1.5 pe-2.5 ps-1 py-1 bg-[#FAF8F4] border border-[#E4DDD0] hover:border-[#0F5C54] rounded-lg text-[11px] font-medium text-slate-800 shrink-0"
                      >
                        <img
                          src={sample.imageUrl}
                          alt={lang === 'ar' ? sample.titleAr : sample.titleEn}
                          className="w-6 h-6 rounded object-cover"
                        />
                        <span className="whitespace-nowrap">
                          {lang === 'ar' ? sample.titleAr : sample.titleEn}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto Cutout Engine */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-slate-900">
                    {lang === 'ar'
                      ? 'العزل الذكي والآلي للمنتج'
                      : 'Smart & AI Product Cutout'}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleAiCutout()}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] disabled:opacity-50 rounded-lg whitespace-nowrap"
                    >
                      {busyAction === 'ai_cutout' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{lang === 'ar' ? 'عزل بالـ AI' : 'AI Cutout'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleLocalSmartCutout}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-800 bg-[#FAF6EE] border border-[#D9CBB3] hover:bg-[#F2E9D8] rounded-lg whitespace-nowrap"
                    >
                      <Scissors className="w-3.5 h-3.5 text-[#B47B2B]" />
                      <span>{lang === 'ar' ? 'عزل فوري' : 'Local Cutout'}</span>
                    </button>
                  </div>

                  <label className="block space-y-1 text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span>
                        {lang === 'ar' ? 'حساسية العزل الفوري' : 'Cutout Sensitivity'}
                      </span>
                      <span className="font-mono tabular-nums">{localCutoutTolerance}</span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={85}
                      value={localCutoutTolerance}
                      onChange={(e) => setLocalCutoutTolerance(Number(e.target.value))}
                      className="w-full accent-[#0F5C54]"
                    />
                  </label>
                </div>

                {/* Magic Wand Section */}
                <div className="space-y-2.5 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Wand2 className="w-3.5 h-3.5 text-[#B47B2B]" />
                      <span>
                        {lang === 'ar'
                          ? 'العصا السحرية (تفريغ فتحات المكرمية)'
                          : 'Magic Wand (Color Knockout)'}
                      </span>
                    </h4>
                    <button
                      type="button"
                      onClick={() =>
                        setBrushMode(brushMode === 'wand' ? 'none' : 'wand')
                      }
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border ${
                        brushMode === 'wand'
                          ? 'bg-[#B47B2B] text-white border-[#B47B2B]'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {brushMode === 'wand'
                        ? lang === 'ar'
                          ? 'نشطة'
                          : 'Active'
                        : lang === 'ar'
                          ? 'تفعيل'
                          : 'Activate'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setWandMode('erase');
                        setBrushMode('wand');
                      }}
                      className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg border ${
                        wandMode === 'erase'
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {lang === 'ar' ? 'حذف اللون المحدد' : 'Erase Color'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWandMode('restore');
                        setBrushMode('wand');
                      }}
                      className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg border ${
                        wandMode === 'restore'
                          ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {lang === 'ar' ? 'استعادة اللون المحدد' : 'Restore Color'}
                    </button>
                  </div>

                  <label className="block space-y-1 text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span>
                        {lang === 'ar'
                          ? 'مدى تقارب الألوان (Tolerance)'
                          : 'Color Tolerance'}
                      </span>
                      <span className="font-mono tabular-nums">{wandTolerance}</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={120}
                      value={wandTolerance}
                      onChange={(e) => setWandTolerance(Number(e.target.value))}
                      className="w-full accent-[#B47B2B]"
                    />
                  </label>

                  <label className="flex items-start gap-2 text-[11px] text-slate-700 bg-[#FAF7F2] border border-[#E5DDD0] rounded-lg p-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!wandContiguous}
                      onChange={(e) => setWandContiguous(!e.target.checked)}
                      className="mt-0.5 rounded accent-[#0F5C54]"
                    />
                    <span>
                      {lang === 'ar'
                        ? 'تحديد شامل لكل المساحات المشابهة (مثالي لتفريغ كل فتحات المكرمية بضغطة واحدة)'
                        : 'Global matching pixels (clears all inner holes in 1 click)'}
                    </span>
                  </label>
                </div>

                {/* Precision Eraser & Restore Brush */}
                <div className="space-y-2.5 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900">
                      {lang === 'ar' ? 'فرشاة التنقيح الدقيقة' : 'Precision Retouch Brush'}
                    </h4>
                    <button
                      type="button"
                      onClick={handleResetMaskFull}
                      className="inline-flex items-center gap-1 text-[11px] text-[#0F5C54] hover:underline"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{lang === 'ar' ? 'إرجاع كامل الصورة' : 'Restore Full'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { id: 'none' as RetouchBrushMode, ar: 'تحديد', en: 'Select', icon: MousePointer2 },
                      { id: 'move' as RetouchBrushMode, ar: 'سحب', en: 'Move', icon: Hand },
                      { id: 'erase' as RetouchBrushMode, ar: 'ممحاة', en: 'Eraser', icon: Eraser },
                      { id: 'restore' as RetouchBrushMode, ar: 'استعادة', en: 'Restore', icon: Paintbrush },
                    ].map((b) => {
                      const BIcon = b.icon;
                      const active = brushMode === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBrushMode(b.id)}
                          className={`inline-flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold rounded-lg border ${
                            active
                              ? b.id === 'erase'
                                ? 'bg-red-600 text-white border-red-600'
                                : 'bg-[#0F5C54] text-white border-[#0F5C54]'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <BIcon className="w-3.5 h-3.5" />
                          <span>{lang === 'ar' ? b.ar : b.en}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600">
                    <label className="space-y-1">
                      <div className="flex justify-between">
                        <span>{lang === 'ar' ? 'حجم الفرشاة' : 'Brush Size'}</span>
                        <span className="font-mono tabular-nums">{brushSize}px</span>
                      </div>
                      <input
                        type="range"
                        min={4}
                        max={110}
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-full accent-[#0F5C54]"
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="flex justify-between">
                        <span>{lang === 'ar' ? 'حدة الفرشاة' : 'Hardness'}</span>
                        <span className="font-mono tabular-nums">
                          {Math.round(brushHardness * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={brushHardness}
                        onChange={(e) => setBrushHardness(Number(e.target.value))}
                        className="w-full accent-[#0F5C54]"
                      />
                    </label>
                  </div>
                </div>

                {/* Edge Refinement */}
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900">
                    {lang === 'ar' ? 'تنعيم وضبط الحواف' : 'Edge Refinement'}
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600">
                    <label className="space-y-1">
                      <div className="flex justify-between">
                        <span>{lang === 'ar' ? 'توسيع/تضييق' : 'Expand/Shrink'}</span>
                        <span className="font-mono tabular-nums">{edgeExpand}px</span>
                      </div>
                      <input
                        type="range"
                        min={-5}
                        max={5}
                        value={edgeExpand}
                        onChange={(e) => setEdgeExpand(Number(e.target.value))}
                        className="w-full accent-[#0F5C54]"
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="flex justify-between">
                        <span>{lang === 'ar' ? 'نعومة التلاشي' : 'Feather'}</span>
                        <span className="font-mono tabular-nums">{edgeFeather}px</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={8}
                        value={edgeFeather}
                        onChange={(e) => setEdgeFeather(Number(e.target.value))}
                        className="w-full accent-[#0F5C54]"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTool === 'crop' && (
              <StudioCropPanel
                lang={lang}
                background={background}
                brushMode={brushMode}
                onChangeBackground={(patch) =>
                  setBackground((b) => ({ ...b, ...patch }))
                }
                onChangeBrushMode={setBrushMode}
                onApplyPermanentCrop={handleApplyPermanentCrop}
              />
            )}

            {activeTool === 'lighting' && (
              <StudioLightingPanel
                lang={lang}
                lighting={lighting}
                onChangeLighting={(patch) =>
                  setLighting((l) => ({ ...l, ...patch }))
                }
                onResetLighting={() => setLighting(DEFAULT_LIGHTING)}
              />
            )}

            {activeTool === 'scenes' && (
              <StudioScenesPanel
                lang={lang}
                background={background}
                shadow={shadow}
                activePrompt={activePrompt}
                busyAction={busyAction}
                onChangeBackground={(patch) =>
                  setBackground((b) => ({ ...b, ...patch }))
                }
                onChangeShadow={(patch) => setShadow((s) => ({ ...s, ...patch }))}
                onChangePrompt={setActivePrompt}
                onEnhancePromptWithAi={handleEnhancePromptWithAi}
                onGenerateAiScene={handleGenerateAiScene}
              />
            )}

            {activeTool === 'dimensions' && (
              <StudioDimensionsPanel
                lang={lang}
                dimensions={dimensions}
                selectedDimId={selectedDimId}
                onSelectDimension={setSelectedDimId}
                onAddDimension={(preset) => {
                  const id = `dim_${Date.now()}`;
                  setDimensions((prev) => [
                    ...prev,
                    {
                      id,
                      label: preset.label,
                      valueText: preset.valueText,
                      x1: preset.x1,
                      y1: preset.y1,
                      x2: preset.x2,
                      y2: preset.y2,
                      color: '#0F5C54',
                      style: 'arrows',
                      thickness: 3,
                      fontSize: 20,
                      showExtensions: true,
                      visible: true,
                    },
                  ]);
                  setSelectedDimId(id);
                }}
                onUpdateDimension={(id, patch) =>
                  setDimensions((prev) =>
                    prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
                  )
                }
                onDeleteDimension={(id) =>
                  setDimensions((prev) => prev.filter((d) => d.id !== id))
                }
                onBakeDimensions={() =>
                  void handleExportFormat({
                    format: 'png',
                    bakeDimensions: true,
                    transparentBg: false,
                  })
                }
              />
            )}

            {activeTool === 'storyboard' && (
              <StudioStoryboardPanel
                lang={lang}
                projectTitle={projectTitle}
                slides={storyboardSlides}
                savedAssets={savedAssets}
                busyAction={busyAction}
                onUpdateSlides={setStoryboardSlides}
                onCaptureCurrentSlide={handleCaptureSlide}
                onAutoGenerateCaptions={handleAutoGenerateCaptions}
                onSaveStoryboardAsset={(dataUrl, title) =>
                  setSavedAssets((prev) => [
                    {
                      id: `asset_${Date.now()}`,
                      kind: 'storyboard',
                      title,
                      dataUrl,
                      mimeType: 'image/png',
                      createdAt: new Date().toISOString(),
                    },
                    ...prev,
                  ])
                }
              />
            )}

            {activeTool === 'video' && (
              <StudioVideoPanel
                lang={lang}
                activeCompositeDataUrl={compositePreviewUrl}
                savedAssets={savedAssets}
                busyAction={busyAction}
                onGenerateAiVideo={handleGenerateAiVideo}
                onSaveVideoAsset={(dataUrl, title, providerUsed) =>
                  setSavedAssets((prev) => [
                    {
                      id: `asset_${Date.now()}`,
                      kind: 'video',
                      title,
                      dataUrl,
                      mimeType: dataUrl.startsWith('data:video/mp4')
                        ? 'video/mp4'
                        : 'video/webm',
                      createdAt: new Date().toISOString(),
                      providerUsed,
                    },
                    ...prev,
                  ])
                }
              />
            )}

            {activeTool === 'projects' && (
              <StudioProjectsPanel
                lang={lang}
                projectId={projectId}
                projectTitle={projectTitle}
                craftType={craftType}
                savedProjects={savedProjects}
                savedAssets={savedAssets}
                cascadeLogs={cascadeLogs}
                savingProject={savingProject}
                onChangeTitle={setProjectTitle}
                onChangeCraftType={setCraftType}
                onSaveProject={handleSaveProject}
                onLoadProject={handleLoadProject}
                onDeleteProject={handleDeleteProject}
                onLoadAssetIntoCanvas={async (asset) => {
                  await loadSourceImageIntoStudio(asset.dataUrl, asset.title);
                  setActiveTool('cutout');
                }}
                onSendExportToParent={handleSendExportToParent}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Mobile Bottom Thumb-Zone Tool Bar (Cleanly aligned start-to-end, never clipped!) */}
      <nav
        aria-label={lang === 'ar' ? 'شريط أدوات الاستوديو' : 'Mobile Studio Tools'}
        className="lg:hidden bg-[#FCFBF8] border-t border-[#E4DDD0] px-2 py-1.5 flex items-center justify-start gap-1.5 overflow-x-auto shrink-0"
      >
        {toolRails.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => {
                setActiveTool(tool.id);
                if (tool.id !== 'cutout' && tool.id !== 'crop') {
                  setBrushMode('none');
                }
              }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[60px] px-2 py-1.5 rounded-xl text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#0F5C54] text-white'
                  : 'text-slate-600 hover:bg-[#EFEBE2]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{lang === 'ar' ? tool.labelAr : tool.labelEn}</span>
            </button>
          );
        })}
      </nav>

      {/* Multi-Format Export Modal (PNG, JPG, WEBP, SVG, ICO) */}
      <StudioExportModal
        lang={lang}
        open={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onExport={handleExportFormat}
      />

      {/* Quick Share Modal (/s Standalone Studio Link) */}
      {isShareModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          onClick={() => setIsShareModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-[#E4DDD0] shadow-xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <img
                  src={SHAMSAWYA_LOGO_URL}
                  alt="استوديو الشمساوية"
                  className="w-8 h-8 object-contain"
                />
                <h3 className="text-sm font-bold text-slate-900">
                  {lang === 'ar' ? 'رابط مشاركة استوديو الشمساوية' : 'Share Al-Shamsawya Studio'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {lang === 'ar'
                ? 'انسخ هذا الرابط المباشر لفتح الاستوديو بشكل مستقل في أي متصفح أو برنامج بدون إظهار لوحة المفاتيح أو إعدادات الـ API.'
                : 'Copy this short standalone URL to open or share Al-Shamsawya Studio independently without exposing API settings.'}
            </p>

            <div className="flex items-center gap-2 p-2 bg-[#FAF8F4] border border-[#DDD5C5] rounded-xl">
              <code
                dir="ltr"
                className="flex-1 text-xs font-mono font-semibold text-slate-900 truncate px-1"
              >
                {shortShareUrl}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyShortLink()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] rounded-lg whitespace-nowrap shrink-0"
              >
                {shareCopied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {shareCopied
                    ? lang === 'ar'
                      ? 'تم النسخ'
                      : 'Copied'
                    : lang === 'ar'
                      ? 'نسخ الرابط'
                      : 'Copy'}
                </span>
              </button>
            </div>

            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <button
                type="button"
                onClick={() =>
                  void navigator
                    .share({
                      title: 'استوديو الشمساوية',
                      text: 'استوديو تصميم وتصوير المنتجات بالذكاء الاصطناعي',
                      url: shortShareUrl,
                    })
                    .catch(() => {})
                }
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-[#EFECE4] hover:bg-[#E4DDD0] rounded-lg"
              >
                <Share2 className="w-4 h-4 text-[#0F5C54]" />
                <span>
                  {lang === 'ar' ? 'مشاركة عبر تطبيقات الهاتف' : 'Share via Device Apps'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
