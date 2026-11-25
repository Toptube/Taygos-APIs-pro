import fs from 'node:fs';
import path from 'node:path';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getStore, persistStore } from './store.ts';

interface FirebaseAppletConfig {
  projectId?: string;
}

const DEFAULT_SUPER_ADMIN_EMAILS = [
  'sambasuony@gmail.com',
  'hmb.top.tube@gmail.com',
  'tygosibs@gmail.com',
  'shamscraftagency@gmail.com',
];

let cachedProjectId: string | null = null;
let cachedApp: App | null = null;

function loadProjectId(): string | null {
  if (cachedProjectId !== null) return cachedProjectId || null;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      cachedProjectId = '';
      return null;
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as FirebaseAppletConfig;
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    if (!projectId || projectId === 'remixed-project-id') {
      cachedProjectId = '';
      return null;
    }
    cachedProjectId = projectId;
    return projectId;
  } catch {
    cachedProjectId = '';
    return null;
  }
}

function getFirebaseAdminAuthApp(): App | null {
  if (cachedApp) return cachedApp;
  const projectId = loadProjectId();
  if (!projectId) return null;
  cachedApp = getApps().length ? getApp() : initializeApp({ projectId });
  return cachedApp;
}

function getAllowedAdminEmails(): string[] {
  const fromEnv = (process.env.TAYGOS_ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_SUPER_ADMIN_EMAILS, ...fromEnv]));
}

export function isFirebaseAuthConfigured(): boolean {
  return Boolean(loadProjectId());
}

export async function verifyFirebaseAdminBearer(
  token: string
): Promise<DecodedIdToken | null> {
  if (!token || token.split('.').length !== 3) return null;
  const app = getFirebaseAdminAuthApp();
  if (!app) return null;

  try {
    const decoded = await getAuth(app).verifyIdToken(token);
    if (!decoded || !decoded.uid || decoded.email_verified !== true) {
      return null;
    }

    const userEmail = (decoded.email || '').trim().toLowerCase();
    const allowedEmails = getAllowedAdminEmails();
    if (!userEmail || !allowedEmails.includes(userEmail)) {
      return null;
    }

    const store = getStore();
    if (store.adminOwnerUid !== decoded.uid) {
      store.adminOwnerUid = decoded.uid;
      persistStore();
    }

    return decoded;
  } catch {
    return null;
  }
}
