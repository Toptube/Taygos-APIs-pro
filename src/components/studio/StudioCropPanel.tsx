import React from 'react';
import { Check, Crop, Hand, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { CANVAS_ASPECT_PRESETS } from '../../lib/studioPresets';
import type { BackgroundConfig, RetouchBrushMode } from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioCropPanelProps {
  lang: Language;
  background: BackgroundConfig;
  brushMode: RetouchBrushMode;
  onChangeBackground: (patch: Partial<BackgroundConfig>) => void;
  onChangeBrushMode: (mode: RetouchBrushMode) => void;
  onApplyPermanentCrop: () => Promise<void>;
}

export const StudioCropPanel: React.FC<StudioCropPanelProps> = ({
  lang,
  background,
  brushMode,
  onChangeBackground,
  onChangeBrushMode,
  onApplyPermanentCrop,
}) => {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
          <Crop className="w-3.5 h-3.5 text-[#0F5C54]" />
          <span>
            {lang === 'ar'
              ? 'أبعاد الكادر ونسب القص (Aspect Ratios)'
              : 'Frame Aspect Ratios & Crop'}
          </span>
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          {lang === 'ar'
            ? 'اختر نسبة العرض المناسبة للمتجر أو السوشيال ميديا وسيتغير حجم الكادر والتصدير فوراً.'
            : 'Choose an aspect ratio for e-commerce or social feeds. The canvas and exports resize cleanly.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          {CANVAS_ASPECT_PRESETS.map((preset) => {
            const active = background.aspectPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChangeBackground({ aspectPreset: preset.id })}
                className={`text-start p-2.5 rounded-lg border transition-colors ${
                  active
                    ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-semibold">
                  {lang === 'ar' ? preset.labelAr : preset.labelEn}
                </div>
                <div
                  className={`text-[10px] font-mono mt-0.5 ${
                    active ? 'text-teal-100' : 'text-slate-500'
                  }`}
                >
                  {preset.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fit vs Fill */}
      <div className="space-y-2 pt-3 border-t border-slate-100">
        <span className="text-xs font-bold text-slate-900">
          {lang === 'ar' ? 'أسلوب ملاءمة الصورة بالكادر' : 'Image Fit Mode'}
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              onChangeBackground({
                fitMode: 'contain',
                productScale: 0.92,
                productOffsetX: 0,
                productOffsetY: 0,
              })
            }
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border ${
              background.fitMode === 'contain'
                ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'احتواء كامل' : 'Fit Inside'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeBackground({
                fitMode: 'cover',
                productScale: 1,
                productOffsetX: 0,
                productOffsetY: 0,
              })
            }
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border ${
              background.fitMode === 'cover'
                ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'ملء الكادر' : 'Fill Frame'}</span>
          </button>
        </div>
      </div>

      {/* Zoom & Pan */}
      <div className="space-y-3 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-900">
            {lang === 'ar' ? 'تكبير وتحريك المنتج' : 'Zoom & Position'}
          </span>
          <button
            type="button"
            onClick={() =>
              onChangeBackground({
                productScale: 0.92,
                productOffsetX: 0,
                productOffsetY: 0,
              })
            }
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0F5C54] hover:underline"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{lang === 'ar' ? 'توسيط' : 'Reset'}</span>
          </button>
        </div>

        <label className="block space-y-1 text-[11px] text-slate-600">
          <div className="flex justify-between">
            <span>{lang === 'ar' ? 'نسبة التكبير' : 'Zoom Scale'}</span>
            <span className="font-mono text-slate-900">
              {Math.round(background.productScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2.4}
            step={0.02}
            value={background.productScale}
            onChange={(e) =>
              onChangeBackground({ productScale: Number(e.target.value) })
            }
            className="w-full accent-[#0F5C54]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600">
          <label className="space-y-1">
            <span>{lang === 'ar' ? 'إزاحة أفقية' : 'Horizontal Offset'}</span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.01}
              value={background.productOffsetX}
              onChange={(e) =>
                onChangeBackground({ productOffsetX: Number(e.target.value) })
              }
              className="w-full accent-[#0F5C54]"
            />
          </label>
          <label className="space-y-1">
            <span>{lang === 'ar' ? 'إزاحة رأسية' : 'Vertical Offset'}</span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.01}
              value={background.productOffsetY}
              onChange={(e) =>
                onChangeBackground({ productOffsetY: Number(e.target.value) })
              }
              className="w-full accent-[#0F5C54]"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() =>
            onChangeBrushMode(brushMode === 'move' ? 'none' : 'move')
          }
          className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border ${
            brushMode === 'move'
              ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
              : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Hand className="w-3.5 h-3.5" />
          <span>
            {brushMode === 'move'
              ? lang === 'ar'
                ? 'وضع السحب اليدوي نشط (اسحب الصورة بالماوس)'
                : 'Drag Tool Active (Drag image on canvas)'
              : lang === 'ar'
                ? 'تفعيل السحب اليدوي للصورة على الكانفاس'
                : 'Enable Drag-to-Reposition on Canvas'}
          </span>
        </button>
      </div>

      {/* Commit Crop */}
      <div className="pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={() => void onApplyPermanentCrop()}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-[#171614] hover:bg-slate-800 rounded-lg whitespace-nowrap"
        >
          <Check className="w-4 h-4 text-[#D9A760]" />
          <span>
            {lang === 'ar'
              ? 'تثبيت القص الحالي كأصل العمل الجديد'
              : 'Apply & Commit Crop'}
          </span>
        </button>
      </div>
    </div>
  );
};
