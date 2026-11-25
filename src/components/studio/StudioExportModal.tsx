import React, { useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import type { ImageExportFormat } from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioExportModalProps {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onExport: (opts: {
    format: ImageExportFormat;
    bakeDimensions: boolean;
    transparentBg: boolean;
    targetSizePx?: number;
  }) => Promise<void>;
}

const FORMAT_OPTIONS: Array<{
  id: ImageExportFormat;
  title: string;
  descAr: string;
  descEn: string;
}> = [
  { id: 'png', title: 'PNG', descAr: 'أعلى جودة + يدعم الخلفية الشفافة', descEn: 'Lossless + Transparent alpha' },
  { id: 'jpg', title: 'JPG / JPEG', descAr: 'خفيف وسريع للمتاجر الإلكترونية', descEn: 'Lightweight for e-commerce' },
  { id: 'webp', title: 'WEBP', descAr: 'صيغة ويب حديثة بحجم مضغوط', descEn: 'Modern compressed web format' },
  { id: 'svg', title: 'SVG', descAr: 'متجه قياسي قابل للتكبير للمطبوعات', descEn: 'Scalable vector wrapper' },
  { id: 'ico', title: 'ICO (أيقونة)', descAr: 'أيقونة برامج ومتصفحات بخلفية شفافة', descEn: 'App & Favicon icon (.ico)' },
];

export const StudioExportModal: React.FC<StudioExportModalProps> = ({
  lang,
  open,
  onClose,
  onExport,
}) => {
  const [format, setFormat] = useState<ImageExportFormat>('png');
  const [bakeDimensions, setBakeDimensions] = useState(true);
  const [transparentBg, setTransparentBg] = useState(false);
  const [targetSizePx, setTargetSizePx] = useState<number>(0);
  const [exporting, setExporting] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    setExporting(true);
    try {
      await onExport({
        format,
        bakeDimensions,
        transparentBg: format === 'jpg' ? false : transparentBg,
        targetSizePx:
          format === 'ico'
            ? targetSizePx > 0 && targetSizePx <= 256
              ? targetSizePx
              : 256
            : targetSizePx > 0
              ? targetSizePx
              : undefined,
      });
      onClose();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            {lang === 'ar'
              ? 'تصدير الصورة بجميع الصيغ'
              : 'Export Image in Any Format'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {lang === 'ar' ? 'اختر صيغة الملف' : 'File Format'}
            </span>
            <div className="grid grid-cols-1 gap-1.5">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFormat(opt.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg border text-start transition-colors ${
                    format === opt.id
                      ? 'bg-[#F0F7F6] border-[#0F5C54]'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900">{opt.title}</div>
                    <div className="text-[11px] text-slate-500">
                      {lang === 'ar' ? opt.descAr : opt.descEn}
                    </div>
                  </div>
                  <span
                    className={`w-4 h-4 rounded-full border-2 ${
                      format === opt.id
                        ? 'border-[#0F5C54] bg-[#0F5C54]'
                        : 'border-slate-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-700">
                {lang === 'ar' ? 'حجم التصدير' : 'Output Size'}
              </span>
              <select
                value={targetSizePx}
                onChange={(e) => setTargetSizePx(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg"
              >
                {format === 'ico' ? (
                  <>
                    <option value={256}>256×256 px (High-Res Icon)</option>
                    <option value={128}>128×128 px</option>
                    <option value={64}>64×64 px</option>
                    <option value={32}>32×32 px (Favicon)</option>
                  </>
                ) : (
                  <>
                    <option value={0}>
                      {lang === 'ar' ? 'الحجم الكامل للكانفاس' : 'Full Canvas Size'}
                    </option>
                    <option value={2048}>2048 px (Ultra HD)</option>
                    <option value={1080}>1080 px (HD / Social)</option>
                    <option value={720}>720 px (Compact)</option>
                    <option value={512}>512 px (Icon / Thumb)</option>
                  </>
                )}
              </select>
            </label>

            <div className="space-y-2 pt-5 text-[11px] text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bakeDimensions}
                  onChange={(e) => setBakeDimensions(e.target.checked)}
                  className="rounded accent-[#0F5C54]"
                />
                <span>{lang === 'ar' ? 'تضمين الأبعاد' : 'Bake Dimensions'}</span>
              </label>

              {format !== 'jpg' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transparentBg}
                    onChange={(e) => setTransparentBg(e.target.checked)}
                    className="rounded accent-[#0F5C54]"
                  />
                  <span>
                    {lang === 'ar' ? 'خلفية شفافة فقط' : 'Force Transparent BG'}
                  </span>
                </label>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleConfirm()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] disabled:opacity-50 rounded-lg"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>
              {lang === 'ar'
                ? `تصدير وتحميل (${format.toUpperCase()})`
                : `Export & Download (${format.toUpperCase()})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
