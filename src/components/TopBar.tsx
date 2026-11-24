import React, { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  Globe,
  Home,
  Image as ImageIcon,
  KeyRound,
  LogOut,
  Menu,
  Mic,
  Plus,
  Server,
  Terminal,
  Video,
  X,
} from 'lucide-react';
import type { ImageSpecialty, Language } from '../types/taygos';
import { useT } from '../i18n/translations';

export type WorkspaceTab =
  | 'home'
  | 'keys'
  | 'providers'
  | 'images'
  | 'videos'
  | 'audio'
  | 'documents'
  | 'playground'
  | 'docs'
  | 'guide';

interface TopBarProps {
  lang: Language;
  activeTab: WorkspaceTab;
  imageSpecialty: ImageSpecialty;
  onSelectTab: (tab: WorkspaceTab, imageSpecialty?: ImageSpecialty) => void;
  onNewKeyClick: () => void;
  onToggleLang: () => void;
  onSignOut: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  lang,
  activeTab,
  imageSpecialty,
  onSelectTab,
  onNewKeyClick,
  onToggleLang,
  onSignOut,
}) => {
  const t = useT(lang);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [imagesDropdownOpen, setImagesDropdownOpen] = useState(
    activeTab === 'images'
  );

  // Horizontal Top Bar (desktop only, without User Guide)
  const topNavItems: { id: WorkspaceTab; label: string }[] = [
    { id: 'home', label: t.navHome },
    { id: 'keys', label: t.navKeys },
    { id: 'providers', label: t.navProviders },
    { id: 'images', label: t.navImages },
    { id: 'videos', label: t.navVideos },
    { id: 'audio', label: t.navAudio },
    { id: 'documents', label: lang === 'ar' ? 'PDF' : 'PDF' },
    { id: 'playground', label: t.navPlayground },
  ];

  const imageSubOptions: { id: ImageSpecialty; label: string }[] = [
    { id: 'all', label: lang === 'ar' ? 'كل APIs الصور (موحد)' : 'All Image APIs' },
    {
      id: 'bg_removal',
      label: lang === 'ar' ? 'عزل الصور وتفريغ الخلفيات' : 'BG Removal (RMBG)',
    },
    {
      id: 'bg_edit',
      label: lang === 'ar' ? 'تعديل وإضاءة الخلفية' : 'BG Edit & Relighting',
    },
    {
      id: 'generate',
      label: lang === 'ar' ? 'توليد الصور والخلفيات' : 'Image Generation',
    },
  ];

  const handleDrawerSelect = (
    tab: WorkspaceTab,
    specialty?: ImageSpecialty
  ) => {
    onSelectTab(tab, specialty);
    setDrawerOpen(false);
  };

  return (
    <>
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-3 flex items-center justify-between gap-3">
          {/* Zone 1: 3-line Menu Trigger + PNG Logo & Wordmark */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={lang === 'ar' ? 'فتح القائمة الجانبية' : 'Open menu'}
              className="p-2 -ms-1.5 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('home')}
              className="inline-flex items-center gap-2 text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-teal-600 rounded"
            >
              <img
                src="/assets/aistudio/1793697498664_09da0ce6.png"
                alt="Taygos APIs"
                className="w-7 h-7 object-contain shrink-0"
              />
              <span>{t.brand}</span>
            </button>
          </div>

          {/* Zone 2: Clean Desktop Links */}
          <nav
            aria-label="Primary"
            className="hidden lg:flex items-center gap-4 text-xs xl:text-sm font-medium"
          >
            {topNavItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    onSelectTab(
                      item.id,
                      item.id === 'images' ? 'all' : undefined
                    )
                  }
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    isActive
                      ? 'text-slate-900 border-teal-700'
                      : 'text-slate-500 border-transparent hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary CTA Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onNewKeyClick}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.newKeyCta}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Clean Slide-Over Side Drawer (3-line Menu) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-slate-900/45"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            aria-label={lang === 'ar' ? 'القائمة الجانبية' : 'Navigation drawer'}
            className="w-72 max-w-[85vw] bg-white h-full border-e border-slate-200 shadow-2xl flex flex-col justify-between p-4"
          >
            <div className="space-y-3 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <img
                    src="/assets/aistudio/1793697498664_09da0ce6.png"
                    alt="Taygos APIs"
                    className="w-7 h-7 object-contain shrink-0"
                  />
                  <span className="text-base font-bold text-slate-900">
                    {t.brand}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label={lang === 'ar' ? 'إغلاق القائمة' : 'Close menu'}
                  className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <nav className="space-y-1">
                {/* Home */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('home')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'home'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <Home className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navHome}</span>
                </button>

                {/* My Apps */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('keys')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'keys'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navKeys}</span>
                </button>

                {/* User Guide */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('guide')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'guide'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <BookOpen className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navGuide}</span>
                </button>

                <div className="my-2 border-t border-slate-100" />

                {/* Chat / LLM Providers */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('providers')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'providers'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <Server className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navProviders}</span>
                </button>

                {/* Expandable Dropdown for Images (All / BG Removal / BG Edit / Generate) */}
                <div>
                  <button
                    type="button"
                    onClick={() => setImagesDropdownOpen((o) => !o)}
                    aria-expanded={imagesDropdownOpen}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      activeTab === 'images'
                        ? 'bg-teal-50 text-teal-800 border border-teal-200'
                        : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <ImageIcon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t.navImages}</span>
                    </span>
                    {imagesDropdownOpen ? (
                      <ChevronUp className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    )}
                  </button>

                  {imagesDropdownOpen && (
                    <div className="mt-1 ms-4 ps-3 border-s border-slate-200 space-y-1">
                      {imageSubOptions.map((sub) => {
                        const subActive =
                          activeTab === 'images' && imageSpecialty === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => handleDrawerSelect('images', sub.id)}
                            className={`w-full text-start px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              subActive
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Video */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('videos')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'videos'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <Video className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navVideos}</span>
                </button>

                {/* Audio */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('audio')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'audio'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <Mic className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navAudio}</span>
                </button>

                {/* PDF & Documents */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('documents')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'documents'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navDocuments}</span>
                </button>

                <div className="my-2 border-t border-slate-100" />

                {/* Playground */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('playground')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'playground'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <Terminal className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navPlayground}</span>
                </button>

                {/* Docs & Logs */}
                <button
                  type="button"
                  onClick={() => handleDrawerSelect('docs')}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'docs'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <Code2 className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.navDocs}</span>
                </button>
              </nav>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <button
                type="button"
                onClick={() => {
                  onToggleLang();
                  setDrawerOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                <Globe className="w-4 h-4 text-slate-500 shrink-0" />
                <span>{lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  onSignOut();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50/70 hover:bg-red-50 border border-red-200 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>{t.signOut}</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
