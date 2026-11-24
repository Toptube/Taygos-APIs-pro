/**
 * Payload-First Security Test Specification for Taygos APIs Firestore Rules.
 * Validates the 12 adversarial payloads defined in security_spec.md.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Unauthenticated read on private access key',
    operation: 'get',
    path: '/users/user_a/accessKeys/key_1',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-user list on another user accessKeys',
    operation: 'list',
    path: '/users/user_a/accessKeys',
    auth: { uid: 'user_b', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified email user creating vault profile',
    operation: 'create',
    path: '/users/user_a',
    auth: { uid: 'user_a', email_verified: false },
    payload: { ownerId: 'user_a', displayName: 'Test' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow field injection (isAdmin) on accessKey create',
    operation: 'create',
    path: '/users/user_a/accessKeys/key_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      ownerId: 'user_a',
      id: 'key_1',
      name: 'App 1',
      description: '',
      publicKey: 'pk_taygos_live_123456',
      secretKey: 'sk_taygos_live_123456',
      secretMasked: 'sk_taygos_live_••••3456',
      perpetual: true,
      requireHmac: false,
      status: 'active',
      scopes: ['gateway:execute'],
      isAdmin: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Owner ID spoofing inside provider create payload',
    operation: 'create',
    path: '/users/user_a/providers/prov_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      ownerId: 'victim_uid',
      id: 'prov_1',
      name: 'Groq',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned subcollection write without parent /users/{uid}',
    operation: 'create',
    path: '/users/orphan_user/providers/prov_1',
    auth: { uid: 'orphan_user', email_verified: true },
    payload: { ownerId: 'orphan_user', id: 'prov_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Path variable poisoning with oversized ID',
    operation: 'get',
    path: `/users/user_a/accessKeys/${'x'.repeat(160)}`,
    auth: { uid: 'user_a', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client-spoofed createdAt timestamp',
    operation: 'create',
    path: '/users/user_a',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      ownerId: 'user_a',
      displayName: 'Vault',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable ownerId modification on update',
    operation: 'update',
    path: '/users/user_a/accessKeys/key_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_b' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unauthorized publicKey mutation during update',
    operation: 'update',
    path: '/users/user_a/accessKeys/key_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { publicKey: 'pk_tampered_123456' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Oversized apiKey string exhaustion attack',
    operation: 'create',
    path: '/users/user_a/providers/prov_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_a', id: 'prov_1', apiKey: 'k'.repeat(1024) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket list attempt on /users collection',
    operation: 'list',
    path: '/users',
    auth: { uid: 'user_a', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];
