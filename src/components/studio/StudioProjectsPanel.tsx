import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  FolderOpen,
  Link2,
  Loader2,
  LogIn,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import { auth, signInWithGooglePopup } from '../../lib/firebase';
import { CopyButton } from '../CopyButton';
import type {
  CascadeTraceLog,
  StudioAssetItem,
  StudioProjectRecord,
} from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioProjectsPanelProps {
  lang: Language;
  projectId: string;
  projectTitle: string;
  craftType: StudioProjectRecord['craftType'];
  savedProjects: StudioProjectRecord[];
  savedAssets: StudioAssetItem[];
  cascadeLogs: CascadeTraceLog[];
  savingProject: boolean;
  onChangeTitle: (title: string) => void;
  onChangeCraftType: (craft: StudioProjectRecord['craftType']) => void;
  onSaveProject: () => Promise<void>;
  onLoadProject: (proj: StudioProjectRecord) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onLoadAssetIntoCanvas: (asset: StudioAssetItem) => Promise<void>;
  onSendExportToParent: () => void;
}

export const StudioProjectsPanel: React.FC<StudioProjectsPanelProps> = ({
  lang,
  projectId,
  projectTitle,
  craftType,
  savedProjects,
  savedAssets,
  cascadeLogs,
  savingProject,
  onChangeTitle,
  onChangeCraftType,
  onSaveProject,
  onLoadProject,
  onDeleteProject,
  onLoadAssetIntoCanvas,
  onSendExportToParent,
}) => {
  const [subTab, setSubTab] = useState<'projects' | 'cascade' | 'integration'>(
    'projects'
  );
  const [cloudEmail, setCloudEmail] = useState<string | null>(
    auth.currentUser?.email ?? null
  );
  const [signingInCloud, setSigningInCloud] = useState(false);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://taygos-studio.app';
  const shortStudioUrl = `${origin}/s`;
  const directStudioUrl = `${origin}/studio`;
  const embedStudioUrl = `${origin}/studio?embed=1`;
  const iframeSnippet = `<iframe src="${embedStudioUrl}" width="100%" height="840" style="border:0;border-radius:12px;" allow="clipboard-write"></iframe>`;

  const handleCloudGoogleSignIn = async () => {
    setSigningInCloud(true);
    try {
      const user = await signInWithGooglePopup();
      setCloudEmail(user.email || null);
    } catch {
      // User closed popup or network interrupted
    } finally {
      setSigningInCloud(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-lg">
        {[
          { id: 'projects', labelAr: 'المشاريع', labelEn: 'Projects' },
          { id: 'cascade', labelAr: 'سجل الـ APIs', labelEn: 'API Trace' },
          { id: 'integration', labelAr: 'الروابط والربط', labelEn: 'Share & Embed' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() =>
              setSubTab(tab.id as 'projects' | 'cascade' | 'integration')
            }
            className={`px-2 py-1.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
              subTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar' ? tab.labelAr : tab.labelEn}
          </button>
        ))}
      </div>

      {subTab === 'projects' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900">
              {lang === 'ar'
                ? 'حفظ المشروع الحالي (محلياً + سحابياً)'
                : 'Save Project (Local + Cloud)'}
            </h3>
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder={lang === 'ar' ? 'اسم مشروع المنتج...' : 'Project name...'}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0F5C54]"
            />
            <select
              value={craftType}
              onChange={(e) =>
                onChangeCraftType(
                  e.target.value as StudioProjectRecord['craftType']
                )
              }
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="macrame">
                {lang === 'ar' ? 'مكرمية وخيوط قطن' : 'Macrame & Cotton Cord'}
              </option>
              <option value="burlap">
                {lang === 'ar' ? 'خيش وتفاصيل ريفية' : 'Burlap & Jute'}
              </option>
              <option value="bags">
                {lang === 'ar' ? 'شنط هاند ميد' : 'Handmade Bags'}
              </option>
              <option value="decor">
                {lang === 'ar' ? 'مرايا وقطع ديكورية' : 'Mirrors & Wall Decor'}
              </option>
              <option value="custom">
                {lang === 'ar' ? 'مشروع مخصص' : 'Custom Craft'}
              </option>
            </select>
            <button
              type="button"
              disabled={savingProject}
              onClick={() => void onSaveProject()}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-[#0F5C54] hover:bg-[#0B4740] disabled:opacity-50 rounded-lg whitespace-nowrap"
            >
              {savingProject ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>
                {lang === 'ar'
                  ? 'حفظ المشروع والمزامنة'
                  : 'Save & Sync Project'}
              </span>
            </button>

            {!cloudEmail ? (
              <button
                type="button"
                disabled={signingInCloud}
                onClick={() => void handleCloudGoogleSignIn()}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg"
              >
                <LogIn className="w-3.5 h-3.5 text-[#0F5C54]" />
                <span>
                  {lang === 'ar'
                    ? 'ربط حساب Google للمزامنة السحابية (اختياري)'
                    : 'Optional Google Sign-In for Cloud Sync'}
                </span>
              </button>
            ) : (
              <div className="text-[11px] text-[#0F5C54] px-2 py-1 bg-[#EDF5F4] rounded-md truncate">
                {lang === 'ar' ? `متصل بالسحابة: ${cloudEmail}` : `Cloud Sync: ${cloudEmail}`}
              </div>
            )}
          </div>

          {/* Saved Assets Gallery */}
          {savedAssets.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-100">
              <h4 className="text-[11px] font-bold text-slate-700">
                {lang === 'ar'
                  ? `أصول ومخرجات المشروع (${savedAssets.length})`
                  : `Project Assets (${savedAssets.length})`}
              </h4>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pe-1">
                {savedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white space-y-1.5"
                  >
                    {asset.kind === 'video' ? (
                      <video
                        src={asset.dataUrl}
                        className="w-full h-20 object-cover rounded bg-black"
                        muted
                      />
                    ) : (
                      <img
                        src={asset.dataUrl}
                        alt={asset.title}
                        className="w-full h-20 object-cover rounded bg-slate-50 cursor-pointer"
                        onClick={() => void onLoadAssetIntoCanvas(asset)}
                      />
                    )}
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-medium text-slate-700 truncate">
                        {asset.title}
                      </span>
                      <a
                        href={asset.dataUrl}
                        download={`${asset.title}.${
                          asset.kind === 'video' ? 'mp4' : 'png'
                        }`}
                        className="p-1 text-slate-500 hover:text-[#0F5C54] shrink-0"
                        title={lang === 'ar' ? 'تحميل' : 'Download'}
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saved Projects List */}
          <div className="space-y-2 pt-3 border-t border-slate-100">
            <h4 className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-[#0F5C54]" />
              <span>
                {lang === 'ar'
                  ? `المشاريع المحفوظة (${savedProjects.length})`
                  : `Saved Projects (${savedProjects.length})`}
              </span>
            </h4>
            {savedProjects.length === 0 ? (
              <div className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                {lang === 'ar'
                  ? 'لا توجد مشاريع محفوظة بعد. احفظ مشروعك الأول للرجوع إليه لاحقاً.'
                  : 'No saved projects yet.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pe-1">
                {savedProjects.map((proj) => (
                  <div
                    key={proj.id}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border ${
                      proj.id === projectId
                        ? 'bg-[#F0F7F6] border-[#0F5C54]'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    {proj.thumbnailDataUrl && (
                      <img
                        src={proj.thumbnailDataUrl}
                        alt={proj.title}
                        className="w-11 h-11 rounded object-cover border border-slate-100 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {proj.title}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {proj.dimensions.length}{' '}
                        {lang === 'ar' ? 'أبعاد' : 'dims'} · {proj.assets.length}{' '}
                        {lang === 'ar' ? 'أصول' : 'assets'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void onLoadProject(proj)}
                        className="p-1.5 text-slate-700 hover:text-[#0F5C54] hover:bg-slate-100 rounded"
                        title={lang === 'ar' ? 'فتح المشروع' : 'Open'}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteProject(proj.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title={lang === 'ar' ? 'حذف المشروع' : 'Delete'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'cascade' && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <Activity className="w-4 h-4 text-[#0F5C54]" />
            <span>
              {lang === 'ar'
                ? 'سجل التبديل التلقائي بين الـ APIs'
                : 'Auto-Failover Execution Trace'}
            </span>
          </div>
          {cascadeLogs.length === 0 ? (
            <div className="text-xs text-slate-400 py-5 text-center border border-dashed border-slate-200 rounded-lg">
              {lang === 'ar'
                ? 'جرّب العزل الذكي أو توليد مشهد أو فيديو لعرض تفاصيل المزودين والموديلات المستخدمة تلقائياً.'
                : 'Run AI Cutout, Scene Generation, or Video to view live provider failover telemetry.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pe-1">
              {cascadeLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 inline-flex items-center gap-1">
                      {log.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0F5C54]" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      {log.taskLabel}
                    </span>
                    <span className="font-mono tabular-nums text-[10px] text-slate-500">
                      {log.latencyMs}ms
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    {lang === 'ar' ? 'المزود النشط:' : 'Provider:'}{' '}
                    <strong className="text-slate-900">{log.providerName}</strong> (
                    {log.modelName})
                  </div>
                  {log.attempts.length > 0 && (
                    <div className="text-[10px] text-slate-500 space-y-0.5 pt-1 border-t border-slate-100">
                      {log.attempts.map((att, i) => (
                        <div key={i} className="flex justify-between gap-2">
                          <span className="truncate">
                            {att.providerName}: {att.outcome}
                          </span>
                          <span className="font-mono shrink-0">{att.statusCode}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'integration' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#0F5C54]" />
              <span>
                {lang === 'ar'
                  ? 'مشاركة الاستوديو وربطه مع منظومة الشمساوية'
                  : 'Standalone Share & Embed Links'}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {lang === 'ar'
                ? 'هذا الرابط يفتح استوديو الشمساوية فقط بشكل مستقل ومجاني دون إظهار أي بيانات مفاتيح API، ومهيأ للعمل داخل https://alshamsawiyah.ai.studio/.'
                : 'Share this standalone URL so anyone opens Al-Shamsawya Studio only (zero Taygos API keys visible), ready to embed in https://alshamsawiyah.ai.studio/.'}
            </p>
          </div>

          <div className="space-y-2 p-2.5 rounded-lg border border-[#B8D7D3] bg-[#F3FAF9]">
            <div className="flex items-center justify-between text-[11px] font-bold text-[#0F5C54]">
              <span>
                {lang === 'ar'
                  ? 'الرابط المختصر للمشاركة المباشرة (/s)'
                  : 'Short Shareable Studio Link (/s)'}
              </span>
              <CopyButton
                text={shortStudioUrl}
                label={lang === 'ar' ? 'نسخ' : 'Copy'}
                copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
              />
            </div>
            <code
              dir="ltr"
              className="block text-[11px] font-mono font-semibold text-slate-900 bg-white p-2 rounded border border-[#CFE5E2] break-all"
            >
              {shortStudioUrl}
            </code>
          </div>

          <div className="space-y-2 p-2.5 rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
              <span>
                {lang === 'ar'
                  ? 'رابط الاستوديو الكامل (/studio)'
                  : 'Full Studio Route (/studio)'}
              </span>
              <CopyButton
                text={directStudioUrl}
                label={lang === 'ar' ? 'نسخ' : 'Copy'}
                copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
              />
            </div>
            <code
              dir="ltr"
              className="block text-[10px] font-mono text-slate-800 bg-slate-50 p-2 rounded border border-slate-200 break-all"
            >
              {directStudioUrl}
            </code>
          </div>

          <div className="space-y-2 p-2.5 rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
              <span>
                {lang === 'ar'
                  ? 'رابط التضمين لمنظومة الشمساوية (Embed)'
                  : 'Embed Iframe URL'}
              </span>
              <CopyButton
                text={embedStudioUrl}
                label={lang === 'ar' ? 'نسخ' : 'Copy'}
                copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
              />
            </div>
            <code
              dir="ltr"
              className="block text-[10px] font-mono text-slate-800 bg-slate-50 p-2 rounded border border-slate-200 break-all"
            >
              {embedStudioUrl}
            </code>
          </div>

          <div className="space-y-2 p-2.5 rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
              <span>{lang === 'ar' ? 'كود iframe جاهز' : 'HTML Iframe Snippet'}</span>
              <CopyButton
                text={iframeSnippet}
                label={lang === 'ar' ? 'نسخ' : 'Copy'}
                copiedLabel={lang === 'ar' ? 'تم' : 'Copied'}
              />
            </div>
            <pre
              dir="ltr"
              className="text-[10px] font-mono text-slate-700 bg-slate-50 p-2 rounded border border-slate-200 overflow-x-auto"
            >
              {iframeSnippet}
            </pre>
          </div>

          <button
            type="button"
            onClick={onSendExportToParent}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-[#171614] hover:bg-slate-800 rounded-lg whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#D9A760]" />
            <span>
              {lang === 'ar'
                ? 'إرسال الصورة الحالية إلى منظومة الشمساوية (Bridge)'
                : 'Send Current Composite to Parent App'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
