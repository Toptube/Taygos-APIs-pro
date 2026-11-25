import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type FieldValue,
} from 'firebase/firestore';
import type {
  AccessKeyPublicView,
  ProviderAdapter,
  ProviderCategory,
  RoutingConfig,
  RoutingStrategy,
  UpstreamProviderPublicView,
} from '../types/taygos';
import { db, handleFirestoreError, OperationType } from './firebase';

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_CATEGORIES: ProviderCategory[] = ['llm', 'image', 'video', 'audio', 'documents'];
const VALID_ADAPTERS: ProviderAdapter[] = [
  'gemini',
  'openai-compatible',
  'anthropic',
  'custom-rest',
  'sandbox-simulator',
];
const VALID_STRATEGIES: RoutingStrategy[] = [
  'priority_failover',
  'round_robin',
  'lowest_latency',
];

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  if (cleaned && VALID_ID_RE.test(cleaned)) return cleaned;
  return `${fallbackPrefix}_${Date.now()}`;
}

function clampInt(val: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export interface CloudAccessKeyRecord {
  ownerId: string;
  id: string;
  name: string;
  description: string;
  publicKey: string;
  secretKey: string;
  secretMasked: string;
  perpetual: boolean;
  requireHmac: boolean;
  status: 'active' | 'revoked';
  scopes: string[];
}

export interface CloudProviderRecord {
  ownerId: string;
  id: string;
  slug: string;
  name: string;
  category: ProviderCategory;
  specialty: string;
  adapter: ProviderAdapter;
  baseUrl: string;
  model: string;
  authHeader: string;
  apiKey: string;
  apiKeyMasked: string;
  usesServerEnv: boolean;
  requiresApiKey: boolean;
  priority: number;
  weight: number;
  timeoutMs: number;
  enabled: boolean;
}

export interface CloudVaultSnapshot {
  accessKeys: CloudAccessKeyRecord[];
  providers: CloudProviderRecord[];
  routing: RoutingConfig | null;
}

export async function ensureUserVaultProfile(
  uid: string,
  displayName?: string | null
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const path = `users/${safeUid}`;
  const ref = doc(db, 'users', safeUid);
  const label = (displayName || 'Taygos Workspace').trim().slice(0, 120) || 'Taygos Workspace';

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        ownerId: safeUid,
        displayName: label,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

export async function loadCloudVaultSnapshot(uid: string): Promise<CloudVaultSnapshot> {
  const safeUid = sanitizeId(uid, 'user');
  await ensureUserVaultProfile(safeUid);

  const keysPath = `users/${safeUid}/accessKeys`;
  const providersPath = `users/${safeUid}/providers`;
  const routingPath = `users/${safeUid}/settings/routing`;

  const accessKeys: CloudAccessKeyRecord[] = [];
  const providers: CloudProviderRecord[] = [];
  let routing: RoutingConfig | null = null;

  try {
    const q = query(
      collection(db, 'users', safeUid, 'accessKeys'),
      where('ownerId', '==', safeUid)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (typeof d?.publicKey === 'string' && typeof d?.secretKey === 'string') {
        accessKeys.push({
          ownerId: safeUid,
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          name: typeof d.name === 'string' ? d.name : 'Taygos Key',
          description: typeof d.description === 'string' ? d.description : '',
          publicKey: d.publicKey,
          secretKey: d.secretKey,
          secretMasked: typeof d.secretMasked === 'string' ? d.secretMasked : '••••',
          perpetual: Boolean(d.perpetual ?? true),
          requireHmac: Boolean(d.requireHmac),
          status: d.status === 'revoked' ? 'revoked' : 'active',
          scopes: Array.isArray(d.scopes)
            ? d.scopes.filter((s: unknown): s is string => typeof s === 'string').slice(0, 8)
            : ['gateway:execute'],
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, keysPath);
  }

  try {
    const q = query(
      collection(db, 'users', safeUid, 'providers'),
      where('ownerId', '==', safeUid)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (typeof d?.name === 'string' && typeof d?.baseUrl === 'string') {
        const category = VALID_CATEGORIES.includes(d.category as ProviderCategory)
          ? (d.category as ProviderCategory)
          : 'llm';
        const adapter = VALID_ADAPTERS.includes(d.adapter as ProviderAdapter)
          ? (d.adapter as ProviderAdapter)
          : 'openai-compatible';
        providers.push({
          ownerId: safeUid,
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          slug: typeof d.slug === 'string' ? d.slug : '',
          name: d.name,
          category,
          specialty: typeof d.specialty === 'string' ? d.specialty : '',
          adapter,
          baseUrl: d.baseUrl,
          model: typeof d.model === 'string' ? d.model : 'default',
          authHeader: typeof d.authHeader === 'string' ? d.authHeader : 'Authorization',
          apiKey: typeof d.apiKey === 'string' ? d.apiKey : '',
          apiKeyMasked: typeof d.apiKeyMasked === 'string' ? d.apiKeyMasked : 'not-set',
          usesServerEnv: Boolean(d.usesServerEnv),
          requiresApiKey: d.requiresApiKey !== false,
          priority: clampInt(Number(d.priority), 1, 999, 10),
          weight: clampInt(Number(d.weight), 1, 100, 50),
          timeoutMs: clampInt(Number(d.timeoutMs), 1000, 60000, 12000),
          enabled: d.enabled !== false,
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, providersPath);
  }

  try {
    const snap = await getDoc(doc(db, 'users', safeUid, 'settings', 'routing'));
    if (snap.exists()) {
      const d = snap.data();
      routing = {
        strategy: VALID_STRATEGIES.includes(d.strategy as RoutingStrategy)
          ? (d.strategy as RoutingStrategy)
          : 'priority_failover',
        maxRetries: clampInt(Number(d.maxRetries), 0, 10, 5),
        circuitBreakerThreshold: clampInt(Number(d.circuitBreakerThreshold), 1, 10, 2),
        cooldownSeconds: clampInt(Number(d.cooldownSeconds), 5, 600, 30),
        roundRobinCursor: 0,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, routingPath);
  }

  return { accessKeys, providers, routing };
}

export async function saveNewCloudAccessKey(
  uid: string,
  key: AccessKeyPublicView,
  secretKey: string
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeKeyId = sanitizeId(key.id, 'key');
  const path = `users/${safeUid}/accessKeys/${safeKeyId}`;
  await ensureUserVaultProfile(safeUid);

  const scopes = (Array.isArray(key.scopes) ? key.scopes : ['gateway:execute'])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, 64))
    .slice(0, 8);

  const payload = {
    ownerId: safeUid,
    id: safeKeyId,
    name: key.name.trim().slice(0, 80) || 'Taygos Key',
    description: (key.description || '').trim().slice(0, 200),
    publicKey: key.publicKey.trim().slice(0, 120),
    secretKey: secretKey.trim().slice(0, 160),
    secretMasked: (key.secretMasked || '••••').trim().slice(0, 64),
    perpetual: Boolean(key.perpetual),
    requireHmac: Boolean(key.requireHmac),
    status: key.status === 'revoked' ? 'revoked' : 'active',
    scopes: scopes.length > 0 ? scopes : ['gateway:execute'],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', safeUid, 'accessKeys', safeKeyId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCloudAccessKeyMeta(
  uid: string,
  keyId: string,
  patch: {
    name?: string;
    description?: string;
    status?: 'active' | 'revoked';
    requireHmac?: boolean;
  }
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeKeyId = sanitizeId(keyId, 'key');
  const path = `users/${safeUid}/accessKeys/${safeKeyId}`;
  const ref = doc(db, 'users', safeUid, 'accessKeys', safeKeyId);

  const updatePayload: Record<string, string | boolean | FieldValue> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof patch.name === 'string' && patch.name.trim()) {
    updatePayload.name = patch.name.trim().slice(0, 80);
  }
  if (typeof patch.description === 'string') {
    updatePayload.description = patch.description.trim().slice(0, 200);
  }
  if (patch.status === 'active' || patch.status === 'revoked') {
    updatePayload.status = patch.status;
  }
  if (typeof patch.requireHmac === 'boolean') {
    updatePayload.requireHmac = patch.requireHmac;
  }

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateCloudAccessKeySecret(
  uid: string,
  key: AccessKeyPublicView,
  secretKey: string
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeKeyId = sanitizeId(key.id, 'key');
  const path = `users/${safeUid}/accessKeys/${safeKeyId}`;
  const ref = doc(db, 'users', safeUid, 'accessKeys', safeKeyId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await saveNewCloudAccessKey(safeUid, key, secretKey);
      return;
    }
    await updateDoc(ref, {
      secretKey: secretKey.trim().slice(0, 160),
      secretMasked: (key.secretMasked || '••••').trim().slice(0, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCloudAccessKey(uid: string, keyId: string): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeKeyId = sanitizeId(keyId, 'key');
  const path = `users/${safeUid}/accessKeys/${safeKeyId}`;
  const ref = doc(db, 'users', safeUid, 'accessKeys', safeKeyId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  if (!snap.exists()) return;
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveCloudProvider(
  uid: string,
  provider: UpstreamProviderPublicView,
  apiKeyPlain?: string
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeProvId = sanitizeId(provider.id, 'prov');
  const path = `users/${safeUid}/providers/${safeProvId}`;
  await ensureUserVaultProfile(safeUid);

  const ref = doc(db, 'users', safeUid, 'providers', safeProvId);
  const category: ProviderCategory =
    provider.category && VALID_CATEGORIES.includes(provider.category)
      ? provider.category
      : 'llm';
  const adapter = VALID_ADAPTERS.includes(provider.adapter)
    ? provider.adapter
    : 'openai-compatible';

  let existingSnap;
  try {
    existingSnap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const normalizedKey =
    typeof apiKeyPlain === 'string'
      ? apiKeyPlain.trim().slice(0, 512)
      : existingSnap.exists() && typeof existingSnap.data()?.apiKey === 'string'
        ? existingSnap.data().apiKey
        : '';

  const baseFields = {
    name: provider.name.trim().slice(0, 100) || 'Provider',
    category,
    specialty: (provider.specialty || '').trim().slice(0, 80),
    adapter,
    baseUrl: provider.baseUrl.trim().slice(0, 500) || 'https://example.invalid',
    model: provider.model.trim().slice(0, 120) || 'default',
    authHeader: (provider.authHeader || 'Authorization').trim().slice(0, 60),
    apiKey: provider.usesServerEnv ? '' : normalizedKey,
    apiKeyMasked: (provider.apiKeyMasked || 'not-set').trim().slice(0, 80),
    usesServerEnv: Boolean(provider.usesServerEnv),
    requiresApiKey: provider.requiresApiKey !== false,
    priority: clampInt(provider.priority, 1, 999, 10),
    weight: clampInt(provider.weight, 1, 100, 50),
    timeoutMs: clampInt(provider.timeoutMs, 1000, 60000, 12000),
    enabled: Boolean(provider.enabled),
    updatedAt: serverTimestamp(),
  };

  if (!existingSnap.exists()) {
    try {
      await setDoc(ref, {
        ownerId: safeUid,
        id: safeProvId,
        slug: (provider.slug || '').trim().slice(0, 80),
        ...baseFields,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, baseFields);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteCloudProvider(uid: string, providerId: string): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeProvId = sanitizeId(providerId, 'prov');
  const path = `users/${safeUid}/providers/${safeProvId}`;
  const ref = doc(db, 'users', safeUid, 'providers', safeProvId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  if (!snap.exists()) return;
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveCloudRouting(uid: string, routing: RoutingConfig): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const path = `users/${safeUid}/settings/routing`;
  await ensureUserVaultProfile(safeUid);

  const ref = doc(db, 'users', safeUid, 'settings', 'routing');
  const strategy = VALID_STRATEGIES.includes(routing.strategy)
    ? routing.strategy
    : 'priority_failover';

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const updateFields = {
    strategy,
    maxRetries: clampInt(routing.maxRetries, 0, 10, 5),
    circuitBreakerThreshold: clampInt(routing.circuitBreakerThreshold, 1, 10, 2),
    cooldownSeconds: clampInt(routing.cooldownSeconds, 5, 600, 30),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        ownerId: safeUid,
        ...updateFields,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, updateFields);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export type StudioCraftType = 'macrame' | 'burlap' | 'bags' | 'decor' | 'custom';

export interface CloudStudioProjectMeta {
  ownerId: string;
  id: string;
  title: string;
  craftType: StudioCraftType;
  thumbnailDataUrl: string;
  activePrompt: string;
  assetCount: number;
  dimensionCount: number;
}

const VALID_CRAFT_TYPES: StudioCraftType[] = [
  'macrame',
  'burlap',
  'bags',
  'decor',
  'custom',
];

export async function loadCloudStudioProjects(
  uid: string
): Promise<CloudStudioProjectMeta[]> {
  const safeUid = sanitizeId(uid, 'user');
  await ensureUserVaultProfile(safeUid);
  const path = `users/${safeUid}/studioProjects`;
  const projects: CloudStudioProjectMeta[] = [];

  try {
    const q = query(
      collection(db, 'users', safeUid, 'studioProjects'),
      where('ownerId', '==', safeUid)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (typeof d?.title === 'string') {
        const craftType = VALID_CRAFT_TYPES.includes(d.craftType as StudioCraftType)
          ? (d.craftType as StudioCraftType)
          : 'macrame';
        projects.push({
          ownerId: safeUid,
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          title: d.title,
          craftType,
          thumbnailDataUrl:
            typeof d.thumbnailDataUrl === 'string' ? d.thumbnailDataUrl : '',
          activePrompt: typeof d.activePrompt === 'string' ? d.activePrompt : '',
          assetCount: clampInt(Number(d.assetCount), 0, 200, 0),
          dimensionCount: clampInt(Number(d.dimensionCount), 0, 50, 0),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
  return projects;
}

export async function saveCloudStudioProject(
  uid: string,
  meta: Omit<CloudStudioProjectMeta, 'ownerId'>
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeProjId = sanitizeId(meta.id, 'proj');
  const path = `users/${safeUid}/studioProjects/${safeProjId}`;
  await ensureUserVaultProfile(safeUid);

  const ref = doc(db, 'users', safeUid, 'studioProjects', safeProjId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const craftType = VALID_CRAFT_TYPES.includes(meta.craftType)
    ? meta.craftType
    : 'macrame';

  const mutableFields = {
    title: meta.title.trim().slice(0, 120) || 'مشروع استوديو',
    craftType,
    thumbnailDataUrl: (meta.thumbnailDataUrl || '').slice(0, 350000),
    activePrompt: (meta.activePrompt || '').trim().slice(0, 1000),
    assetCount: clampInt(meta.assetCount, 0, 200, 0),
    dimensionCount: clampInt(meta.dimensionCount, 0, 50, 0),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        ownerId: safeUid,
        id: safeProjId,
        ...mutableFields,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, mutableFields);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteCloudStudioProject(
  uid: string,
  projectId: string
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const safeProjId = sanitizeId(projectId, 'proj');
  const path = `users/${safeUid}/studioProjects/${safeProjId}`;
  const ref = doc(db, 'users', safeUid, 'studioProjects', safeProjId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  if (!snap.exists()) return;
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
