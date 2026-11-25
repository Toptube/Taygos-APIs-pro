import React from 'react';
import { RotateCcw, Sliders, Sparkles } from 'lucide-react';
import {
  DEFAULT_LIGHTING,
  PHOTO_FILTER_PRESETS,
} from '../../lib/studioPresets';
import type { LightingConfig } from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioLightingPanelProps {
  lang: Language;
  lighting: LightingConfig;
  onChangeLighting: (patch: Partial<LightingConfig>) => void;
  onResetLighting: () => void;
}

export const StudioLightingPanel: React.FC<StudioLightingPanelProps> = ({
  lang,
  lighting,
  onChangeLighting,
  onResetLighting,
}) => {
  const sliders: Array<{
    key: keyof Omit<LightingConfig, 'filterId' | 'filterIntensity'>;
    labelAr: string;
    labelEn: string;
    min: number;
    max: number;
  }> = [
    { key: 'brightness', labelAr: 'السطوع العام', labelEn: 'Brightness', min: -50, max: 50 },
    { key: 'contrast', labelAr: 'التباين والعمق', labelEn: 'Contrast', min: -50, max: 50 },
    { key: 'saturation', labelAr: 'تشبع الألوان', labelEn: 'Saturation', min: -60, max: 60 },
    { key: 'warmth', labelAr: 'الدفء اللوني', labelEn: 'Warmth', min: -50, max: 50 },
    { key: 'shadows', labelAr: 'إضاءة الظلال', labelEn: 'Shadow Lift', min: -40, max: 50 },
    { key: 'highlights', labelAr: 'موازنة الإبرازات', labelEn: 'Highlights', min: -40, max: 40 },
    { key: 'clarity', labelAr: 'حدة وتفاصيل النسيج', labelEn: 'Texture Clarity', min: 0, max: 100 },
  ];

  return (
    <div className="space-y-5">
      {/* Photographic Filters Grid */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#B47B2B]" />
            <span>
              {lang === 'ar' ? 'فلاتر التصوير الاحترافية' : 'Studio Photo Filters'}
            </span>
          </h3>
          <button
            type="button"
            onClick={onResetLighting}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0F5C54] hover:underline"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{lang === 'ar' ? 'تصفير الكل' : 'Reset All'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {PHOTO_FILTER_PRESETS.map((f) => {
            const active = lighting.filterId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onChangeLighting({ filterId: f.id })}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-start transition-colors ${
                  active
                    ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full border border-black/15 shrink-0"
                  style={{ backgroundColor: f.swatch }}
                />
                <span className="text-[11px] font-semibold truncate">
                  {lang === 'ar' ? f.labelAr : f.labelEn}
                </span>
              </button>
            );
          })}
        </div>

        {lighting.filterId !== 'none' && (
          <label className="block space-y-1 text-[11px] text-slate-600 pt-1">
            <div className="flex justify-between">
              <span>{lang === 'ar' ? 'قوة الفلتر' : 'Filter Strength'}</span>
              <span className="font-mono text-slate-900">
                {lighting.filterIntensity}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={lighting.filterIntensity}
              onChange={(e) =>
                onChangeLighting({ filterIntensity: Number(e.target.value) })
              }
              className="w-full accent-[#B47B2B]"
            />
          </label>
        )}
      </div>

      {/* Precision Lighting Sliders */}
      <div className="space-y-3 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#0F5C54]" />
            <span>
              {lang === 'ar' ? 'ضبط الإضاءة والألوان الدقيق' : 'Lighting Adjustments'}
            </span>
          </h4>
          <button
            type="button"
            onClick={() =>
              onChangeLighting({
                brightness: DEFAULT_LIGHTING.brightness,
                contrast: DEFAULT_LIGHTING.contrast,
                saturation: DEFAULT_LIGHTING.saturation,
                warmth: DEFAULT_LIGHTING.warmth,
                shadows: DEFAULT_LIGHTING.shadows,
                highlights: DEFAULT_LIGHTING.highlights,
                clarity: DEFAULT_LIGHTING.clarity,
              })
            }
            className="text-[11px] text-slate-500 hover:text-slate-900"
          >
            {lang === 'ar' ? 'إعادة الإضاءة' : 'Reset Light'}
          </button>
        </div>

        <div className="space-y-2.5">
          {sliders.map((s) => (
            <label key={s.key} className="block space-y-1 text-[11px] text-slate-700">
              <div className="flex justify-between">
                <span className="font-medium">
                  {lang === 'ar' ? s.labelAr : s.labelEn}
                </span>
                <span className="font-mono text-slate-900">{lighting[s.key]}</span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                value={lighting[s.key]}
                onChange={(e) =>
                  onChangeLighting({ [s.key]: Number(e.target.value) })
                }
                className="w-full accent-[#0F5C54]"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};
