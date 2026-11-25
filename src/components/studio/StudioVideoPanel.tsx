import React, { useState } from 'react';
import { Download, Film, ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { renderLocalMotionVideo } from '../../lib/studioEngine';
import {
  VIDEO_MOTION_OPTIONS,
  VIDEO_PLATFORM_PRESETS,
} from '../../lib/studioPresets';
import type {
  StudioAssetItem,
  VideoAspectRatio,
  VideoExportFormat,
  VideoGenerationMode,
  VideoMotionStyle,
} from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioVideoPanelProps {
  lang: Language;
  activeCompositeDataUrl: string;
  savedAssets: StudioAssetItem[];
  busyAction: string | null;
  onGenerateAiVideo: (params: {
    mode: VideoGenerationMode;
    prompt: string;
    startImage?: string;
    endImage?: string;
    aspectRatio: VideoAspectRatio;
    durationSec: number;
  }) => Promise<string | null>;
  onSaveVideoAsset: (
    videoDataUrl: string,
    title: string,
    providerUsed: string
  ) => void;
}

const VIDEO_MODES: Array<{
  id: VideoGenerationMode;
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
}> = [
  {
    id: 'text-to-video',
    labelAr: 'نص ← فيديو',
    labelEn: 'Text → Video',
    descAr: 'توليد فيديو من الوصف النصي فقط',
    descEn: 'Create video purely from text prompt',
  },
  {
    id: 'image-to-video',
    labelAr: 'صورة ← فيديو',
    labelEn: 'Image → Video',
    descAr: 'تحريك لقطة المنتج مباشرة',
    descEn: 'Animate your product shot directly',
  },
  {
    id: 'image-prompt',
    labelAr: 'صورة + برومبت',
    labelEn: 'Image + Prompt',
    descAr: 'تحريك الصورة بتوجيه حركة مخصص',
    descEn: 'Direct motion style with text prompt',
  },
  {
    id: 'start-end',
    labelAr: 'أول + آخر لقطة',
    labelEn: 'Start → End',
    descAr: 'دمج وتحريك بين لقطة بداية ونهاية',
    descEn: 'Smooth motion between 2 frames',
  },
  {
    id: 'start-end-prompt',
    labelAr: 'أول + آخر + برومبت',
    labelEn: 'Start + End + Prompt',
    descAr: 'انتقال ذكي بين لقطتين بوصف الحركة',
    descEn: 'AI transition connecting start & end',
  },
];

export const StudioVideoPanel: React.FC<StudioVideoPanelProps> = ({
  lang,
  activeCompositeDataUrl,
  savedAssets,
  busyAction,
  onGenerateAiVideo,
  onSaveVideoAsset,
}) => {
  const [mode, setMode] = useState<VideoGenerationMode>('image-prompt');
  const [prompt, setPrompt] = useState(
    lang === 'ar'
      ? 'لقطة دعائية ناعمة لإبراز تفاصيل المكرمية والخرز الخشبي مع إضاءة شمسية دافئة دون تغيير شكل القطعة.'
      : 'Smooth studio promotional shot showcasing handmade macrame knots and wooden beads under warm afternoon sunlight.'
  );
  const [startFrame, setStartFrame] = useState<string>('');
  const [endFrame, setEndFrame] = useState<string>('');
  const [motionStyle, setMotionStyle] = useState<VideoMotionStyle>('gentle_zoom');
  const [platformId, setPlatformId] = useState<string>('tiktok_reels_fhd');
  const [exportFormat, setExportFormat] = useState<VideoExportFormat>('mp4');
  const [durationSec, setDurationSec] = useState<number>(5);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoExt, setVideoExt] = useState<VideoExportFormat>('mp4');
  const [videoSourceNote, setVideoSourceNote] = useState<string>('');

  const selectedPlatform =
    VIDEO_PLATFORM_PRESETS.find((p) => p.id === platformId) ||
    VIDEO_PLATFORM_PRESETS[3];

  const needsStart = mode !== 'text-to-video';
  const needsEnd = mode === 'start-end' || mode === 'start-end-prompt';
  const needsPrompt =
    mode === 'text-to-video' ||
    mode === 'image-prompt' ||
    mode === 'start-end-prompt';

  const resolvedStart = startFrame || activeCompositeDataUrl;

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'start' | 'end'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        if (target === 'start') setStartFrame(reader.result);
        else setEndFrame(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRunAiCascade = async () => {
    const motionHint =
      VIDEO_MOTION_OPTIONS.find((m) => m.id === motionStyle)?.promptHint || '';
    const composedPrompt = [prompt.trim(), motionHint].filter(Boolean).join('. ');

    const url = await onGenerateAiVideo({
      mode,
      prompt: composedPrompt,
      startImage: needsStart ? resolvedStart : undefined,
      endImage: needsEnd ? endFrame || resolvedStart : undefined,
      aspectRatio: selectedPlatform.aspectRatio,
      durationSec,
    });
    if (url) {
      setVideoUrl(url);
      setVideoExt('mp4');
      setVideoSourceNote(
        lang === 'ar'
          ? `تم التوليد عبر سلسلة الـ AI APIs (${selectedPlatform.qualityTag})`
          : `Generated via Taygos AI Video Cascade (${selectedPlatform.qualityTag})`
      );
    }
  };

  const handleRunLocalMotion = async () => {
    setLocalProgress(0);
    try {
      const { dataUrl, formatUsed } = await renderLocalMotionVideo({
        mode,
        prompt: needsPrompt ? prompt : '',
        startImageUrl: needsStart ? resolvedStart : undefined,
        endImageUrl: needsEnd ? endFrame || resolvedStart : undefined,
        width: selectedPlatform.width,
        height: selectedPlatform.height,
        durationSec,
        motionStyle,
        format: exportFormat,
        onProgress: setLocalProgress,
      });
      setVideoUrl(dataUrl);
      setVideoExt(formatUsed);
      setVideoSourceNote(
        lang === 'ar'
          ? `فيديو استوديو فوري (${formatUsed.toUpperCase()} · ${selectedPlatform.qualityTag} · 30fps)`
          : `Instant Studio Render (${formatUsed.toUpperCase()} · ${selectedPlatform.qualityTag} · 30fps)`
      );
      onSaveVideoAsset(
        dataUrl,
        `${selectedPlatform.platform} (${selectedPlatform.qualityTag})`,
        `Al-Shamsawya (${formatUsed.toUpperCase()})`
      );
    } finally {
      setLocalProgress(null);
    }
  };

  const imageAssets = savedAssets.filter((a) => a.kind !== 'video');
  const latestVideoAsset = savedAssets.find((a) => a.kind === 'video');
  const displayedVideoUrl = videoUrl || latestVideoAsset?.dataUrl || '';
  const displayedVideoNote =
    videoSourceNote ||
    (latestVideoAsset
      ? `${latestVideoAsset.title}${latestVideoAsset.providerUsed ? ` · ${latestVideoAsset.providerUsed}` : ''}`
      : '');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-900">
          {lang === 'ar'
            ? 'وضع توليد الفيديو (5 أوضاع متكاملة)'
            : 'Video Generation Mode (5 Modes)'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {VIDEO_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`text-start p-2 rounded-lg border transition-colors ${
                mode === m.id
                  ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-semibold">
                {lang === 'ar' ? m.labelAr : m.labelEn}
              </div>
              <div
                className={`text-[10px] mt-0.5 ${
                  mode === m.id ? 'text-teal-100' : 'text-slate-500'
                }`}
              >
                {lang === 'ar' ? m.descAr : m.descEn}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Frame Pickers */}
      {needsStart && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700">
              {lang === 'ar' ? 'إطار البداية (First Frame)' : 'Start Frame'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStartFrame(activeCompositeDataUrl)}
                className="text-[#0F5C54] font-medium hover:underline"
              >
                {lang === 'ar' ? 'الكانفاس الحالي' : 'Use Canvas'}
              </button>
              <label className="inline-flex items-center gap-1 text-[#B47B2B] font-medium cursor-pointer hover:underline">
                <ImagePlus className="w-3 h-3" />
                <span>{lang === 'ar' ? 'رفع' : 'Upload'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileUpload(e, 'start')}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          {resolvedStart && (
            <img
              src={resolvedStart}
              alt="Start frame"
              className="w-full h-24 object-contain bg-slate-100 rounded-lg border border-slate-200"
            />
          )}
        </div>
      )}

      {needsEnd && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700">
              {lang === 'ar' ? 'إطار النهاية (Last Frame)' : 'End Frame'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEndFrame(activeCompositeDataUrl)}
                className="text-[#0F5C54] font-medium hover:underline"
              >
                {lang === 'ar' ? 'الكانفاس الحالي' : 'Use Canvas'}
              </button>
              <label className="inline-flex items-center gap-1 text-[#B47B2B] font-medium cursor-pointer hover:underline">
                <ImagePlus className="w-3 h-3" />
                <span>{lang === 'ar' ? 'رفع ثانية' : 'Upload'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileUpload(e, 'end')}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          {imageAssets.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {imageAssets.slice(0, 6).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setEndFrame(a.dataUrl)}
                  className={`w-11 h-11 rounded border overflow-hidden shrink-0 ${
                    endFrame === a.dataUrl
                      ? 'border-[#0F5C54] ring-2 ring-[#0F5C54]/30'
                      : 'border-slate-200'
                  }`}
                >
                  <img
                    src={a.dataUrl}
                    alt={a.title}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {endFrame && (
            <img
              src={endFrame}
              alt="End frame"
              className="w-full h-24 object-contain bg-slate-100 rounded-lg border border-slate-200"
            />
          )}
        </div>
      )}

      {/* Platform Dimensions, Format & Motion Controls */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        {needsPrompt && (
          <label className="block space-y-1 text-[11px] text-slate-700">
            <span className="font-semibold">
              {lang === 'ar'
                ? 'وصف الحركة والمشهد (Motion Prompt)'
                : 'Motion & Scene Prompt'}
            </span>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'مثال: تقريب سينمائي هادئ على عقد المكرمية مع إضاءة دافئة...'
                  : 'Slow push-in showcasing fine cotton knots...'
              }
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
            />
          </label>
        )}

        <label className="block space-y-1 text-[11px] text-slate-700">
          <span className="font-semibold">
            {lang === 'ar'
              ? 'منصة النشر والجودة (Social Media & YouTube)'
              : 'Platform & Resolution Preset'}
          </span>
          <select
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
            className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
          >
            {VIDEO_PLATFORM_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {lang === 'ar' ? p.labelAr : p.labelEn} — {p.qualityTag}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-[11px] text-slate-700">
          <span className="font-semibold">
            {lang === 'ar' ? 'أسلوب حركة الكاميرا' : 'Camera Motion Style'}
          </span>
          <select
            value={motionStyle}
            onChange={(e) => setMotionStyle(e.target.value as VideoMotionStyle)}
            className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
          >
            {VIDEO_MOTION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {lang === 'ar' ? opt.labelAr : opt.labelEn}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
          <div className="space-y-1">
            <span className="font-semibold">
              {lang === 'ar' ? 'صيغة التصدير' : 'Output Format'}
            </span>
            <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-lg">
              {(['mp4', 'webm'] as VideoExportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setExportFormat(fmt)}
                  className={`py-1.5 text-[11px] font-bold uppercase rounded-md transition-colors ${
                    exportFormat === fmt
                      ? 'bg-[#0F5C54] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <label className="space-y-1">
            <span className="font-semibold">
              {lang === 'ar'
                ? `المدة (${durationSec} ثوانٍ)`
                : `Duration (${durationSec}s)`}
            </span>
            <input
              type="range"
              min={3}
              max={10}
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
              className="w-full mt-2 accent-[#0F5C54]"
            />
          </label>
        </div>
      </div>

      {/* Execute Actions */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          disabled={Boolean(busyAction) || localProgress !== null}
          onClick={() => void handleRunAiCascade()}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] disabled:opacity-50 rounded-lg whitespace-nowrap"
        >
          {busyAction === 'generate_video' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>
            {lang === 'ar'
              ? 'توليد عبر سلسلة الـ AI APIs'
              : 'Generate via AI Video Cascade'}
          </span>
        </button>

        <button
          type="button"
          disabled={Boolean(busyAction) || localProgress !== null}
          onClick={() => void handleRunLocalMotion()}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-900 bg-[#FAF6EE] border border-[#D9CBB3] hover:bg-[#F2E9D8] disabled:opacity-50 rounded-lg whitespace-nowrap"
        >
          {localProgress !== null ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#B47B2B]" />
              <span>
                {lang === 'ar'
                  ? `جارٍ التصوير (${selectedPlatform.qualityTag})... ${localProgress}%`
                  : `Rendering ${selectedPlatform.qualityTag}... ${localProgress}%`}
              </span>
            </>
          ) : (
            <>
              <Film className="w-4 h-4 text-[#B47B2B]" />
              <span>
                {lang === 'ar'
                  ? `تصوير فوري (${exportFormat.toUpperCase()} · ${selectedPlatform.qualityTag})`
                  : `Instant Studio Render (${exportFormat.toUpperCase()} · ${selectedPlatform.qualityTag})`}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Video Player Preview */}
      {displayedVideoUrl && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          {displayedVideoNote && (
            <div className="text-[11px] font-medium text-[#0F5C54]">
              {displayedVideoNote}
            </div>
          )}
          <video
            src={displayedVideoUrl}
            controls
            playsInline
            loop
            className="w-full rounded-lg border border-slate-200 bg-black max-h-72"
          />
          <a
            href={displayedVideoUrl}
            download={`shamsawya-${selectedPlatform.id}-${Date.now()}.${videoExt}`}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#171614] hover:bg-slate-800 rounded-lg whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {lang === 'ar'
                ? `تحميل الفيديو (${videoExt.toUpperCase()})`
                : `Download Video (${videoExt.toUpperCase()})`}
            </span>
          </a>
        </div>
      )}
    </div>
  );
};
