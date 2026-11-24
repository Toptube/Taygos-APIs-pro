import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Globe, LogOut } from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { CopyButton } from './components/CopyButton';
import { DocsAndLogs } from './components/DocsAndLogs';
import { GatewayPlayground } from './components/GatewayPlayground';
import { HomeDashboard } from './components/HomeDashboard';
import { KeysManager } from './components/KeysManager';
import { ProvidersManager } from './components/ProvidersManager';
import { TopBar, type WorkspaceTab } from './components/TopBar';
import { UserGuide } from './components/UserGuide';
import { useT } from './i18n/translations';
import {
  deleteCloudAccessKey,
  deleteCloudProvider,
  loadCloudVaultSnapshot,
  saveCloudProvider,
  saveCloudRouting,
  saveNewCloudAccessKey,
  updateCloudAccessKeyMeta,
  updateCloudAccessKeySecret,
} from './lib/cloudVault';
import { auth, signOutFirebase } from './lib/firebase';
import type {
  AccessKeyPublicView,
  AuthStatusResponse,
  CreatedKeySecretResponse,
  GatewayOverviewResponse,
  ImageSpecialty,
  Language,
  ProviderAdapter,
  ProviderCategory,
  RevealKeyResponse,
  RoutingConfig,
  SimulatorBehavior,
  UpstreamProviderPublicView,
} from './types/taygos';

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [overview, setOverview] = useState<GatewayOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home');
  const [imageSpecialty, setImageSpecialty] = useState<ImageSpecialty>('all');
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const syncedUidRef = useRef<string | null>(null);

  // Ephemeral playground credentials in memory only
  const [playgroundPk, setPlaygroundPk] = useState('');
  const [playgroundSk, setPlaygroundSk] = useState('');

  const t = useT(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab, imageSpecialty]);

  const handleNavigate = (tab: WorkspaceTab, nextSpecialty?: ImageSpecialty) => {
    setActiveTab(tab);
    if (nextSpecialty) {
      setImageSpecialty(nextSpecialty);
    } else if (tab === 'images' && activeTab !== 'images') {
      setImageSpecialty('all');
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const getBearerToken = useCallback(async (): Promise<string | null> => {
    if (auth.currentUser) {
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        return adminToken;
      }
    }
    return adminToken;
  }, [adminToken]);

  const fetchAuthStatus = useCallback(async (token?: string | null) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/auth/status', { headers });
      const data = (await res.json()) as AuthStatusResponse;
      setAuthStatus(data);
      if (!data.authenticated && token && !auth.currentUser) {
        setAdminToken(null);
      }
    } catch {
      setAuthStatus({
        requiresSetup: false,
        envPasscodeActive: false,
        authenticated: false,
        firebaseEnabled: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOverview = useCallback(
    async (tokenOverride?: string | null) => {
      const token = tokenOverride ?? (await getBearerToken());
      if (!token) return;
      try {
        const res = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          if (!auth.currentUser) {
            setAdminToken(null);
            await fetchAuthStatus(null);
          }
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as GatewayOverviewResponse;
          setOverview(data);
        }
      } catch {
        // Ignore transient network errors
      }
    },
    [fetchAuthStatus, getBearerToken]
  );

  // Listen for Firebase Auth state (persists automatically across page refresh)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const idToken = await user.getIdToken();
          setAdminToken(idToken);
          await fetchAuthStatus(idToken);

          if (syncedUidRef.current !== user.uid) {
            syncedUidRef.current = user.uid;
            const snapshot = await loadCloudVaultSnapshot(user.uid);
            if (
              snapshot.accessKeys.length > 0 ||
              snapshot.providers.length > 0 ||
              snapshot.routing
            ) {
              await fetch('/api/admin/cloud/sync', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify(snapshot),
              });
            }
          }
          await fetchOverview(idToken);
        } catch (err) {
          console.error('Cloud vault sync error:', err);
        }
      } else {
        syncedUidRef.current = null;
      }
      setAuthResolved(true);
    });
    return () => unsubscribe();
  }, [fetchAuthStatus, fetchOverview]);

  useEffect(() => {
    if (!authResolved) return;
    if (!firebaseUser) {
      void fetchAuthStatus(adminToken);
    }
  }, [authResolved, firebaseUser, fetchAuthStatus, adminToken]);

  useEffect(() => {
    if (adminToken && !firebaseUser) {
      void fetchOverview(adminToken);
    }
  }, [adminToken, firebaseUser, fetchOverview]);

  const handleAuthenticated = (token: string) => {
    setAdminToken(token);
  };

  const handleSignOut = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' }).catch(() => {});
    if (auth.currentUser) {
      await signOutFirebase().catch(() => {});
    }
    syncedUidRef.current = null;
    setFirebaseUser(null);
    setAdminToken(null);
    setOverview(null);
    setPlaygroundSk('');
    await fetchAuthStatus(null);
  };

  const handleCreateKey = async (input: {
    name: string;
    description: string;
    requireHmac: boolean;
  }): Promise<CreatedKeySecretResponse | null> => {
    const token = await getBearerToken();
    if (!token) return null;
    const res = await fetch('/api/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const created = (await res.json()) as CreatedKeySecretResponse;
    if (auth.currentUser) {
      await saveNewCloudAccessKey(auth.currentUser.uid, created.key, created.secretKey);
    }
    await fetchOverview(token);
    return created;
  };

  const handleRevealKey = async (
    keyId: string
  ): Promise<RevealKeyResponse | null> => {
    const token = await getBearerToken();
    if (!token) return null;
    const res = await fetch(`/api/admin/keys/${keyId}/reveal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as RevealKeyResponse;
  };

  const handleToggleKeyStatus = async (key: AccessKeyPublicView) => {
    const token = await getBearerToken();
    if (!token) return;
    const nextStatus = key.status === 'active' ? 'revoked' : 'active';
    await fetch(`/api/admin/keys/${key.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        status: nextStatus,
      }),
    });
    if (auth.currentUser) {
      await updateCloudAccessKeyMeta(auth.currentUser.uid, key.id, { status: nextStatus });
    }
    await fetchOverview(token);
  };

  const handleUpdateKeyMeta = async (
    keyId: string,
    patch: { name?: string; description?: string }
  ) => {
    const token = await getBearerToken();
    if (!token) return;
    await fetch(`/api/admin/keys/${keyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (auth.currentUser) {
      await updateCloudAccessKeyMeta(auth.currentUser.uid, keyId, patch);
    }
    await fetchOverview(token);
  };

  const handleRotateKey = async (
    keyId: string
  ): Promise<CreatedKeySecretResponse | null> => {
    const token = await getBearerToken();
    if (!token) return null;
    const res = await fetch(`/api/admin/keys/${keyId}/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const rotated = (await res.json()) as CreatedKeySecretResponse;
    if (auth.currentUser) {
      await updateCloudAccessKeySecret(auth.currentUser.uid, rotated.key, rotated.secretKey);
    }
    await fetchOverview(token);
    return rotated;
  };

  const handleDeleteKey = async (keyId: string) => {
    const token = await getBearerToken();
    if (!token) return;
    await fetch(`/api/admin/keys/${keyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (auth.currentUser) {
      await deleteCloudAccessKey(auth.currentUser.uid, keyId);
    }
    await fetchOverview(token);
  };

  const handleAddProvider = async (input: {
    name: string;
    category?: ProviderCategory;
    adapter: ProviderAdapter;
    baseUrl: string;
    model: string;
    authHeader: string;
    apiKey: string;
    usesServerEnv: boolean;
    priority: number;
    timeoutMs: number;
  }): Promise<boolean> => {
    const token = await getBearerToken();
    if (!token) return false;
    const res = await fetch('/api/admin/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Failed to add provider.');
    }
    const created = (await res.json()) as { provider?: UpstreamProviderPublicView };
    if (auth.currentUser && created.provider) {
      await saveCloudProvider(auth.currentUser.uid, created.provider, input.apiKey);
    }
    await fetchOverview(token);
    return true;
  };

  const handleBulkImportProviders = async (
    items: Array<Record<string, unknown>>
  ): Promise<{ createdCount: number; errorCount: number }> => {
    const token = await getBearerToken();
    if (!token) return { createdCount: 0, errorCount: items.length };
    const res = await fetch('/api/admin/providers/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ providers: items }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Bulk import failed.');
    }
    const result = (await res.json()) as {
      createdCount: number;
      errorCount: number;
      providers?: UpstreamProviderPublicView[];
    };
    if (auth.currentUser && Array.isArray(result.providers)) {
      for (const prov of result.providers) {
        const matchedInput = items.find(
          (item) => typeof item?.name === 'string' && item.name.trim() === prov.name
        );
        const plainKey =
          typeof matchedInput?.apiKey === 'string' ? matchedInput.apiKey : '';
        await saveCloudProvider(auth.currentUser.uid, prov, plainKey);
      }
    }
    await fetchOverview(token);
    return { createdCount: result.createdCount, errorCount: result.errorCount };
  };

  const handleImportFromUrl = async (url: string) => {
    const token = await getBearerToken();
    if (!token) {
      return {
        sourceUrl: url,
        discoveredCount: 0,
        createdCount: 0,
        skippedCount: 0,
      };
    }
    const res = await fetch('/api/admin/providers/import-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as {
      error?: string;
      sourceUrl?: string;
      discoveredCount?: number;
      createdCount?: number;
      skippedCount?: number;
      providers?: UpstreamProviderPublicView[];
    };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to import from URL.');
    }
    if (auth.currentUser && Array.isArray(data.providers)) {
      for (const prov of data.providers) {
        await saveCloudProvider(auth.currentUser.uid, prov, '');
      }
    }
    await fetchOverview(token);
    return {
      sourceUrl: data.sourceUrl || url,
      discoveredCount: data.discoveredCount ?? 0,
      createdCount: data.createdCount ?? 0,
      skippedCount: data.skippedCount ?? 0,
    };
  };

  const handleUpdateProvider = async (
    id: string,
    patch: {
      enabled?: boolean;
      priority?: number;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      usesServerEnv?: boolean;
      simulatorBehavior?: SimulatorBehavior;
      resetCircuit?: boolean;
    }
  ) => {
    const token = await getBearerToken();
    if (!token) return;
    const res = await fetch(`/api/admin/providers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (res.ok && auth.currentUser) {
      const updated = (await res.json()) as { provider?: UpstreamProviderPublicView };
      if (updated.provider) {
        await saveCloudProvider(
          auth.currentUser.uid,
          updated.provider,
          typeof patch.apiKey === 'string' ? patch.apiKey : undefined
        );
      }
    }
    await fetchOverview(token);
  };

  const handleProbeProvider = async (id: string) => {
    const token = await getBearerToken();
    if (!token) return null;
    const res = await fetch(`/api/admin/providers/${id}/probe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      probe: { ok: boolean; statusCode: number; latencyMs: number; message: string };
    };
    await fetchOverview(token);
    return json.probe;
  };

  const handleProbeAllProviders = async () => {
    const token = await getBearerToken();
    if (!token) return null;
    const res = await fetch('/api/admin/providers/probe-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      checkedCount: number;
      operationalCount: number;
    };
    await fetchOverview(token);
    return json;
  };

  const handleDeleteProvider = async (id: string) => {
    const token = await getBearerToken();
    if (!token) return;
    await fetch(`/api/admin/providers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (auth.currentUser) {
      await deleteCloudProvider(auth.currentUser.uid, id);
    }
    await fetchOverview(token);
  };

  const handleSaveRouting = async (
    next: Partial<RoutingConfig>
  ): Promise<boolean> => {
    const token = await getBearerToken();
    if (!token) return false;
    const res = await fetch('/api/admin/routing', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(next),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { routing?: RoutingConfig };
    if (auth.currentUser && data.routing) {
      await saveCloudRouting(auth.currentUser.uid, data.routing);
    }
    await fetchOverview(token);
    return true;
  };

  const handleClearLogs = async () => {
    const token = await getBearerToken();
    if (!token) return;
    await fetch('/api/admin/logs', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchOverview(token);
  };

  if (loading || !authStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!adminToken) {
    return (
      <AuthGate
        lang={lang}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        authStatus={authStatus}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const gatewayUrl = overview?.gatewayEndpointUrl ?? '/api/v1/gateway';
  const openaiChatUrl = gatewayUrl.replace(/\/gateway$/, '/chat/completions');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col overflow-x-hidden">
      <TopBar
        lang={lang}
        activeTab={activeTab}
        imageSpecialty={imageSpecialty}
        onSelectTab={handleNavigate}
        onNewKeyClick={() => {
          handleNavigate('keys');
          setIsCreateKeyOpen(true);
        }}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        onSignOut={handleSignOut}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-5 space-y-5">
        {/* Compact Single-Strip Utility & KPI Bar (Shown on inner tabs so Home stays direct & top-focused) */}
        {activeTab !== 'home' && (
          <div className="bg-white border border-slate-200 rounded-xl px-3.5 sm:px-4 py-3 space-y-2.5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 sm:gap-4 min-w-0 text-xs">
              <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                <span className="font-medium text-slate-500 whitespace-nowrap shrink-0">
                  Gateway:
                </span>
                <code
                  dir="ltr"
                  className="font-mono text-slate-900 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded truncate min-w-0 flex-1 sm:flex-initial sm:max-w-[260px]"
                >
                  {gatewayUrl}
                </code>
                <CopyButton
                  text={gatewayUrl}
                  label={t.copy}
                  copiedLabel={t.copied}
                />
              </div>

              <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                <span className="font-medium text-slate-500 whitespace-nowrap shrink-0">
                  AI Chat:
                </span>
                <code
                  dir="ltr"
                  className="font-mono text-slate-900 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded truncate min-w-0 flex-1 sm:flex-initial sm:max-w-[260px]"
                >
                  {openaiChatUrl}
                </code>
                <CopyButton
                  text={openaiChatUrl}
                  label={t.copy}
                  copiedLabel={t.copied}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.signOut}</span>
              </button>
            </div>
          </div>

          {overview && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-4 tabular-nums">
                <span>
                  {t.kpiActiveKeys}:{' '}
                  <strong className="font-mono text-slate-900">
                    {overview.stats.activeKeys}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {lang === 'ar' ? 'المزودون الجاهزون' : 'Ready Providers'}:{' '}
                  <strong className="font-mono text-slate-900">
                    {overview.stats.configuredProviders} /{' '}
                    {overview.stats.totalProviders}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {lang === 'ar' ? 'الموديلات بالكتالوج' : 'Catalog Models'}:{' '}
                  <strong className="font-mono text-slate-900">
                    {overview.stats.totalFreeModels}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t.kpiTotalRequests}:{' '}
                  <strong className="font-mono text-slate-900">
                    {overview.stats.totalRequests}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t.kpiFailovers}:{' '}
                  <strong className="font-mono text-teal-700">
                    {overview.stats.failoverRecoveries}
                  </strong>
                </span>
              </div>

              <div
                dir="ltr"
                className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-500 font-mono"
              >
                <span>
                  Admin:{' '}
                  <strong className="text-slate-800">
                    {authStatus.envPasscodeActive ? 'Env Active' : 'Claimed'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Vault:{' '}
                  <strong className="text-slate-800">
                    {firebaseUser
                      ? 'Firebase Cloud'
                      : overview.hasMasterEncryptionKey
                        ? 'Active'
                        : 'Session'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Gemini:{' '}
                  <strong className="text-slate-800">
                    {overview.hasGeminiEnvKey ? 'Active' : 'Unset'}
                  </strong>
                </span>
              </div>
            </div>
          )}
          </div>
        )}

        {/* Active Standalone Page View */}
        {!overview ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            Loading workspace...
          </div>
        ) : activeTab === 'home' ? (
          <HomeDashboard
            lang={lang}
            gatewayEndpointUrl={overview.gatewayEndpointUrl}
            keys={overview.keys}
            providers={overview.providers}
            onCreateKey={handleCreateKey}
            onProbeAllProviders={handleProbeAllProviders}
            onNavigate={handleNavigate}
          />
        ) : activeTab === 'keys' ? (
          <KeysManager
            lang={lang}
            gatewayEndpointUrl={overview.gatewayEndpointUrl}
            keys={overview.keys}
            isCreateModalOpen={isCreateKeyOpen}
            onOpenCreateModal={() => setIsCreateKeyOpen(true)}
            onCloseCreateModal={() => setIsCreateKeyOpen(false)}
            onCreateKey={handleCreateKey}
            onUpdateKeyMeta={handleUpdateKeyMeta}
            onRevealKey={handleRevealKey}
            onToggleKeyStatus={handleToggleKeyStatus}
            onRotateKey={handleRotateKey}
            onDeleteKey={handleDeleteKey}
            onLoadInPlayground={(pk, sk) => {
              setPlaygroundPk(pk);
              setPlaygroundSk(sk);
              handleNavigate('playground');
            }}
          />
        ) : activeTab === 'providers' ||
          activeTab === 'images' ||
          activeTab === 'videos' ||
          activeTab === 'audio' ||
          activeTab === 'documents' ? (
          <ProvidersManager
            lang={lang}
            activeCategory={
              activeTab === 'images'
                ? 'image'
                : activeTab === 'videos'
                  ? 'video'
                  : activeTab === 'audio'
                    ? 'audio'
                    : activeTab === 'documents'
                      ? 'documents'
                      : 'llm'
            }
            imageSpecialty={imageSpecialty}
            onChangeImageSpecialty={setImageSpecialty}
            gatewayEndpointUrl={overview.gatewayEndpointUrl}
            providers={overview.providers}
            routing={overview.routing}
            hasGeminiEnvKey={overview.hasGeminiEnvKey}
            onAddProvider={handleAddProvider}
            onBulkImportProviders={handleBulkImportProviders}
            onImportFromUrl={handleImportFromUrl}
            onUpdateProvider={handleUpdateProvider}
            onProbeProvider={handleProbeProvider}
            onProbeAllProviders={handleProbeAllProviders}
            onDeleteProvider={handleDeleteProvider}
            onSaveRouting={handleSaveRouting}
          />
        ) : activeTab === 'playground' ? (
          <GatewayPlayground
            lang={lang}
            keys={overview.keys}
            gatewayEndpointUrl={overview.gatewayEndpointUrl}
            initialPublicKey={playgroundPk}
            initialSecretKey={playgroundSk}
            onRequestCompleted={() => {
              if (adminToken) void fetchOverview(adminToken);
            }}
          />
        ) : activeTab === 'docs' ? (
          <DocsAndLogs
            lang={lang}
            gatewayEndpointUrl={overview.gatewayEndpointUrl}
            keys={overview.keys}
            logs={overview.logs}
            onClearLogs={handleClearLogs}
          />
        ) : (
          <UserGuide
            lang={lang}
            gatewayEndpointUrl={overview.gatewayEndpointUrl}
            keys={overview.keys}
            onGoToTab={(tab) => handleNavigate(tab)}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-center sm:justify-between text-xs text-slate-500">
          <span>Taygos APIs · Unified Gateway &amp; Perpetual Key Control</span>
          <span className="hidden sm:inline text-slate-400">
            Text · Image · Video · Audio · PDF Auto-Failover
          </span>
        </div>
      </footer>
    </div>
  );
}
