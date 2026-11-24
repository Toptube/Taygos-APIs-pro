import fs from 'node:fs';
import path from 'node:path';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getStore, persistStore } from './store.ts';

interface FirebaseAppletConfig {
  projectId?: string;
}

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

    const store = getStore();
    const bootstrapEmail = (process.env.TAYGOS_ADMIN_EMAIL || 'sambasuony@gmail.com')
      .trim()
      .toLowerCase();
    const userEmail = (decoded.email || '').trim().toLowerCase();

    if (!store.adminOwnerUid) {
      // Allow bootstrap owner email or first verified owner if none claimed yet
      if (userEmail === bootstrapEmail || !bootstrapEmail) {
        store.adminOwnerUid = decoded.uid;
        persistStore();
      } else {
        // First verified user if different email in fresh preview? Claim only if bootstrap email isn't strictly locked
        store.adminOwnerUid = decoded.uid;
        persistStore();
      }
    }

    const isAllowedOwner =
      decoded.uid === store.adminOwnerUid ||
      (bootstrapEmail && userEmail === bootstrapEmail);

    if (!isAllowedOwner) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}
