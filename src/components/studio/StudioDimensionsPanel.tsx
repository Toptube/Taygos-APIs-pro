import React from 'react';
import { Check, Eye, EyeOff, Plus, RotateCw, Ruler, Trash2 } from 'lucide-react';
import type { DimensionOverlay, DimensionStyle } from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioDimensionsPanelProps {
  lang: Language;
  dimensions: DimensionOverlay[];
  selectedDimId: string | null;
  onSelectDimension: (id: string | null) => void;
  onAddDimension: (preset: {
    label: string;
    valueText: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }) => void;
  onUpdateDimension: (id: string, patch: Partial<DimensionOverlay>) => void;
  onDeleteDimension: (id: string) => void;
  onBakeDimensions: () => void;
}

const PRESET_DIMENSIONS = [
  {
    labelAr: 'العرض',
    labelEn: 'Width',
    valueAr: '45 سم',
    valueEn: '45 cm',
    x1: 0.2,
    y1: 0.82,
    x2: 0.8,
    y2: 0.82,
  },
  {
    labelAr: 'الارتفاع',
    labelEn: 'Height',
    valueAr: '70 سم',
    valueEn: '70 cm',
    x1: 0.14,
    y1: 0.18,
    x2: 0.14,
    y2: 0.84,
  },
  {
    labelAr: 'القطر',
    labelEn: 'Diameter',
    valueAr: '50 سم',
    valueEn: '50 cm',
    x1: 0.25,
    y1: 0.5,
    x2: 0.75,
    y2: 0.5,
  },
  {
    labelAr: 'قياس مائل',
    labelEn: 'Diagonal',
    valueAr: '35 سم',
    valueEn: '35 cm',
    x1: 0.24,
    y1: 0.26,
    x2: 0.72,
    y2: 0.68,
  },
];

const COLOR_CHIPS = ['#0F5C54', '#171614', '#B47B2B', '#9F1239', '#FFFFFF'];

export const StudioDimensionsPanel: React.FC<StudioDimensionsPanelProps> = ({
  lang,
  dimensions,
  selectedDimId,
  onSelectDimension,
  onAddDimension,
  onUpdateDimension,
  onDeleteDimension,
  onBakeDimensions,
}) => {
  const selected =
    dimensions.find((d) => d.id === selectedDimId) || dimensions[0] || null;

  const setRotationAngle = (dim: DimensionOverlay, deg: number) => {
    const cx = (dim.x1 + dim.x2) / 2;
    const cy = (dim.y1 + dim.y2) / 2;
    const halfLen = Math.max(
      0.08,
      Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1) / 2
    );
    const rad = (deg * Math.PI) / 180;
    onUpdateDimension(dim.id, {
      x1: Math.max(0.03, Math.min(0.97, cx - Math.cos(rad) * halfLen)),
      y1: Math.max(0.03, Math.min(0.97, cy - Math.sin(rad) * halfLen)),
      x2: Math.max(0.03, Math.min(0.97, cx + Math.cos(rad) * halfLen)),
      y2: Math.max(0.03, Math.min(0.97, cy + Math.sin(rad) * halfLen)),
    });
  };

  const currentAngleDeg = selected
    ? Math.round(
        ((Math.atan2(selected.y2 - selected.y1, selected.x2 - selected.x1) * 180) /
          Math.PI +
          360) %
          360
      )
    : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-900">
          {lang === 'ar'
            ? 'إضافة خط قياس جديد (دوران 360°)'
            : 'Add Dimension Line (360° Rotatable)'}
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          {lang === 'ar'
            ? 'أضف أكثر من بُعد ثم اسحب أي نقطة طرفية على الصورة لتدويره ومطابقته مع ميل القطعة بدقة.'
            : 'Add multiple callouts and drag either endpoint directly on the canvas to rotate 360° along craft contours.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PRESET_DIMENSIONS.map((preset) => (
            <button
              key={preset.labelEn}
              type="button"
              onClick={() =>
                onAddDimension({
                  label: lang === 'ar' ? preset.labelAr : preset.labelEn,
                  valueText: lang === 'ar' ? preset.valueAr : preset.valueEn,
                  x1: preset.x1,
                  y1: preset.y1,
                  x2: preset.x2,
                  y2: preset.y2,
                })
              }
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:border-[#0F5C54] hover:bg-[#F5F9F8] rounded-lg whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 text-[#0F5C54]" />
              <span>{lang === 'ar' ? preset.labelAr : preset.labelEn}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Existing Dimensions List */}
      <div className="space-y-1.5 pt-2 border-t border-slate-100">
        <h4 className="text-[11px] font-semibold text-slate-700">
          {lang === 'ar'
            ? `القياسات الحالية (${dimensions.length})`
            : `Active Dimensions (${dimensions.length})`}
        </h4>
        {dimensions.length === 0 ? (
          <div className="text-xs text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">
            {lang === 'ar'
              ? 'لا توجد أبعاد بعد — أضف قياساً من الأزرار أعلاه.'
              : 'No dimensions added yet — pick a preset above.'}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {dimensions.map((dim) => (
              <div
                key={dim.id}
                onClick={() => onSelectDimension(dim.id)}
                className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
                  selected?.id === dim.id
                    ? 'bg-[#F0F7F6] border-[#0F5C54]'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full border border-slate-300 shrink-0"
                    style={{ backgroundColor: dim.color }}
                  />
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    {dim.label}: {dim.valueText}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateDimension(dim.id, { visible: !dim.visible });
                    }}
                    title={
                      lang === 'ar'
                        ? dim.visible
                          ? 'إخفاء'
                          : 'إظهار'
                        : dim.visible
                          ? 'Hide'
                          : 'Show'
                    }
                    className="p-1 text-slate-500 hover:text-slate-900"
                  >
                    {dim.visible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDimension(dim.id);
                    }}
                    title={lang === 'ar' ? 'حذف القياس' : 'Delete'}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Dimension Inspector */}
      {selected && (
        <div className="space-y-3 pt-3 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-[#0F5C54]" />
            <span>
              {lang === 'ar' ? 'تعديل القياس المحدد' : 'Selected Measurement'}
            </span>
          </h4>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-slate-600">
              <span>{lang === 'ar' ? 'التسمية' : 'Label'}</span>
              <input
                type="text"
                value={selected.label}
                onChange={(e) =>
                  onUpdateDimension(selected.id, { label: e.target.value })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
              />
            </label>
            <label className="space-y-1 text-[11px] text-slate-600">
              <span>
                {lang === 'ar' ? 'القيمة (مثلاً 65 سم)' : 'Value (e.g. 65 cm)'}
              </span>
              <input
                type="text"
                value={selected.valueText}
                onChange={(e) =>
                  onUpdateDimension(selected.id, { valueText: e.target.value })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
              />
            </label>
          </div>

          <label className="block space-y-1 text-[11px] text-slate-600">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1">
                <RotateCw className="w-3 h-3" />
                {lang === 'ar' ? 'زاوية الميل والدوران (360°)' : 'Rotation Angle (360°)'}
              </span>
              <span className="font-mono tabular-nums text-slate-900">
                {currentAngleDeg}°
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={359}
              value={currentAngleDeg}
              onChange={(e) => setRotationAngle(selected, Number(e.target.value))}
              className="w-full accent-[#0F5C54]"
            />
          </label>

          <div className="space-y-1 text-[11px] text-slate-600">
            <span>{lang === 'ar' ? 'شكل النهايات' : 'Endpoint Style'}</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'arrows', labelAr: 'أسهم', labelEn: 'Arrows' },
                  { id: 'triangles', labelAr: 'مثلثات', labelEn: 'Triangles' },
                  { id: 'ticks', labelAr: 'نقاط هندسية', labelEn: 'Dots' },
                ] as { id: DimensionStyle; labelAr: string; labelEn: string }[]
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onUpdateDimension(selected.id, { style: st.id })}
                  className={`px-2 py-1.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${
                    selected.style === st.id
                      ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  {lang === 'ar' ? st.labelAr : st.labelEn}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-600">
              {lang === 'ar' ? 'اللون:' : 'Color:'}
            </span>
            <div className="flex items-center gap-1.5">
              {COLOR_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateDimension(selected.id, { color: c })}
                  className={`w-6 h-6 rounded-full border-2 ${
                    selected.color.toLowerCase() === c.toLowerCase()
                      ? 'border-[#B47B2B] scale-110'
                      : 'border-slate-300'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600">
            <label className="space-y-1">
              <span>
                {lang === 'ar'
                  ? `سمك الخط (${selected.thickness}px)`
                  : `Stroke (${selected.thickness}px)`}
              </span>
              <input
                type="range"
                min={1.5}
                max={6}
                step={0.5}
                value={selected.thickness}
                onChange={(e) =>
                  onUpdateDimension(selected.id, { thickness: Number(e.target.value) })
                }
                className="w-full accent-[#0F5C54]"
              />
            </label>
            <label className="space-y-1">
              <span>
                {lang === 'ar'
                  ? `حجم الخط (${selected.fontSize}px)`
                  : `Font (${selected.fontSize}px)`}
              </span>
              <input
                type="range"
                min={14}
                max={34}
                value={selected.fontSize}
                onChange={(e) =>
                  onUpdateDimension(selected.id, { fontSize: Number(e.target.value) })
                }
                className="w-full accent-[#0F5C54]"
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.showExtensions}
              onChange={(e) =>
                onUpdateDimension(selected.id, { showExtensions: e.target.checked })
              }
              className="rounded accent-[#0F5C54]"
            />
            <span>
              {lang === 'ar'
                ? 'إظهار شرط الامتداد الجانبية عند الأطراف'
                : 'Show side extension ticks'}
            </span>
          </label>
        </div>
      )}

      {dimensions.length > 0 && (
        <div className="pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onBakeDimensions}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-[#171614] hover:bg-slate-800 rounded-lg whitespace-nowrap"
          >
            <Check className="w-4 h-4 text-[#D9A760]" />
            <span>
              {lang === 'ar'
                ? 'تصدير مع الأبعاد مدمجة (PNG)'
                : 'Export With Baked Dimensions (PNG)'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
