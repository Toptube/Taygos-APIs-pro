import React, { useState } from 'react';
import {
  Download,
  FileText,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { renderStoryboardSheet } from '../../lib/studioEngine';
import type {
  StudioAssetItem,
  StoryboardLayout,
  StoryboardSlide,
} from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioStoryboardPanelProps {
  lang: Language;
  projectTitle: string;
  slides: StoryboardSlide[];
  savedAssets: StudioAssetItem[];
  busyAction: string | null;
  onUpdateSlides: (slides: StoryboardSlide[]) => void;
  onCaptureCurrentSlide: () => Promise<void>;
  onAutoGenerateCaptions: () => Promise<void>;
  onSaveStoryboardAsset: (dataUrl: string, title: string) => void;
}

export const StudioStoryboardPanel: React.FC<StudioStoryboardPanelProps> = ({
  lang,
  projectTitle,
  slides,
  savedAssets,
  busyAction,
  onUpdateSlides,
  onCaptureCurrentSlide,
  onAutoGenerateCaptions,
  onSaveStoryboardAsset,
}) => {
  const [layout, setLayout] = useState<StoryboardLayout>('grid_2x2');
  const [sheetTitle, setSheetTitle] = useState(
    projectTitle ||
      (lang === 'ar' ? 'كتالوج منتج — الشمس كرافت' : 'Product Storyboard — Al-Shams Craft')
  );
  const [brandSubtitle, setBrandSubtitle] = useState(
    lang === 'ar'
      ? 'استوديو الشمساوية · صناعة يدوية مصرية أصيلة'
      : 'Al-Shamsawya Studio · Authentic Handmade Craft'
  );
  const [renderingSheet, setRenderingSheet] = useState(false);
  const [renderedSheetUrl, setRenderedSheetUrl] = useState<string>('');

  const handleUploadSlideImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const next: StoryboardSlide = {
          id: `slide_${Date.now()}`,
          title:
            file.name.replace(/\.[^.]+$/, '').slice(0, 36) ||
            (lang === 'ar' ? 'لقطة منتج' : 'Product Shot'),
          caption:
            lang === 'ar'
              ? 'تفاصيل يدوية دقيقة وخامات طبيعية 100%'
              : 'Handmade craftsmanship & natural organic fibers',
          imageUrl: reader.result,
        };
        onUpdateSlides([...slides, next]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAddFromSavedAsset = (asset: StudioAssetItem) => {
    const next: StoryboardSlide = {
      id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      title: asset.title.slice(0, 36),
      caption:
        lang === 'ar'
          ? 'لقطة محفوظة من استوديو الشمساوية'
          : 'Saved shot from Al-Shamsawya Studio',
      imageUrl: asset.dataUrl,
    };
    onUpdateSlides([...slides, next]);
  };

  const handleBuildSheet = async () => {
    if (slides.length === 0) return;
    setRenderingSheet(true);
    try {
      const pngDataUrl = await renderStoryboardSheet({
        title: sheetTitle,
        brandSubtitle,
        slides,
        layout,
      });
      setRenderedSheetUrl(pngDataUrl);
      if (pngDataUrl) {
        onSaveStoryboardAsset(
          pngDataUrl,
          lang === 'ar' ? `ستوري بورد: ${sheetTitle}` : `Storyboard: ${sheetTitle}`
        );
      }
    } finally {
      setRenderingSheet(false);
    }
  };

  const handleDownloadPrintableHtmlPdf = () => {
    const targetImg = renderedSheetUrl || slides[0]?.imageUrl;
    if (!targetImg) return;
    const safeTitle = sheetTitle.replace(/[<>&"]/g, '');
    const html = `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: auto; margin: 12mm; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #fff; color: #171614; text-align: center; }
  img { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid #e2ddd3; }
  .note { font-size: 12px; color: #6b655d; margin-top: 12px; }
</style>
</head>
<body onload="window.print()">
  <img src="${targetImg}" alt="${safeTitle}" />
  <div class="note">Al-Shamsawya Studio · الشمس كرافت × Taygos APIs</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storyboard-${Date.now()}-print.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const imageAssets = savedAssets.filter((a) => a.kind !== 'video');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-900">
          {lang === 'ar'
            ? 'صانع الستوري بورد وكتالوج السوشيال'
            : 'Storyboard & Catalog Builder'}
        </h3>
        <div className="grid grid-cols-1 gap-2">
          <input
            type="text"
            value={sheetTitle}
            onChange={(e) => setSheetTitle(e.target.value)}
            placeholder={
              lang === 'ar' ? 'عنوان الكتالوج أو القصة...' : 'Storyboard title...'
            }
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
          />
          <input
            type="text"
            value={brandSubtitle}
            onChange={(e) => setBrandSubtitle(e.target.value)}
            placeholder={
              lang === 'ar' ? 'السطر التعريفي...' : 'Brand subtitle...'
            }
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
          />
        </div>
      </div>

      {/* Capture & Add Slides */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void onCaptureCurrentSlide()}
          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] rounded-lg whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{lang === 'ar' ? 'التقاط اللقطة الحالية' : 'Capture Stage'}</span>
        </button>

        <label className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap">
          <ImagePlus className="w-3.5 h-3.5 text-[#B47B2B]" />
          <span>{lang === 'ar' ? 'رفع شريحة' : 'Upload Slide'}</span>
          <input
            type="file"
            accept="image/*"
            onChange={handleUploadSlideImage}
            className="hidden"
          />
        </label>
      </div>

      {imageAssets.length > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] font-medium text-slate-600">
            {lang === 'ar' ? 'إضافة من أصول المشروع:' : 'Add from saved assets:'}
          </span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {imageAssets.slice(0, 8).map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => handleAddFromSavedAsset(asset)}
                title={asset.title}
                className="w-12 h-12 rounded-md border border-slate-200 overflow-hidden shrink-0 hover:border-[#0F5C54]"
              >
                <img
                  src={asset.dataUrl}
                  alt={asset.title}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Slides Editor */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700">
            {lang === 'ar' ? `الشرائح (${slides.length})` : `Slides (${slides.length})`}
          </span>
          {slides.length > 0 && (
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => void onAutoGenerateCaptions()}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F5C54] hover:underline disabled:opacity-50"
            >
              {busyAction === 'storyboard_captions' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span>
                {lang === 'ar' ? 'كتابة نصوص الشرائح بالـ AI' : 'AI Marketing Copy'}
              </span>
            </button>
          )}
        </div>

        {slides.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
            {lang === 'ar'
              ? 'التقط لقطة المنتج الحالية أو أضف صوراً لبناء الستوري بورد.'
              : 'Capture the current canvas or upload slides to compose your board.'}
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
            {slides.map((sl, idx) => (
              <div
                key={sl.id}
                className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200 bg-white"
              >
                <img
                  src={sl.imageUrl}
                  alt={sl.title}
                  className="w-14 h-14 rounded object-cover border border-slate-100 shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <input
                    type="text"
                    value={sl.title}
                    onChange={(e) =>
                      onUpdateSlides(
                        slides.map((item) =>
                          item.id === sl.id ? { ...item, title: e.target.value } : item
                        )
                      )
                    }
                    placeholder={
                      lang === 'ar' ? `عنوان اللقطة ${idx + 1}` : `Slide ${idx + 1} title`
                    }
                    className="w-full px-2 py-1 text-xs font-semibold border border-slate-200 rounded focus:outline-none focus:border-[#0F5C54]"
                  />
                  <input
                    type="text"
                    value={sl.caption}
                    onChange={(e) =>
                      onUpdateSlides(
                        slides.map((item) =>
                          item.id === sl.id ? { ...item, caption: e.target.value } : item
                        )
                      )
                    }
                    placeholder={lang === 'ar' ? 'وصف تسويقي مختصر...' : 'Caption...'}
                    className="w-full px-2 py-1 text-[11px] text-slate-600 border border-slate-200 rounded focus:outline-none focus:border-[#0F5C54]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSlides(slides.filter((item) => item.id !== sl.id))
                  }
                  className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                  title={lang === 'ar' ? 'حذف الشريحة' : 'Remove Slide'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Layout + Build */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
          <LayoutGrid className="w-3.5 h-3.5 text-[#0F5C54]" />
          <span>{lang === 'ar' ? 'تخطيط اللوحة' : 'Board Layout'}</span>
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { id: 'grid_2x2', labelAr: 'شبكة 2×2', labelEn: '2×2 Grid' },
            { id: 'catalog_3x2', labelAr: 'كتالوج 3×2', labelEn: '3×2 Catalog' },
            { id: 'reel_1x4', labelAr: 'ستوري طولي', labelEn: '1×4 Story' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setLayout(opt.id as StoryboardLayout)}
              className={`px-2 py-1.5 text-[11px] font-medium rounded-md border whitespace-nowrap ${
                layout === opt.id
                  ? 'bg-[#0F5C54] text-white border-[#0F5C54]'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              {lang === 'ar' ? opt.labelAr : opt.labelEn}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={slides.length === 0 || renderingSheet}
          onClick={() => void handleBuildSheet()}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-[#171614] hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
        >
          {renderingSheet ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LayoutGrid className="w-4 h-4 text-[#D9A760]" />
          )}
          <span>
            {lang === 'ar' ? 'تجميع وتوليد الستوري بورد' : 'Render Storyboard Sheet'}
          </span>
        </button>
      </div>

      {/* Preview & Export */}
      {renderedSheetUrl && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <img
            src={renderedSheetUrl}
            alt="Storyboard Preview"
            className="w-full rounded-lg border border-slate-200 shadow-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <a
              href={renderedSheetUrl}
              download={`shamsawya-storyboard-${Date.now()}.png`}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'تحميل PNG' : 'Download PNG'}</span>
            </a>
            <button
              type="button"
              onClick={handleDownloadPrintableHtmlPdf}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-[#B47B2B]" />
              <span>{lang === 'ar' ? 'ملف طباعة / PDF' : 'Print / PDF'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
