import React, { useState } from 'react';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import {
  ECOMMERCE_BG_SWATCHES,
  STUDIO_SCENE_PRESETS,
} from '../../lib/studioPresets';
import type { BackgroundConfig, ShadowConfig } from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioScenesPanelProps {
  lang: Language;
  background: BackgroundConfig;
  shadow: ShadowConfig;
  activePrompt: string;
  busyAction: string | null;
  onChangeBackground: (patch: Partial<BackgroundConfig>) => void;
  onChangeShadow: (patch: Partial<ShadowConfig>) => void;
  onChangePrompt: (prompt: string) => void;
  onEnhancePromptWithAi: () => Promise<void>;
  onGenerateAiScene: (compositeProductOnTop: boolean) => Promise<void>;
}

export const StudioScenesPanel: React.FC<StudioScenesPanelProps> = ({
  lang,
  background,
  shadow,
  activePrompt,
  busyAction,
  onChangeBackground,
  onChangeShadow,
  onChangePrompt,
  onEnhancePromptWithAi,
  onGenerateAiScene,
}) => {
  const [preserveProductLayer, setPreserveProductLayer] = useState(false);

  return (
    <div className="space-y-5">
      {/* 1) Background Mode Selector */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-bold text-slate-900">
          {lang === 'ar' ? 'نوع الخلفية الأساسية' : 'Background Layer'}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'transparent', labelAr: 'شفاف (PNG)', labelEn: 'Transparent' },
            { id: 'white', labelAr: 'أبيض متاجر نقي', labelEn: 'Pure White' },
            { id: 'boho_gradient', labelAr: 'تدرج بوهو دافئ', labelEn: 'Warm Boho Grad' },
            { id: 'solid', labelAr: 'لون مخصص', labelEn: 'Custom Color' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                onChangeBackground({
                  mode: opt.id as BackgroundConfig['mode'],
                })
              }
              className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                background.mode === opt.id
                  ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {lang === 'ar' ? opt.labelAr : opt.labelEn}
            </button>
          ))}
        </div>

        {/* Color Swatches */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {ECOMMERCE_BG_SWATCHES.map((sw) => {
            const label = lang === 'ar' ? sw.labelAr : sw.labelEn;
            const active =
              (background.mode === 'white' && sw.color === '#FFFFFF') ||
              (background.mode === 'solid' &&
                background.solidColor.toLowerCase() === sw.color.toLowerCase());
            return (
              <button
                key={sw.id}
                type="button"
                title={label}
                onClick={() =>
                  onChangeBackground({
                    mode: sw.color === '#FFFFFF' ? 'white' : 'solid',
                    solidColor: sw.color,
                  })
                }
                className={`w-7 h-7 rounded-full border-2 transition-transform ${
                  active ? 'border-[#0F5C54] scale-110' : 'border-slate-300'
                }`}
                style={{ backgroundColor: sw.color }}
              />
            );
          })}
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 ms-1 cursor-pointer">
            <input
              type="color"
              value={background.solidColor || '#F5EFE6'}
              onChange={(e) =>
                onChangeBackground({
                  mode: 'solid',
                  solidColor: e.target.value,
                })
              }
              className="w-7 h-7 rounded cursor-pointer border border-slate-200"
            />
            <span>{lang === 'ar' ? 'مخصص' : 'Pick'}</span>
          </label>
        </div>
      </div>

      {/* 2) Product Scale & Position */}
      <div className="space-y-2.5 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900">
            {lang === 'ar' ? 'حجم وتموضع القطعة' : 'Product Scale & Center'}
          </h3>
          <button
            type="button"
            onClick={() =>
              onChangeBackground({
                productScale: 1,
                productOffsetX: 0,
                productOffsetY: 0,
              })
            }
            className="text-[11px] font-medium text-[#0F5C54] hover:underline"
          >
            {lang === 'ar' ? 'توسيط (100%)' : 'Center (100%)'}
          </button>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-600">
            <span>{lang === 'ar' ? 'مقياس المنتج' : 'Product Scale'}</span>
            <span className="font-mono tabular-nums">
              {Math.round(background.productScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.35}
            max={1.8}
            step={0.02}
            value={background.productScale}
            onChange={(e) =>
              onChangeBackground({ productScale: Number(e.target.value) })
            }
            className="w-full accent-[#0F5C54]"
          />
        </div>
      </div>

      {/* 3) Soft Contact Shadows */}
      <div className="space-y-2.5 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 cursor-pointer">
            <input
              type="checkbox"
              checked={shadow.enabled}
              onChange={(e) => onChangeShadow({ enabled: e.target.checked })}
              className="rounded accent-[#0F5C54]"
            />
            <span>
              {lang === 'ar'
                ? 'ظلال استوديو تحت المنتج (Contact Shadow)'
                : 'Realistic Contact Shadow'}
            </span>
          </label>
        </div>

        {shadow.enabled && (
          <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600">
            <label className="space-y-1">
              <div className="flex justify-between">
                <span>{lang === 'ar' ? 'قوة الظل' : 'Opacity'}</span>
                <span className="font-mono tabular-nums">
                  {Math.round(shadow.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.75}
                step={0.02}
                value={shadow.opacity}
                onChange={(e) => onChangeShadow({ opacity: Number(e.target.value) })}
                className="w-full accent-[#0F5C54]"
              />
            </label>
            <label className="space-y-1">
              <div className="flex justify-between">
                <span>{lang === 'ar' ? 'نعومة التشتت' : 'Blur'}</span>
                <span className="font-mono tabular-nums">{shadow.blur}px</span>
              </div>
              <input
                type="range"
                min={4}
                max={54}
                value={shadow.blur}
                onChange={(e) => onChangeShadow({ blur: Number(e.target.value) })}
                className="w-full accent-[#0F5C54]"
              />
            </label>
            <label className="space-y-1">
              <div className="flex justify-between">
                <span>{lang === 'ar' ? 'المسافة العمودية' : 'Vertical Offset'}</span>
                <span className="font-mono tabular-nums">{shadow.offsetY}px</span>
              </div>
              <input
                type="range"
                min={-15}
                max={48}
                value={shadow.offsetY}
                onChange={(e) => onChangeShadow({ offsetY: Number(e.target.value) })}
                className="w-full accent-[#0F5C54]"
              />
            </label>
            <label className="space-y-1">
              <div className="flex justify-between">
                <span>{lang === 'ar' ? 'انتشار العرض' : 'Spread'}</span>
                <span className="font-mono tabular-nums">
                  {Math.round(shadow.spread * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.35}
                max={1.2}
                step={0.05}
                value={shadow.spread}
                onChange={(e) => onChangeShadow({ spread: Number(e.target.value) })}
                className="w-full accent-[#0F5C54]"
              />
            </label>
          </div>
        )}
      </div>

      {/* 4) AI Scene Presets Library + Prompt Editor */}
      <div className="space-y-2.5 pt-3 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-900">
          {lang === 'ar'
            ? 'مكتبة مشاهد الشمس كرافت والبرومبت الذكي'
            : 'Al-Shamsawya Scene Presets & AI'}
        </h3>
        <div className="space-y-1.5 max-h-44 overflow-y-auto pe-1">
          {STUDIO_SCENE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChangePrompt(preset.prompt)}
              className="w-full text-start p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-[#F5EFE6] hover:border-[#C5B39A] transition-colors"
            >
              <div className="text-xs font-semibold text-slate-900">
                {lang === 'ar' ? preset.titleAr : preset.titleEn}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {lang === 'ar' ? preset.descAr : preset.descEn}
              </div>
            </button>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-slate-700">
            {lang === 'ar'
              ? 'وصف المشهد المطلوب (عربي أو إنجليزي)'
              : 'Scene Description Prompt'}
          </span>
          <textarea
            rows={3}
            value={activePrompt}
            onChange={(e) => onChangePrompt(e.target.value)}
            placeholder={
              lang === 'ar'
                ? 'صف الخلفية أو الأجواء المصرية المناسبة لمنتجك...'
                : 'Describe your desired commercial scene backdrop...'
            }
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
          />
        </label>

        <label className="flex items-start gap-2 text-[11px] text-slate-700 bg-[#FAF7F2] border border-[#E5DDD0] rounded-lg p-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!preserveProductLayer}
            onChange={(e) => setPreserveProductLayer(!e.target.checked)}
            className="mt-0.5 rounded accent-[#0F5C54]"
          />
          <span>
            {lang === 'ar'
              ? 'الدمج الذكي الكامل (يقرأ المنتج ويضعه بإضاءة وظلال واقعية في المشهد عبر FLUX Kontext؛ وعند إلغائه يركّب القطعة المعزولة فوق خلفية مولّدة).'
              : 'Smart AI Context Placement (FLUX Kontext places the product naturally with shadows; uncheck to composite isolated cutout over a generated backdrop).'}
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => void onEnhancePromptWithAi()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            {busyAction === 'enhance_prompt' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5 text-[#B47B2B]" />
            )}
            <span>
              {lang === 'ar' ? 'تحسين البرومبت بالـ AI' : 'Enhance Prompt'}
            </span>
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => void onGenerateAiScene(preserveProductLayer)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            {busyAction === 'generate_scene' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{lang === 'ar' ? 'توليد المشهد' : 'Generate Scene'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
