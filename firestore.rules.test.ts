/**
 * Phase 0 Payload-First Security TDD Spec for Firestore Rules.
 * Run against Firebase Emulator Suite (@firebase/rules-unit-testing) when testing locally.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Cross-tenant write to victim scan_logs',
    collectionPath: 'users/victim_uid/scan_logs/scan_1',
    operation: 'create',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { ownerId: 'attacker_uid', id: 'scan_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified admin email spoof',
    collectionPath: 'users/victim_uid/settings/spreadsheet',
    operation: 'get',
    auth: { uid: 'attacker_uid', email: 'rfq.fascosanwira@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'OwnerId spoofing on create',
    collectionPath: 'users/attacker_uid/inventory_items/sku_1',
    operation: 'create',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { ownerId: 'victim_uid', sku: 'SKU-1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow ghost field injection (isAdmin)',
    collectionPath: 'users/user_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      ownerId: 'user_1',
      displayName: 'Operator',
      activeWarehouse: 'Gudang Pusat',
      isAdmin: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Oversized document ID poisoning (>128 chars)',
    collectionPath: `users/user_1/scan_logs/${'a'.repeat(140)}`,
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Client-forged createdAt timestamp instead of serverTimestamp',
    collectionPath: 'users/user_1/stock_cards/sc_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      ownerId: 'user_1',
      id: 'sc_1',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable ownerId mutation on update',
    collectionPath: 'users/user_1/scan_logs/scan_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'another_uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Terminal state bypass on completed inbound order',
    collectionPath: 'users/user_1/inbound_orders/in_completed',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { status: 'receiving' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal state bypass on dispatched outbound order',
    collectionPath: 'users/user_1/outbound_orders/out_dispatched',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { status: 'picking' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned opname count without parent session',
    collectionPath: 'users/user_1/opname_sessions/missing_session/counts/sku_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user_1', sessionId: 'missing_session', sku: 'SKU-1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Denial-of-Wallet oversized string notes (>500 chars)',
    collectionPath: 'users/user_1/scan_logs/scan_big',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user_1', id: 'scan_big', notes: 'x'.repeat(2000) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Malformed items array type on inbound order',
    collectionPath: 'users/user_1/inbound_orders/in_bad_items',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user_1', id: 'in_bad_items', items: ['invalid-string-item'] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Jakarta operator (Husein) attempting scan log write to Meruya (Gudang Meruya)',
    collectionPath: 'users/uid_husein/scan_logs/scan_meruya',
    operation: 'create',
    auth: { uid: 'uid_husein', email: 'husein@wmsfascoo.com', email_verified: true },
    payload: { ownerId: 'uid_husein', id: 'scan_meruya', warehouse: 'Gudang Meruya' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Meruya operator (Burhan) attempting inventory stock update on Jakarta (stockPusat)',
    collectionPath: 'users/uid_burhan/inventory_items/sku_EL_001',
    operation: 'update',
    auth: { uid: 'uid_burhan', email: 'burhan@wmsfascoo.com', email_verified: true },
    payload: { stockPusat: 999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 15,
    name: 'Bali operator (Krisna) attempting inventory stock update on Jakarta (stockPusat)',
    collectionPath: 'users/uid_krisna/inventory_items/sku_EL_001',
    operation: 'update',
    auth: { uid: 'uid_krisna', email: 'krisna@wmsfascoo.com', email_verified: true },
    payload: { stockPusat: 999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 16,
    name: 'Surabaya operator (Ajeng) attempting inbound write to Jakarta (Gudang Pusat)',
    collectionPath: 'users/uid_ajeng/inbound_orders/in_jkt',
    operation: 'create',
    auth: { uid: 'uid_ajeng', email: 'ajeng@wmsfascoo.com', email_verified: true },
    payload: { ownerId: 'uid_ajeng', id: 'in_jkt', warehouse: 'Gudang Pusat' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 17,
    name: 'Branch operator (Krisna) attempting privilege escalation to op-nazar',
    collectionPath: 'users/uid_krisna',
    operation: 'update',
    auth: { uid: 'uid_krisna', email: 'krisna@wmsfascoo.com', email_verified: true },
    payload: { activeOperatorId: 'op-nazar', activeWarehouse: 'Gudang Pusat' },
    expected: 'PERMISSION_DENIED',
  },
];
