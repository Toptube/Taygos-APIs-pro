import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { AccessKeyPublicView, Language } from '../types/taygos';
import { CopyButton } from './CopyButton';

interface UserGuideProps {
  lang: Language;
  gatewayEndpointUrl: string;
  keys: AccessKeyPublicView[];
  onGoToTab: (tab: 'keys' | 'providers' | 'playground' | 'docs') => void;
}

export const UserGuide: React.FC<UserGuideProps> = ({
  lang,
  gatewayEndpointUrl,
  keys,
  onGoToTab,
}) => {
  const openaiBaseUrl = gatewayEndpointUrl.replace(/\/gateway$/, '');
  const openaiChatUrl = `${openaiBaseUrl}/chat/completions`;
  const samplePk =
    keys.find((k) => k.status === 'active')?.publicKey ||
    'pk_taygos_live_xxxxxxxx';

  if (lang === 'en') {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Simple Step-by-Step User Guide
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Follow these 4 simple steps to connect any app (like AI chat apps,
            Cursor, or custom backends) to your unified Taygos gateway.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              1. Generate Your Perpetual Key Pair
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Go to Access Keys and create a key for your app. You get a Public
              Key and a Secret Key that never expire. You can click Reveal
              anytime to view and copy both again.
            </p>
            <button
              type="button"
              onClick={() => onGoToTab('keys')}
              className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
            >
              Open Access Keys
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              2. Add Free Provider Keys
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Open Providers to see all 23 free LLM APIs from
              Toptube/Taygos-apis. Click Set Key on Groq, OpenRouter, NVIDIA NIM,
              or Gemini and paste your free key.
            </p>
            <button
              type="button"
              onClick={() => onGoToTab('providers')}
              className="px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Open Providers
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            3. Copy & Paste into Any AI Chat App
          </h2>
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div>
                <div className="text-slate-500">Base URL (OpenAI Compatible)</div>
                <code dir="ltr" className="font-mono text-slate-900">
                  {openaiBaseUrl}
                </code>
              </div>
              <CopyButton text={openaiBaseUrl} label="Copy" />
            </div>

            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div>
                <div className="text-slate-500">Full Chat Completions URL</div>
                <code dir="ltr" className="font-mono text-slate-900">
                  {openaiChatUrl}
                </code>
              </div>
              <CopyButton text={openaiChatUrl} label="Copy" />
            </div>

            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div>
                <div className="text-slate-500">API Key Format</div>
                <code dir="ltr" className="font-mono text-slate-900">
                  {samplePk}:YOUR_SECRET_KEY
                </code>
              </div>
              <CopyButton text={`${samplePk}:YOUR_SECRET_KEY`} label="Copy" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          دليل الاستخدام البسيط (خطوة بخطوة بدون برمجة معقدة)
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          الموضوع كله ببساطة: بتعمل مفتاح واحد هنا، وبتحط جوه البرنامج مفاتيح
          المزودين المجانية، وبعدها أي تطبيق عندك بياخد لينك واحد ومفتاح واحد
          والبرنامج بيبدّل بين المزودين لوحده!
        </p>
      </div>

      {/* Step 1 & 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="text-xs font-semibold text-teal-700">
            الخطوة الأولى — تجهيز مفتاح لتطبيقك
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            خد Public Key و Secret Key دايمين
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            1. افتح صفحة <strong>مفاتيح الوصول</strong> واضغط{' '}
            <strong>إنشاء مفتاح API</strong>.
            <br />
            2. اكتب اسم برنامجك (مثلاً: تطبيق الشمساوية) واضغط توليد.
            <br />
            3. هيطلع لك فوراً مربع فيه المفتاحين، ولو نسيت تحفظهم في أي وقت
            اضغط زر <strong>عرض المفاتيح</strong> قدام المفتاح وهيظهروا تاني
            فوراً.
          </p>
          <button
            type="button"
            onClick={() => onGoToTab('keys')}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            روح لصفحة مفاتيح الوصول
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="text-xs font-semibold text-teal-700">
            الخطوة الثانية — شغّل المزودين المجانيين
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            إزاي تجيب مفاتيح ذكاء اصطناعي مجانية في دقيقة؟
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            1. افتح صفحة <strong>مزودو الخدمة</strong> (فيها الـ 23 مزود من
            GitHub).
            <br />
            2. اضغط على رابط <strong>جلب مفتاح مجاني</strong> قدام Groq أو
            OpenRouter أو Google Gemini (كلهم مجانيين بدون فيزا).
            <br />
            3. انسخ المفتاح اللي هتاخده، واضغط <strong>إضافة مفتاح</strong>{' '}
            جنب المزود هنا واعمله لصق وحفظ.
          </p>
          <button
            type="button"
            onClick={() => onGoToTab('providers')}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
          >
            روح لصفحة مزودي الخدمة
          </button>
        </div>
      </div>

      {/* Copy from here -> Paste there */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          الخطوة الثالثة — خد كوبي من هنا وحط في برنامجك (زي الشمساوية أو Cursor)
        </h2>
        <p className="text-xs text-slate-600">
          لما تيجي تربط أي برنامج شات ذكاء اصطناعي، هيطلب منك حاجتين بس:
          <strong> رابط الخدمة (Base URL)</strong> و<strong>مفتاح الـ API</strong>
          . خدهم كوبي من الخانات دي:
        </p>

        <div className="space-y-3 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 mb-0.5">
                1) خانة Base URL في برنامجك (حط اللينك ده):
              </div>
              <code
                dir="ltr"
                className="font-mono text-slate-900 break-all select-all"
              >
                {openaiBaseUrl}
              </code>
            </div>
            <CopyButton
              text={openaiBaseUrl}
              label="نسخ الرابط"
              copiedLabel="تم النسخ"
              className="bg-white"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 mb-0.5">
                2) أو لو البرنامج بيطلب رابط الشات الكامل (Endpoint URL):
              </div>
              <code
                dir="ltr"
                className="font-mono text-slate-900 break-all select-all"
              >
                {openaiChatUrl}
              </code>
            </div>
            <CopyButton
              text={openaiChatUrl}
              label="نسخ الرابط"
              copiedLabel="تم النسخ"
              className="bg-white"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 mb-0.5">
                3) خانة API Key في برنامجك (اضغط نسخ Bearer pk:sk من صفحة المفاتيح):
              </div>
              <code
                dir="ltr"
                className="font-mono text-slate-900 break-all select-all"
              >
                {samplePk}:YOUR_SECRET_KEY
              </code>
            </div>
            <CopyButton
              text={`${samplePk}:YOUR_SECRET_KEY`}
              label="نسخ الصيغة"
              copiedLabel="تم النسخ"
              className="bg-white"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 mb-0.5">
                4) اسم الموديل (Model Name) اللي تكتبه في برنامجك:
              </div>
              <code dir="ltr" className="font-mono text-slate-900 select-all">
                taygos-unified
              </code>
            </div>
            <CopyButton
              text="taygos-unified"
              label="نسخ الاسم"
              copiedLabel="تم النسخ"
              className="bg-white"
            />
          </div>
        </div>
      </div>

      {/* Quick Free Provider Key Links */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          الخطوة الرابعة — أسرع مواقع تجيب منها مفاتيح مجانية فوراً
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {[
            {
              name: 'Google Gemini (مجاني 500 طلب يومياً)',
              url: 'https://aistudio.google.com/app/apikey',
            },
            {
              name: 'Groq (أسرع رد مجاني بدون فيزا)',
              url: 'https://console.groq.com/keys',
            },
            {
              name: 'OpenRouter (أكثر من 20 موديل مجاني)',
              url: 'https://openrouter.ai/workspaces/default/keys',
            },
            {
              name: 'NVIDIA NIM (82 موديل مجاني بدون فيزا)',
              url: 'https://build.nvidia.com/settings/api-keys',
            },
          ].map((item) => (
            <div
              key={item.url}
              className="flex items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-teal-800 hover:underline truncate"
              >
                <span>{item.name}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              </a>
              <CopyButton text={item.url} compact title="نسخ الرابط" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
