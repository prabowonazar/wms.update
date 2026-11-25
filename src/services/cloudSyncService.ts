import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AccurateItemRecord,
  InboundOrder,
  InventoryItem,
  OpnameItemCount,
  OpnameSession,
  OutboundOrder,
  ScanLog,
  SpreadsheetSyncConfig,
  StockCardEntry,
  SyncQueueItem,
  WarehouseLocation,
  WarehouseUser,
  ALL_WAREHOUSES,
  getAllowedWarehousesForUser,
} from '../types/warehouse';
import { REAL_USER_INVENTORY } from '../data/masterInventoryData';
import { INITIAL_USERS } from '../data/mockWarehouseData';

const VALID_WAREHOUSES: WarehouseLocation[] = [
  'Gudang Pusat',
  'Gudang Meruya',
  'Gudang Denpasar',
  'Gudang Surabaya',
];

function sanitizeWarehouse(wh?: string): WarehouseLocation {
  if (wh && VALID_WAREHOUSES.includes(wh as WarehouseLocation)) {
    return wh as WarehouseLocation;
  }
  return 'Gudang Pusat';
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const raw = typeof val === 'string' ? val : val == null ? fallback : String(val);
  const s = raw.length > 0 ? raw : fallback;
  return s.slice(0, maxLen);
}

export function toSafeDocId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) {
    return 'id_' + Date.now();
  }
  return cleaned.slice(0, 120);
}

function inventoryDocId(sku: string): string {
  return 'sku_' + toSafeDocId(sku).slice(0, 110);
}

// Track which inventory/opname/accurate/queue docs already exist in Firestore to preserve immutable createdAt
const knownInventoryDocs = new Map<string, Set<string>>();
const knownOpnameSessions = new Map<string, Set<string>>();
const knownOpnameCounts = new Map<string, Set<string>>();
const knownInboundDocs = new Map<string, Set<string>>();
const knownOutboundDocs = new Map<string, Set<string>>();
const knownStockCardDocs = new Map<string, Set<string>>();
const knownAccurateDocs = new Map<string, Set<string>>();
const knownQueueDocs = new Map<string, Set<string>>();
const knownOperatorDocs = new Map<string, Set<string>>();

function getSet(map: Map<string, Set<string>>, key: string): Set<string> {
  let s = map.get(key);
  if (!s) {
    s = new Set<string>();
    map.set(key, s);
  }
  return s;
}

export function resolveOperatorFromFirebaseUser(
  user: { email?: string | null; displayName?: string | null },
  operators: WarehouseUser[] = INITIAL_USERS
): WarehouseUser | null {
  const pool = operators.length > 0 ? operators : INITIAL_USERS;
  const emailLower = (user.email || '').toLowerCase();
  const nameLower = (user.displayName || '').toLowerCase();

  // Exact or substring match against full name
  const byName = pool.find((u) => {
    const uName = u.name.toLowerCase();
    return (
      (nameLower && (uName === nameLower || nameLower.includes(uName) || uName.includes(nameLower))) ||
      (emailLower && emailLower.includes(uName.replace(/\s+/g, '')))
    );
  });
  if (byName) return byName;

  // Match by first name / keyword in email or displayName
  const combined = `${nameLower} ${emailLower}`;
  if (combined.includes('nazar')) return pool.find((u) => u.id === 'op-nazar') || null;
  if (combined.includes('atang')) return pool.find((u) => u.id === 'op-atang') || null;
  if (combined.includes('husein')) return pool.find((u) => u.id === 'op-husein') || null;
  if (combined.includes('burhan')) return pool.find((u) => u.id === 'op-burhan') || null;
  if (combined.includes('krisna')) return pool.find((u) => u.id === 'op-krisna') || null;
  if (combined.includes('ajeng')) return pool.find((u) => u.id === 'op-ajeng') || null;

  return null;
}

export function isFirebaseUserBranchLocked(
  user?: { email?: string | null } | null,
  operators: WarehouseUser[] = INITIAL_USERS
): WarehouseUser | null {
  const emailLower = (user?.email || '').toLowerCase();
  if (!emailLower) return null;
  const pool = operators.length > 0 ? operators : INITIAL_USERS;
  if (emailLower.includes('atang')) return pool.find((u) => u.id === 'op-atang') || null;
  if (emailLower.includes('husein')) return pool.find((u) => u.id === 'op-husein') || null;
  if (emailLower.includes('burhan')) return pool.find((u) => u.id === 'op-burhan') || null;
  if (emailLower.includes('krisna')) return pool.find((u) => u.id === 'op-krisna') || null;
  if (emailLower.includes('ajeng')) return pool.find((u) => u.id === 'op-ajeng') || null;
  return null;
}

export async function ensureUserWorkspace(
  user: User,
  activeWarehouse: WarehouseLocation,
  activeOperator?: WarehouseUser | null
): Promise<void> {
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/profile`;

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const displayName =
      clampStr(
        activeOperator?.name || user.displayName || user.email?.split('@')[0] || 'Operator Gudang',
        100
      ) || 'Operator Gudang';
    const warehouse = sanitizeWarehouse(activeOperator?.assignedWarehouse || activeWarehouse);
    const activeOperatorId = activeOperator?.id ? clampStr(activeOperator.id, 64) : undefined;

    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        ownerId: user.uid,
        displayName,
        activeWarehouse: warehouse,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (activeOperatorId) payload.activeOperatorId = activeOperatorId;
      await setDoc(userRef, payload);
    } else {
      const payload: Record<string, unknown> = {
        displayName,
        activeWarehouse: warehouse,
        updatedAt: serverTimestamp(),
      };
      if (activeOperatorId) payload.activeOperatorId = activeOperatorId;
      await updateDoc(userRef, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  try {
    const privateRef = doc(db, 'users', user.uid, 'private', 'profile');
    const pSnap = await getDoc(privateRef);
    const email = clampStr(user.email || 'user@scangudang.app', 200);
    const photoURL = user.photoURL ? clampStr(user.photoURL, 500) : undefined;

    if (!pSnap.exists()) {
      const payload: Record<string, unknown> = {
        ownerId: user.uid,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoURL) payload.photoURL = photoURL;
      await setDoc(privateRef, payload);
    } else {
      const payload: Record<string, unknown> = {
        email,
        updatedAt: serverTimestamp(),
      };
      if (photoURL) payload.photoURL = photoURL;
      await updateDoc(privateRef, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export async function updateWorkspaceWarehouseInCloud(
  uid: string,
  warehouse: WarehouseLocation
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      activeWarehouse: sanitizeWarehouse(warehouse),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateWorkspaceOperatorInCloud(
  uid: string,
  operator: WarehouseUser
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = {
      activeOperatorId: clampStr(operator.id, 64),
      displayName: clampStr(operator.name, 100, 'Operator Gudang'),
      updatedAt: serverTimestamp(),
    };
    if (operator.assignedWarehouse) {
      payload.activeWarehouse = sanitizeWarehouse(operator.assignedWarehouse);
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function syncOperatorsToCloud(
  uid: string,
  operators: WarehouseUser[],
  branchLockedOperator?: WarehouseUser | null
): Promise<void> {
  const list = branchLockedOperator ? [branchLockedOperator] : operators;
  if (list.length === 0) return;
  const path = `users/${uid}/operators`;
  const known = getSet(knownOperatorDocs, uid);
  try {
    const batch = writeBatch(db);
    let opsCount = 0;
    for (const op of list.slice(0, 50)) {
      const safeId = toSafeDocId(op.id);
      const ref = doc(db, 'users', uid, 'operators', safeId);
      const assignedWarehouse = sanitizeWarehouse(op.assignedWarehouse || 'Gudang Pusat');
      const warehouseLabel = clampStr(
        op.warehouseLabel ||
          (assignedWarehouse === 'Gudang Pusat'
            ? 'Hanya Gudang Jakarta'
            : assignedWarehouse === 'Gudang Meruya'
            ? 'Hanya Gudang Meruya'
            : assignedWarehouse === 'Gudang Denpasar'
            ? 'Hanya Gudang Bali'
            : assignedWarehouse === 'Gudang Surabaya'
            ? 'Hanya Gudang Surabaya'
            : assignedWarehouse),
        64
      );
      const role =
        op.role === 'admin' || op.role === 'supervisor' || op.role === 'operator'
          ? op.role
          : 'operator';
      const allowedWarehouses = getAllowedWarehousesForUser(op).slice(0, 4);

      if (known.has(safeId)) {
        // Branch-locked accounts cannot update operators collection per firestore.rules
        if (branchLockedOperator) continue;
        batch.update(ref, {
          nik: clampStr(op.nik, 32, 'OP-01'),
          name: clampStr(op.name, 100, 'Operator'),
          role,
          assignedWarehouse,
          warehouseLabel,
          allowedWarehouses,
          updatedAt: serverTimestamp(),
        });
        opsCount++;
      } else {
        batch.set(ref, {
          ownerId: uid,
          id: safeId,
          nik: clampStr(op.nik, 32, 'OP-01'),
          name: clampStr(op.name, 100, 'Operator'),
          role,
          assignedWarehouse,
          warehouseLabel,
          allowedWarehouses,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        known.add(safeId);
        opsCount++;
      }
    }
    if (opsCount > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function safeFiniteNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildInventoryPayload(
  uid: string,
  item: InventoryItem,
  isDeleted: boolean,
  isUpdate: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ownerId: uid,
    sku: clampStr(item.sku, 80, 'SKU-UNKNOWN'),
    barcode: clampStr(item.barcode || item.sku, 100, '000000'),
    name: clampStr(item.name, 200, 'Barang Gudang'),
    category: clampStr(item.category, 100, 'Umum'),
    unit: clampStr(item.unit, 32, 'Pcs'),
    defaultBin: clampStr(item.defaultBin, 64, 'A-01'),
    stockPusat: safeFiniteNum(item.stock?.['Gudang Pusat'], 0),
    stockMeruya: safeFiniteNum(item.stock?.['Gudang Meruya'], 0),
    stockDenpasar: safeFiniteNum(item.stock?.['Gudang Denpasar'], 0),
    stockSurabaya: safeFiniteNum(item.stock?.['Gudang Surabaya'], 0),
    minStock: safeFiniteNum(item.minStock, 0),
    isDeleted,
    updatedAt: serverTimestamp(),
  };

  if (typeof item.costPrice === 'number' && Number.isFinite(item.costPrice)) {
    payload.costPrice = item.costPrice;
  }
  if (item.minStockPerWarehouse) {
    if (
      typeof item.minStockPerWarehouse['Gudang Pusat'] === 'number' &&
      Number.isFinite(item.minStockPerWarehouse['Gudang Pusat'])
    ) {
      payload.minPusat = item.minStockPerWarehouse['Gudang Pusat'];
    }
    if (
      typeof item.minStockPerWarehouse['Gudang Meruya'] === 'number' &&
      Number.isFinite(item.minStockPerWarehouse['Gudang Meruya'])
    ) {
      payload.minMeruya = item.minStockPerWarehouse['Gudang Meruya'];
    }
    if (
      typeof item.minStockPerWarehouse['Gudang Denpasar'] === 'number' &&
      Number.isFinite(item.minStockPerWarehouse['Gudang Denpasar'])
    ) {
      payload.minDenpasar = item.minStockPerWarehouse['Gudang Denpasar'];
    }
    if (
      typeof item.minStockPerWarehouse['Gudang Surabaya'] === 'number' &&
      Number.isFinite(item.minStockPerWarehouse['Gudang Surabaya'])
    ) {
      payload.minSurabaya = item.minStockPerWarehouse['Gudang Surabaya'];
    }
  }

  if (!isUpdate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export async function syncInventoryItemsToCloud(
  uid: string,
  itemsToUpsert: InventoryItem[],
  deletedSkus: string[] = []
): Promise<void> {
  const path = `users/${uid}/inventory_items`;
  const known = getSet(knownInventoryDocs, uid);
  const operations: Array<{ docId: string; item: InventoryItem; isDeleted: boolean }> = [
    ...itemsToUpsert.map((item) => ({
      docId: inventoryDocId(item.sku),
      item,
      isDeleted: false,
    })),
    ...deletedSkus.map((sku) => ({
      docId: inventoryDocId(sku),
      item: {
        sku,
        barcode: sku,
        name: sku,
        category: 'Deleted',
        unit: 'Pcs',
        defaultBin: 'A-01',
        stock: {
          'Gudang Pusat': 0,
          'Gudang Meruya': 0,
          'Gudang Denpasar': 0,
          'Gudang Surabaya': 0,
        },
        minStock: 0,
      },
      isDeleted: true,
    })),
  ];

  const dedupedOpsMap = new Map<string, { docId: string; item: InventoryItem; isDeleted: boolean }>();
  for (const op of operations) {
    dedupedOpsMap.set(op.docId, op);
  }
  const dedupedOperations = Array.from(dedupedOpsMap.values());

  const CHUNK_SIZE = 350;
  try {
    for (let i = 0; i < dedupedOperations.length; i += CHUNK_SIZE) {
      const slice = dedupedOperations.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of slice) {
        const ref = doc(db, 'users', uid, 'inventory_items', op.docId);
        if (known.has(op.docId)) {
          const updateData = buildInventoryPayload(uid, op.item, op.isDeleted, true);
          delete updateData.ownerId;
          batch.update(ref, updateData);
        } else {
          batch.set(ref, buildInventoryPayload(uid, op.item, op.isDeleted, false));
          known.add(op.docId);
        }
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

const VALID_SCAN_LOG_TYPES = new Set<ScanLog['type']>([
  'general_scan',
  'gr',
  'do',
  'opname',
  'mutation_in',
  'mutation_out',
  'inbound',
  'outbound',
  'relocation',
]);

export async function syncScanLogToCloud(uid: string, log: ScanLog): Promise<void> {
  const safeId = toSafeDocId(log.id);
  const path = `users/${uid}/scan_logs/${safeId}`;
  const safeType: ScanLog['type'] = VALID_SCAN_LOG_TYPES.has(log.type) ? log.type : 'general_scan';
  try {
    const payload: Record<string, unknown> = {
      ownerId: uid,
      id: safeId,
      timestamp: clampStr(log.timestamp, 40),
      barcode: clampStr(log.barcode, 100),
      sku: clampStr(log.sku, 80),
      name: clampStr(log.name, 200),
      type: safeType,
      binLocation: clampStr(log.binLocation, 64, 'A-01'),
      quantity: Math.max(0, safeFiniteNum(log.quantity, 0)),
      notes: clampStr(log.notes, 500),
      operatorId: clampStr(log.operatorId, 64, 'op-nazar'),
      operatorName: clampStr(log.operatorName, 100, 'Operator'),
      warehouse: sanitizeWarehouse(log.warehouse),
      syncedToSheet: Boolean(log.syncedToSheet),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (log.lotNumber) payload.lotNumber = clampStr(log.lotNumber, 64);
    if (log.referenceNo) payload.referenceNo = clampStr(log.referenceNo, 100);

    await setDoc(doc(db, 'users', uid, 'scan_logs', safeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteScanLogFromCloud(uid: string, logId: string): Promise<void> {
  const safeId = toSafeDocId(logId);
  const path = `users/${uid}/scan_logs/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'scan_logs', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function markScanLogsSyncedInCloud(uid: string, logs: ScanLog[]): Promise<void> {
  const path = `users/${uid}/scan_logs`;
  try {
    const batch = writeBatch(db);
    let count = 0;
    for (const log of logs) {
      if (!log.syncedToSheet) {
        const safeId = toSafeDocId(log.id);
        batch.update(doc(db, 'users', uid, 'scan_logs', safeId), {
          syncedToSheet: true,
          updatedAt: serverTimestamp(),
        });
        count++;
        if (count >= 400) break;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface ExistingOpnameSyncContext {
  sessionData?: Record<string, unknown>;
  countsData?: Map<string, Record<string, unknown>>;
}

function isLegacyOrMismatchedOpnameHeader(
  data: Record<string, unknown>,
  session: OpnameSession,
  targetStatus: string
): { skipHeaderUpdate: boolean } {
  // Legacy docs (e.g. containing embedded `items` or invalid/missing fields) would fail strict hasOnly update rules
  const allowedKeys = new Set([
    'ownerId',
    'id',
    'code',
    'title',
    'warehouse',
    'targetBinZone',
    'status',
    'createdAtStr',
    'completedAtStr',
    'operatorName',
    'approvedBy',
    'createdAt',
    'updatedAt',
  ]);
  const hasUnknownKey = Object.keys(data).some((k) => !allowedKeys.has(k));
  const missingCore =
    !data.createdAt ||
    typeof data.code !== 'string' ||
    typeof data.createdAtStr !== 'string' ||
    typeof data.operatorName !== 'string';
  if (hasUnknownKey || missingCore) {
    return { skipHeaderUpdate: true };
  }

  const sameTitle = String(data.title || '') === clampStr(session.title, 200, 'Stock Opname');
  const sameZone = String(data.targetBinZone || '') === clampStr(session.targetBinZone, 120, 'Zona A');
  const sameStatus = String(data.status || '') === targetStatus;
  const sameCompletedAt =
    targetStatus !== 'completed' ||
    !session.completedAt ||
    String(data.completedAtStr || '') === clampStr(session.completedAt, 40);
  const sameApprovedBy =
    targetStatus !== 'completed' ||
    !session.approvedBy ||
    String(data.approvedBy || '') === clampStr(session.approvedBy, 100);

  return {
    skipHeaderUpdate: sameTitle && sameZone && sameStatus && sameCompletedAt && sameApprovedBy,
  };
}

export async function syncOpnameSessionToCloud(
  uid: string,
  session: OpnameSession,
  countsToSync?: OpnameItemCount[],
  existingCtx?: ExistingOpnameSyncContext
): Promise<void> {
  const safeSessionId = toSafeDocId(session.id);
  const sessionPath = `users/${uid}/opname_sessions/${safeSessionId}`;
  const countsPath = `${sessionPath}/counts`;
  const knownSess = getSet(knownOpnameSessions, uid);
  const knownCounts = getSet(knownOpnameCounts, `${uid}_${safeSessionId}`);
  const safeStatus =
    session.status === 'active' || session.status === 'completed' || session.status === 'cancelled'
      ? session.status
      : 'active';

  const ref = doc(db, 'users', uid, 'opname_sessions', safeSessionId);
  const rawCounts =
    countsToSync ?? session.items.filter((it) => Boolean(it.lastScannedAt) || it.physicalCount > 0);
  const dedupCountsMap = new Map<string, OpnameItemCount>();
  for (const c of rawCounts) {
    dedupCountsMap.set(inventoryDocId(c.sku || 'SKU'), c);
  }
  const counts = Array.from(dedupCountsMap.values());

  // Create/update parent session in 'active' state first when writing counts so completed-session
  // count lock rule never blocks newly-completed or finishing opname sessions
  const deferCompletedStatus = safeStatus === 'completed' && counts.length > 0;
  const initialWriteStatus = deferCompletedStatus ? 'active' : safeStatus;

  let wroteHeader = false;
  try {
    if (knownSess.has(safeSessionId)) {
      const existingData = existingCtx?.sessionData;
      const check = existingData
        ? isLegacyOrMismatchedOpnameHeader(existingData, session, initialWriteStatus)
        : { skipHeaderUpdate: false };
      if (!check.skipHeaderUpdate) {
        const updatePayload: Record<string, unknown> = {
          title: clampStr(session.title, 200, 'Stock Opname'),
          targetBinZone: clampStr(session.targetBinZone, 120, 'Zona A'),
          status: initialWriteStatus,
          updatedAt: serverTimestamp(),
        };
        if (!deferCompletedStatus) {
          if (session.completedAt) updatePayload.completedAtStr = clampStr(session.completedAt, 40);
          if (session.approvedBy) updatePayload.approvedBy = clampStr(session.approvedBy, 100);
        }
        await updateDoc(ref, updatePayload);
        wroteHeader = true;
      }
    } else {
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        id: safeSessionId,
        code: clampStr(session.code, 64, safeSessionId),
        title: clampStr(session.title, 200, 'Stock Opname'),
        warehouse: sanitizeWarehouse(session.warehouse),
        targetBinZone: clampStr(session.targetBinZone, 120, 'Zona A'),
        status: initialWriteStatus,
        createdAtStr: clampStr(session.createdAt, 40),
        operatorName: clampStr(session.operatorName, 100, 'Operator'),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (!deferCompletedStatus) {
        if (session.completedAt) createPayload.completedAtStr = clampStr(session.completedAt, 40);
        if (session.approvedBy) createPayload.approvedBy = clampStr(session.approvedBy, 100);
      }
      await setDoc(ref, createPayload);
      knownSess.add(safeSessionId);
      wroteHeader = true;
    }
  } catch (error) {
    handleFirestoreError(error, wroteHeader ? OperationType.WRITE : OperationType.WRITE, sessionPath);
  }

  try {
    if (counts.length > 0) {
      const CHUNK = 300;
      for (let i = 0; i < counts.length; i += CHUNK) {
        const slice = counts.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        let batchOps = 0;
        for (const item of slice) {
          const countId = inventoryDocId(item.sku || 'SKU');
          const countRef = doc(db, 'users', uid, 'opname_sessions', safeSessionId, 'counts', countId);
          const nextPhys = Math.max(0, safeFiniteNum(item.physicalCount, 0));
          const nextDiff = safeFiniteNum(item.difference, 0);
          const nextScanned = item.lastScannedAt ? clampStr(item.lastScannedAt, 40) : undefined;
          const nextNotes = item.notes ? clampStr(item.notes, 500) : undefined;

          if (knownCounts.has(countId)) {
            const existingCount = existingCtx?.countsData?.get(countId);
            if (existingCount) {
              const samePhys = safeFiniteNum(existingCount.physicalCount, 0) === nextPhys;
              const sameDiff = safeFiniteNum(existingCount.difference, 0) === nextDiff;
              const sameScanned =
                (nextScanned ?? undefined) ===
                (existingCount.lastScannedAt ? String(existingCount.lastScannedAt) : undefined);
              const sameNotes =
                (nextNotes ?? undefined) ===
                (existingCount.notes ? String(existingCount.notes) : undefined);
              if (samePhys && sameDiff && sameScanned && sameNotes) {
                continue;
              }
            }
            const updateCount: Record<string, unknown> = {
              physicalCount: nextPhys,
              difference: nextDiff,
              updatedAt: serverTimestamp(),
            };
            if (nextScanned) updateCount.lastScannedAt = nextScanned;
            if (nextNotes) updateCount.notes = nextNotes;
            batch.update(countRef, updateCount);
            batchOps++;
          } else {
            const createCount: Record<string, unknown> = {
              ownerId: uid,
              sessionId: safeSessionId,
              sku: clampStr(item.sku, 80, 'SKU'),
              barcode: clampStr(item.barcode || item.sku, 100, 'SKU'),
              name: clampStr(item.name, 200, 'Barang Opname'),
              binLocation: clampStr(item.binLocation, 64, 'A-01'),
              systemStock: safeFiniteNum(item.systemStock, 0),
              physicalCount: nextPhys,
              difference: nextDiff,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (typeof item.costPrice === 'number' && Number.isFinite(item.costPrice)) {
              createCount.costPrice = item.costPrice;
            }
            if (nextScanned) createCount.lastScannedAt = nextScanned;
            if (nextNotes) createCount.notes = nextNotes;
            batch.set(countRef, createCount);
            knownCounts.add(countId);
            batchOps++;
          }
        }
        if (batchOps > 0) {
          await batch.commit();
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, countsPath);
  }

  if (deferCompletedStatus) {
    try {
      const finalizePayload: Record<string, unknown> = {
        status: 'completed',
        updatedAt: serverTimestamp(),
      };
      if (session.completedAt) finalizePayload.completedAtStr = clampStr(session.completedAt, 40);
      if (session.approvedBy) finalizePayload.approvedBy = clampStr(session.approvedBy, 100);
      await updateDoc(ref, finalizePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, sessionPath);
    }
  }
}

function areInboundItemsEqual(
  cloudItems: unknown[],
  localItems: Array<{
    sku: string;
    barcode: string;
    name: string;
    orderedQty: number;
    receivedQty: number;
    unit: string;
    binLocation: string;
  }>
): boolean {
  if (cloudItems.length !== localItems.length) return false;
  for (let i = 0; i < localItems.length; i++) {
    const raw = cloudItems[i];
    if (!raw || typeof raw !== 'object') return false;
    const c = raw as Record<string, unknown>;
    const l = localItems[i];
    if (
      String(c.sku || '') !== l.sku ||
      String(c.barcode || '') !== l.barcode ||
      String(c.name || '') !== l.name ||
      safeFiniteNum(c.orderedQty, 0) !== l.orderedQty ||
      safeFiniteNum(c.receivedQty, 0) !== l.receivedQty ||
      String(c.unit || '') !== l.unit ||
      String(c.binLocation || '') !== l.binLocation
    ) {
      return false;
    }
  }
  return true;
}

function isLegacyOrUnchangedInbound(
  data: Record<string, unknown>,
  order: InboundOrder,
  safeStatus: string,
  boundedItems: Array<{
    sku: string;
    barcode: string;
    name: string;
    orderedQty: number;
    receivedQty: number;
    unit: string;
    binLocation: string;
  }>
): boolean {
  const allowedKeys = new Set([
    'ownerId',
    'id',
    'poNumber',
    'supplier',
    'orderDate',
    'warehouse',
    'status',
    'receivedAt',
    'items',
    'suratJalanNumber',
    'receiverOperator',
    'notes',
    'createdAt',
    'updatedAt',
  ]);
  const hasUnknownKey = Object.keys(data).some((k) => !allowedKeys.has(k));
  const missingCore =
    !data.createdAt ||
    typeof data.poNumber !== 'string' ||
    typeof data.supplier !== 'string' ||
    typeof data.orderDate !== 'string' ||
    typeof data.suratJalanNumber !== 'string' ||
    !Array.isArray(data.items);
  if (hasUnknownKey || missingCore) return true;

  const sameStatus = String(data.status || '') === safeStatus;
  const sameOp =
    String(data.receiverOperator || '') === clampStr(order.receiverOperator, 100, 'Operator');
  const sameNotes = String(data.notes || '') === clampStr(order.notes, 500);
  const nextReceivedAt = order.receivedAt ? clampStr(order.receivedAt, 40) : undefined;
  const sameReceivedAt =
    (nextReceivedAt ?? undefined) === (data.receivedAt ? String(data.receivedAt) : undefined);
  const sameItems = areInboundItemsEqual(data.items as unknown[], boundedItems);

  return sameStatus && sameOp && sameNotes && sameReceivedAt && sameItems;
}

export async function syncInboundOrderToCloud(
  uid: string,
  order: InboundOrder,
  knownExists?: boolean,
  existingData?: Record<string, unknown>
): Promise<void> {
  const safeId = toSafeDocId(order.id);
  const path = `users/${uid}/inbound_orders/${safeId}`;
  const known = getSet(knownInboundDocs, uid);
  const safeStatus =
    order.status === 'draft' || order.status === 'receiving' || order.status === 'completed'
      ? order.status
      : 'receiving';
  try {
    const ref = doc(db, 'users', uid, 'inbound_orders', safeId);
    const existsInCloud =
      knownExists !== undefined ? knownExists : known.has(safeId) || (await getDoc(ref)).exists();
    const boundedItems = order.items.slice(0, 100).map((it) => ({
      sku: clampStr(it.sku, 80, 'SKU'),
      barcode: clampStr(it.barcode || it.sku, 100, 'SKU'),
      name: clampStr(it.name, 200, 'Barang'),
      orderedQty: safeFiniteNum(it.orderedQty, 0),
      receivedQty: safeFiniteNum(it.receivedQty, 0),
      unit: clampStr(it.unit, 32, 'Pcs'),
      binLocation: clampStr(it.binLocation, 64, 'A-01'),
    }));

    if (existsInCloud) {
      known.add(safeId);
      if (existingData && isLegacyOrUnchangedInbound(existingData, order, safeStatus, boundedItems)) {
        return;
      }
      const updatePayload: Record<string, unknown> = {
        items: boundedItems,
        status: safeStatus,
        receiverOperator: clampStr(order.receiverOperator, 100, 'Operator'),
        notes: clampStr(order.notes, 500),
        updatedAt: serverTimestamp(),
      };
      if (order.receivedAt) updatePayload.receivedAt = clampStr(order.receivedAt, 40);
      await updateDoc(ref, updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        id: safeId,
        poNumber: clampStr(order.poNumber, 80, safeId),
        supplier: clampStr(order.supplier, 160, 'Supplier'),
        orderDate: clampStr(order.orderDate, 40),
        warehouse: sanitizeWarehouse(order.warehouse),
        status: safeStatus,
        items: boundedItems,
        suratJalanNumber: clampStr(order.suratJalanNumber, 80, '-'),
        receiverOperator: clampStr(order.receiverOperator, 100, 'Operator'),
        notes: clampStr(order.notes, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (order.receivedAt) createPayload.receivedAt = clampStr(order.receivedAt, 40);
      await setDoc(ref, createPayload);
      known.add(safeId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function areOutboundItemsEqual(
  cloudItems: unknown[],
  localItems: Array<{
    sku: string;
    barcode: string;
    name: string;
    requestedQty: number;
    pickedQty: number;
    unit: string;
  }>
): boolean {
  if (cloudItems.length !== localItems.length) return false;
  for (let i = 0; i < localItems.length; i++) {
    const raw = cloudItems[i];
    if (!raw || typeof raw !== 'object') return false;
    const c = raw as Record<string, unknown>;
    const l = localItems[i];
    if (
      String(c.sku || '') !== l.sku ||
      String(c.barcode || '') !== l.barcode ||
      String(c.name || '') !== l.name ||
      safeFiniteNum(c.requestedQty, 0) !== l.requestedQty ||
      safeFiniteNum(c.pickedQty, 0) !== l.pickedQty ||
      String(c.unit || '') !== l.unit
    ) {
      return false;
    }
  }
  return true;
}

function isLegacyOrUnchangedOutbound(
  data: Record<string, unknown>,
  order: OutboundOrder,
  safeStatus: string,
  boundedItems: Array<{
    sku: string;
    barcode: string;
    name: string;
    requestedQty: number;
    pickedQty: number;
    unit: string;
  }>
): boolean {
  const allowedKeys = new Set([
    'ownerId',
    'id',
    'doNumber',
    'destination',
    'customerName',
    'orderDate',
    'warehouse',
    'status',
    'dispatchedAt',
    'purpose',
    'driverName',
    'vehicleNumber',
    'items',
    'pickerOperator',
    'notes',
    'createdAt',
    'updatedAt',
  ]);
  const hasUnknownKey = Object.keys(data).some((k) => !allowedKeys.has(k));
  const missingCore =
    !data.createdAt ||
    typeof data.doNumber !== 'string' ||
    typeof data.destination !== 'string' ||
    typeof data.customerName !== 'string' ||
    typeof data.orderDate !== 'string' ||
    typeof data.driverName !== 'string' ||
    typeof data.vehicleNumber !== 'string' ||
    !Array.isArray(data.items);
  if (hasUnknownKey || missingCore) return true;

  const sameStatus = String(data.status || '') === safeStatus;
  const sameOp =
    String(data.pickerOperator || '') === clampStr(order.pickerOperator, 100, 'Operator');
  const sameNotes = String(data.notes || '') === clampStr(order.notes, 500);
  const nextDispatchedAt = order.dispatchedAt ? clampStr(order.dispatchedAt, 40) : undefined;
  const sameDispatchedAt =
    (nextDispatchedAt ?? undefined) ===
    (data.dispatchedAt ? String(data.dispatchedAt) : undefined);
  const sameItems = areOutboundItemsEqual(data.items as unknown[], boundedItems);

  return sameStatus && sameOp && sameNotes && sameDispatchedAt && sameItems;
}

export async function syncOutboundOrderToCloud(
  uid: string,
  order: OutboundOrder,
  knownExists?: boolean,
  existingData?: Record<string, unknown>
): Promise<void> {
  const safeId = toSafeDocId(order.id);
  const path = `users/${uid}/outbound_orders/${safeId}`;
  const known = getSet(knownOutboundDocs, uid);
  const safeStatus =
    order.status === 'draft' || order.status === 'picking' || order.status === 'dispatched'
      ? order.status
      : 'picking';
  const safePurpose =
    order.purpose === 'Penjualan' ||
    order.purpose === 'Transfer Cabang' ||
    order.purpose === 'Retur Supplier' ||
    order.purpose === 'Pemakaian Internal'
      ? order.purpose
      : 'Penjualan';
  try {
    const ref = doc(db, 'users', uid, 'outbound_orders', safeId);
    const existsInCloud =
      knownExists !== undefined ? knownExists : known.has(safeId) || (await getDoc(ref)).exists();
    const boundedItems = order.items.slice(0, 100).map((it) => ({
      sku: clampStr(it.sku, 80, 'SKU'),
      barcode: clampStr(it.barcode || it.sku, 100, 'SKU'),
      name: clampStr(it.name, 200, 'Barang'),
      requestedQty: safeFiniteNum(it.requestedQty, 0),
      pickedQty: safeFiniteNum(it.pickedQty, 0),
      unit: clampStr(it.unit, 32, 'Pcs'),
    }));

    if (existsInCloud) {
      known.add(safeId);
      if (existingData && isLegacyOrUnchangedOutbound(existingData, order, safeStatus, boundedItems)) {
        return;
      }
      const updatePayload: Record<string, unknown> = {
        items: boundedItems,
        status: safeStatus,
        pickerOperator: clampStr(order.pickerOperator, 100, 'Operator'),
        notes: clampStr(order.notes, 500),
        updatedAt: serverTimestamp(),
      };
      if (order.dispatchedAt) updatePayload.dispatchedAt = clampStr(order.dispatchedAt, 40);
      await updateDoc(ref, updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        id: safeId,
        doNumber: clampStr(order.doNumber, 80, safeId),
        destination: clampStr(order.destination, 160, '-'),
        customerName: clampStr(order.customerName, 160, '-'),
        orderDate: clampStr(order.orderDate, 40),
        warehouse: sanitizeWarehouse(order.warehouse),
        status: safeStatus,
        purpose: safePurpose,
        driverName: clampStr(order.driverName, 120, '-'),
        vehicleNumber: clampStr(order.vehicleNumber, 40, '-'),
        items: boundedItems,
        pickerOperator: clampStr(order.pickerOperator, 100, 'Operator'),
        notes: clampStr(order.notes, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (order.dispatchedAt) createPayload.dispatchedAt = clampStr(order.dispatchedAt, 40);
      await setDoc(ref, createPayload);
      known.add(safeId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

const VALID_STOCK_CARD_TYPES = new Set<StockCardEntry['transactionType']>([
  'GR',
  'DO',
  'OPNAME_RECONSEL',
  'MUTASI_MASUK',
  'MUTASI_KELUAR',
  'INBOUND',
  'OUTBOUND',
  'OPNAME_ADJUSTMENT',
  'RELOCATION',
]);

export async function syncStockCardsToCloud(uid: string, entries: StockCardEntry[]): Promise<void> {
  const path = `users/${uid}/stock_cards`;
  const known = getSet(knownStockCardDocs, uid);
  const dedupedMap = new Map<string, { safeId: string; entry: StockCardEntry }>();
  for (const entry of entries) {
    const safeId = toSafeDocId(entry.id);
    if (!known.has(safeId) && !dedupedMap.has(safeId)) {
      dedupedMap.set(safeId, { safeId, entry });
    }
  }
  const toCreate = Array.from(dedupedMap.values());
  if (toCreate.length === 0) return;

  try {
    const CHUNK = 350;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const slice = toCreate.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const { safeId, entry } of slice) {
        const qtyIn = Math.max(0, safeFiniteNum(entry.qtyIn, 0));
        const qtyOut = Math.max(0, safeFiniteNum(entry.qtyOut, 0));
        const safeTxType = VALID_STOCK_CARD_TYPES.has(entry.transactionType)
          ? entry.transactionType
          : qtyIn > 0
          ? 'GR'
          : 'DO';
        batch.set(doc(db, 'users', uid, 'stock_cards', safeId), {
          ownerId: uid,
          id: safeId,
          date: clampStr(entry.date, 40),
          sku: clampStr(entry.sku, 80, 'SKU'),
          name: clampStr(entry.name, 200, 'Barang'),
          warehouse: sanitizeWarehouse(entry.warehouse),
          referenceNo: clampStr(entry.referenceNo, 100),
          transactionType: safeTxType,
          qtyIn,
          qtyOut,
          balanceAfter: safeFiniteNum(entry.balanceAfter, 0),
          operator: clampStr(entry.operator, 100, 'Operator'),
          notes: clampStr(entry.notes, 500),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        known.add(safeId);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function syncSpreadsheetSettingsToCloud(
  uid: string,
  config: SpreadsheetSyncConfig
): Promise<void> {
  const path = `users/${uid}/settings/spreadsheet`;
  const safeStatus =
    config.status === 'connected' ||
    config.status === 'disconnected' ||
    config.status === 'syncing' ||
    config.status === 'error'
      ? config.status
      : 'connected';
  try {
    const ref = doc(db, 'users', uid, 'settings', 'spreadsheet');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const updatePayload: Record<string, unknown> = {
        spreadsheetUrl: clampStr(config.spreadsheetUrl, 500),
        sheetId: clampStr(config.sheetId, 160),
        activeSheetName: clampStr(config.activeSheetName, 120, 'Log_Transaksi'),
        autoSync: Boolean(config.autoSync),
        status: safeStatus,
        updatedAt: serverTimestamp(),
      };
      if (config.webhookUrl !== undefined) updatePayload.webhookUrl = clampStr(config.webhookUrl, 500);
      if (config.lastSyncTime) updatePayload.lastSyncTime = clampStr(config.lastSyncTime, 40);
      await updateDoc(ref, updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        spreadsheetUrl: clampStr(config.spreadsheetUrl, 500),
        sheetId: clampStr(config.sheetId, 160),
        activeSheetName: clampStr(config.activeSheetName, 120, 'Log_Transaksi'),
        autoSync: Boolean(config.autoSync),
        status: safeStatus,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (config.webhookUrl) createPayload.webhookUrl = clampStr(config.webhookUrl, 500);
      if (config.lastSyncTime) createPayload.lastSyncTime = clampStr(config.lastSyncTime, 40);
      await setDoc(ref, createPayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncQueueItemsToCloud(
  uid: string,
  items: SyncQueueItem[],
  isStatusUpdateOnly = false
): Promise<void> {
  if (items.length === 0) return;
  const path = `users/${uid}/sync_queue`;
  const known = getSet(knownQueueDocs, uid);
  const dedupedMap = new Map<string, SyncQueueItem>();
  for (const item of items) {
    dedupedMap.set(toSafeDocId(item.id), item);
  }
  const dedupedItems = Array.from(dedupedMap.entries());

  try {
    const CHUNK = 350;
    for (let i = 0; i < dedupedItems.length; i += CHUNK) {
      const slice = dedupedItems.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const [safeId, item] of slice) {
        const ref = doc(db, 'users', uid, 'sync_queue', safeId);
        const safeStatus =
          item.status === 'pending' || item.status === 'synced' || item.status === 'failed'
            ? item.status
            : 'pending';
        if (isStatusUpdateOnly || known.has(safeId)) {
          if (!known.has(safeId) && isStatusUpdateOnly) {
            const createData: Record<string, unknown> = {
              ownerId: uid,
              id: safeId,
              type: clampStr(item.type, 40, 'SCAN_LOG'),
              referenceNo: clampStr(item.referenceNo, 100, '-'),
              sku: clampStr(item.sku, 80, '-'),
              name: clampStr(item.name, 200, 'Item'),
              quantity: safeFiniteNum(item.quantity, 0),
              warehouse: clampStr(item.warehouse, 64, 'Gudang Pusat'),
              operator: clampStr(item.operator, 100, 'Operator'),
              timestamp: clampStr(item.timestamp, 40),
              status: safeStatus,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (item.barcode) createData.barcode = clampStr(item.barcode, 100);
            if (item.binLocation) createData.binLocation = clampStr(item.binLocation, 64);
            if (item.errorMessage) createData.errorMessage = clampStr(item.errorMessage, 300);
            if (item.notes) createData.notes = clampStr(item.notes, 500);
            batch.set(ref, createData);
            known.add(safeId);
          } else {
            const updateData: Record<string, unknown> = {
              status: safeStatus,
              updatedAt: serverTimestamp(),
            };
            if (item.errorMessage) updateData.errorMessage = clampStr(item.errorMessage, 300);
            batch.update(ref, updateData);
          }
        } else {
          const createData: Record<string, unknown> = {
            ownerId: uid,
            id: safeId,
            type: clampStr(item.type, 40, 'SCAN_LOG'),
            referenceNo: clampStr(item.referenceNo, 100, '-'),
            sku: clampStr(item.sku, 80, '-'),
            name: clampStr(item.name, 200, 'Item'),
            quantity: safeFiniteNum(item.quantity, 0),
            warehouse: clampStr(item.warehouse, 64, 'Gudang Pusat'),
            operator: clampStr(item.operator, 100, 'Operator'),
            timestamp: clampStr(item.timestamp, 40),
            status: safeStatus,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (item.barcode) createData.barcode = clampStr(item.barcode, 100);
          if (item.binLocation) createData.binLocation = clampStr(item.binLocation, 64);
          if (item.errorMessage) createData.errorMessage = clampStr(item.errorMessage, 300);
          if (item.notes) createData.notes = clampStr(item.notes, 500);
          batch.set(ref, createData);
          known.add(safeId);
        }
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncAccurateRecordsToCloud(
  uid: string,
  records: AccurateItemRecord[]
): Promise<void> {
  if (records.length === 0) return;
  const path = `users/${uid}/accurate_records`;
  const known = getSet(knownAccurateDocs, uid);
  const dedupedMap = new Map<string, AccurateItemRecord>();
  for (const rec of records) {
    dedupedMap.set(inventoryDocId(rec.sku || 'SKU-ACC'), rec);
  }
  const dedupedRecords = Array.from(dedupedMap.entries());

  try {
    const CHUNK = 350;
    for (let i = 0; i < dedupedRecords.length; i += CHUNK) {
      const slice = dedupedRecords.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const [docId, rec] of slice) {
        const ref = doc(db, 'users', uid, 'accurate_records', docId);
        if (known.has(docId)) {
          batch.update(ref, {
            name: clampStr(rec.name, 200, 'Item Accurate'),
            category: clampStr(rec.category, 100, 'Umum'),
            unit: clampStr(rec.unit, 32, 'Pcs'),
            accurateBookQty: safeFiniteNum(rec.accurateBookQty, 0),
            costPerUnit: safeFiniteNum(rec.costPerUnit, 0),
            lastUpdated: clampStr(rec.lastUpdated, 40),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            ownerId: uid,
            sku: clampStr(rec.sku, 80, 'SKU-ACC'),
            name: clampStr(rec.name, 200, 'Item Accurate'),
            category: clampStr(rec.category, 100, 'Umum'),
            unit: clampStr(rec.unit, 32, 'Pcs'),
            accurateBookQty: safeFiniteNum(rec.accurateBookQty, 0),
            costPerUnit: safeFiniteNum(rec.costPerUnit, 0),
            lastUpdated: clampStr(rec.lastUpdated, 40),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          known.add(docId);
        }
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface LocalWarehouseSnapshot {
  activeWarehouse: WarehouseLocation;
  activeUser?: WarehouseUser | null;
  branchLockedOperator?: WarehouseUser | null;
  operators?: WarehouseUser[];
  inventory: InventoryItem[];
  scanLogs: ScanLog[];
  opnameSessions: OpnameSession[];
  inboundOrders: InboundOrder[];
  outboundOrders: OutboundOrder[];
  stockCards: StockCardEntry[];
  spreadsheetConfig: SpreadsheetSyncConfig;
  accurateRecords: AccurateItemRecord[];
}

export async function syncAllLocalDataToCloud(
  uid: string,
  localState: LocalWarehouseSnapshot
): Promise<{
  inventoryCount: number;
  scanLogCount: number;
  stockCardCount: number;
}> {
  try {
    // Determine effective allowed warehouses so restricted branch operators never send cross-branch writes
    const effectiveOperator = localState.branchLockedOperator || localState.activeUser || null;
    const allowedSet = new Set<WarehouseLocation>(
      effectiveOperator ? getAllowedWarehousesForUser(effectiveOperator) : ALL_WAREHOUSES
    );

    // Pre-populate known sets from Firestore so updates never collide with immutable createdAt rules
    const [
      invSnap,
      logSnap,
      scSnap,
      opnSnap,
      inbSnap,
      outSnap,
      qSnap,
      accSnap,
      opSnap,
    ] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'inventory_items'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'scan_logs'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'stock_cards'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'opname_sessions'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'inbound_orders'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'outbound_orders'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'sync_queue'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'accurate_records'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'operators'), where('ownerId', '==', uid))),
    ]);

    const knownInv = getSet(knownInventoryDocs, uid);
    const existingInvData = new Map<string, Record<string, unknown>>();
    invSnap.docs.forEach((d) => {
      knownInv.add(d.id);
      existingInvData.set(d.id, d.data() as Record<string, unknown>);
    });

    const existingLogIds = new Set(logSnap.docs.map((d) => d.id));
    const existingStockCardIds = new Set(scSnap.docs.map((d) => d.id));
    const knownSC = getSet(knownStockCardDocs, uid);
    scSnap.docs.forEach((d) => knownSC.add(d.id));

    const knownOpn = getSet(knownOpnameSessions, uid);
    const completedOpnIds = new Set<string>();
    const existingOpnData = new Map<string, Record<string, unknown>>();
    opnSnap.docs.forEach((d) => {
      knownOpn.add(d.id);
      const data = d.data() as Record<string, unknown>;
      existingOpnData.set(d.id, data);
      if (data?.status === 'completed') completedOpnIds.add(d.id);
    });

    const knownInb = getSet(knownInboundDocs, uid);
    const completedInboundIds = new Set<string>();
    const existingInbData = new Map<string, Record<string, unknown>>();
    inbSnap.docs.forEach((d) => {
      knownInb.add(d.id);
      const data = d.data() as Record<string, unknown>;
      existingInbData.set(d.id, data);
      if (data?.status === 'completed') completedInboundIds.add(d.id);
    });

    const knownOut = getSet(knownOutboundDocs, uid);
    const dispatchedOutboundIds = new Set<string>();
    const existingOutData = new Map<string, Record<string, unknown>>();
    outSnap.docs.forEach((d) => {
      knownOut.add(d.id);
      const data = d.data() as Record<string, unknown>;
      existingOutData.set(d.id, data);
      if (data?.status === 'dispatched') dispatchedOutboundIds.add(d.id);
    });

    const knownQ = getSet(knownQueueDocs, uid);
    const existingQueueData = new Map<string, Record<string, unknown>>();
    qSnap.docs.forEach((d) => {
      knownQ.add(d.id);
      existingQueueData.set(d.id, d.data() as Record<string, unknown>);
    });

    const knownAcc = getSet(knownAccurateDocs, uid);
    const existingAccData = new Map<string, Record<string, unknown>>();
    accSnap.docs.forEach((d) => {
      knownAcc.add(d.id);
      existingAccData.set(d.id, d.data() as Record<string, unknown>);
    });

    const knownOps = getSet(knownOperatorDocs, uid);
    opSnap.docs.forEach((d) => knownOps.add(d.id));

    // 0. Upload Warehouse Staff Operators (branch-locked user syncs only their own operator doc on create)
    const operatorsToSync =
      localState.operators && localState.operators.length > 0
        ? localState.operators
        : INITIAL_USERS;
    await syncOperatorsToCloud(uid, operatorsToSync, localState.branchLockedOperator);

    // 1. Upload ALL new or changed inventory items (skipping unchanged cloud items to avoid quota/permission friction)
    const inventoryDiff = localState.inventory.filter((item) => {
      const ex = existingInvData.get(inventoryDocId(item.sku));
      if (!ex) return true;
      return (
        Boolean(ex.isDeleted) ||
        String(ex.barcode || '') !== clampStr(item.barcode || item.sku, 100, '000000') ||
        String(ex.name || '') !== clampStr(item.name, 200, 'Barang Gudang') ||
        String(ex.category || '') !== clampStr(item.category, 100, 'Umum') ||
        String(ex.unit || '') !== clampStr(item.unit, 32, 'Pcs') ||
        String(ex.defaultBin || '') !== clampStr(item.defaultBin, 64, 'A-01') ||
        safeFiniteNum(ex.stockPusat, 0) !== safeFiniteNum(item.stock?.['Gudang Pusat'], 0) ||
        safeFiniteNum(ex.stockMeruya, 0) !== safeFiniteNum(item.stock?.['Gudang Meruya'], 0) ||
        safeFiniteNum(ex.stockDenpasar, 0) !== safeFiniteNum(item.stock?.['Gudang Denpasar'], 0) ||
        safeFiniteNum(ex.stockSurabaya, 0) !== safeFiniteNum(item.stock?.['Gudang Surabaya'], 0) ||
        safeFiniteNum(ex.minStock, 0) !== safeFiniteNum(item.minStock, 0)
      );
    });
    if (inventoryDiff.length > 0) {
      await syncInventoryItemsToCloud(uid, inventoryDiff, []);
    }

    // 2. Upload Spreadsheet settings & changed/missing sync queue items (filtered to allowed warehouses)
    await syncSpreadsheetSettingsToCloud(uid, localState.spreadsheetConfig);
    const allowedQueue = localState.spreadsheetConfig.queue.filter((q) => {
      const whOk =
        !VALID_WAREHOUSES.includes(q.warehouse as WarehouseLocation) ||
        allowedSet.has(q.warehouse as WarehouseLocation);
      if (!whOk) return false;
      const ex = existingQueueData.get(toSafeDocId(q.id));
      if (!ex) return true;
      return (
        String(ex.status || '') !== String(q.status || 'pending') ||
        String(ex.errorMessage || '') !== String(q.errorMessage || '')
      );
    });
    if (allowedQueue.length > 0) {
      await syncQueueItemsToCloud(uid, allowedQueue.slice(0, 300), false);
    }

    // 3. Upload Scan Logs (only allowed warehouses & new docs)
    const newLogs = localState.scanLogs.filter(
      (l) => allowedSet.has(l.warehouse) && !existingLogIds.has(toSafeDocId(l.id))
    );
    for (const log of newLogs.slice(0, 300)) {
      await syncScanLogToCloud(uid, log);
    }

    // 4. Upload Opname Sessions (only allowed warehouses, skip completed & unchanged docs)
    for (const session of localState.opnameSessions.filter((s) => allowedSet.has(s.warehouse)).slice(0, 30)) {
      const safeId = toSafeDocId(session.id);
      if (!completedOpnIds.has(safeId)) {
        const countSnap = await getDocs(
          query(collection(db, 'users', uid, 'opname_sessions', safeId, 'counts'), where('ownerId', '==', uid))
        );
        const knownC = getSet(knownOpnameCounts, `${uid}_${safeId}`);
        const existingCountsData = new Map<string, Record<string, unknown>>();
        countSnap.docs.forEach((d) => {
          knownC.add(d.id);
          existingCountsData.set(d.id, d.data() as Record<string, unknown>);
        });
        await syncOpnameSessionToCloud(uid, session, session.items, {
          sessionData: existingOpnData.get(safeId),
          countsData: existingCountsData,
        });
      }
    }

    // 5. Upload Inbound & Outbound Orders (only allowed warehouses, skip terminal states & unchanged docs)
    for (const order of localState.inboundOrders.filter((o) => allowedSet.has(o.warehouse)).slice(0, 50)) {
      const safeId = toSafeDocId(order.id);
      if (!completedInboundIds.has(safeId)) {
        await syncInboundOrderToCloud(uid, order, knownInb.has(safeId), existingInbData.get(safeId));
      }
    }
    for (const order of localState.outboundOrders.filter((o) => allowedSet.has(o.warehouse)).slice(0, 50)) {
      const safeId = toSafeDocId(order.id);
      if (!dispatchedOutboundIds.has(safeId)) {
        await syncOutboundOrderToCloud(uid, order, knownOut.has(safeId), existingOutData.get(safeId));
      }
    }

    // 6. Upload Stock Cards (only allowed warehouses & missing entries)
    const newCards = localState.stockCards.filter(
      (c) => allowedSet.has(c.warehouse) && !existingStockCardIds.has(toSafeDocId(c.id))
    );
    if (newCards.length > 0) {
      await syncStockCardsToCloud(uid, newCards.slice(0, 350));
    }

    // 7. Upload new/changed Accurate Records
    const accurateDiff = localState.accurateRecords.filter((rec) => {
      const ex = existingAccData.get(inventoryDocId(rec.sku || 'SKU-ACC'));
      if (!ex) return true;
      return (
        String(ex.name || '') !== clampStr(rec.name, 200, 'Item Accurate') ||
        String(ex.category || '') !== clampStr(rec.category, 100, 'Umum') ||
        String(ex.unit || '') !== clampStr(rec.unit, 32, 'Pcs') ||
        safeFiniteNum(ex.accurateBookQty, 0) !== safeFiniteNum(rec.accurateBookQty, 0) ||
        safeFiniteNum(ex.costPerUnit, 0) !== safeFiniteNum(rec.costPerUnit, 0) ||
        String(ex.lastUpdated || '') !== clampStr(rec.lastUpdated, 40)
      );
    });
    if (accurateDiff.length > 0) {
      await syncAccurateRecordsToCloud(uid, accurateDiff.slice(0, 500));
    }

    return {
      inventoryCount: localState.inventory.length,
      scanLogCount: newLogs.length,
      stockCardCount: newCards.length,
    };
  } catch (error: any) {
    if (typeof error?.message === 'string' && error.message.includes('"operationType"')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function seedInitialCloudWorkspaceIfEmpty(
  uid: string,
  localState: LocalWarehouseSnapshot
): Promise<boolean> {
  const settingsRef = doc(db, 'users', uid, 'settings', 'spreadsheet');
  try {
    const [settingsSnap, invSampleSnap, opSampleSnap] = await Promise.all([
      getDoc(settingsRef),
      getDocs(
        query(collection(db, 'users', uid, 'inventory_items'), where('ownerId', '==', uid), limit(50))
      ),
      getDocs(
        query(collection(db, 'users', uid, 'operators'), where('ownerId', '==', uid), limit(1))
      ),
    ]);

    if (settingsSnap.exists() && invSampleSnap.size >= 50) {
      if (opSampleSnap.empty) {
        const operatorsToSync =
          localState.operators && localState.operators.length > 0
            ? localState.operators
            : INITIAL_USERS;
        await syncOperatorsToCloud(uid, operatorsToSync, localState.branchLockedOperator);
      }
      return false; // Cloud already initialized with settings & full inventory
    }

    await syncAllLocalDataToCloud(uid, localState);

    return true;
  } catch (error: any) {
    if (typeof error?.message === 'string' && error.message.includes('"operationType"')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export interface CloudSubscriptionCallbacks {
  onWorkspace: (ws: {
    activeWarehouse: WarehouseLocation;
    activeOperatorId?: string;
    displayName?: string;
  }) => void;
  onOperators?: (operators: WarehouseUser[]) => void;
  onInventory: (mergedInventory: InventoryItem[]) => void;
  onScanLogs: (logs: ScanLog[]) => void;
  onOpnameSessions: (sessions: OpnameSession[]) => void;
  onInboundOrders: (orders: InboundOrder[]) => void;
  onOutboundOrders: (orders: OutboundOrder[]) => void;
  onStockCards: (entries: StockCardEntry[]) => void;
  onSpreadsheetConfig: (config: SpreadsheetSyncConfig) => void;
  onAccurateRecords: (records: AccurateItemRecord[]) => void;
}

export function subscribeToWarehouseCloud(
  uid: string,
  callbacks: CloudSubscriptionCallbacks
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];
  let latestSettings: Omit<SpreadsheetSyncConfig, 'queue'> | null = null;
  let latestQueue: SyncQueueItem[] = [];

  const emitConfigIfReady = () => {
    if (latestSettings) {
      callbacks.onSpreadsheetConfig({
        ...latestSettings,
        queue: latestQueue,
      });
    }
  };

  // 1. User Workspace
  unsubs.push(
    onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data?.activeWarehouse) {
            callbacks.onWorkspace({
              activeWarehouse: sanitizeWarehouse(data.activeWarehouse),
              activeOperatorId: data.activeOperatorId ? String(data.activeOperatorId) : undefined,
              displayName: data.displayName ? String(data.displayName) : undefined,
            });
          }
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, `users/${uid}`)
    )
  );

  // 1b. Warehouse Staff Operators
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'operators'), where('ownerId', '==', uid)),
      (snap) => {
        const knownOps = getSet(knownOperatorDocs, uid);
        const cloudMap = new Map<string, WarehouseUser>();
        snap.docs.forEach((d) => {
          knownOps.add(d.id);
          const data = d.data();
          const opId = String(data.id || d.id);
          const preset = INITIAL_USERS.find((u) => u.id === opId);
          if (preset) {
            // Preserve canonical branch rules for core staff profiles
            cloudMap.set(opId, preset);
          } else {
            cloudMap.set(opId, {
              id: opId,
              nik: String(data.nik || 'OP-01'),
              name: String(data.name || 'Operator'),
              role: (data.role as WarehouseUser['role']) || 'operator',
              pin: '',
              avatar:
                'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
              phone: '-',
              assignedWarehouse: sanitizeWarehouse(data.assignedWarehouse),
              warehouseLabel: String(data.warehouseLabel || ''),
              allowedWarehouses:
                Array.isArray(data.allowedWarehouses) && data.allowedWarehouses.length > 0
                  ? data.allowedWarehouses.map((w: unknown) => sanitizeWarehouse(String(w)))
                  : undefined,
            });
          }
        });
        const mergedOps: WarehouseUser[] = [
          ...INITIAL_USERS,
          ...Array.from(cloudMap.values()).filter(
            (op) => !INITIAL_USERS.some((p) => p.id === op.id)
          ),
        ];
        if (snap.docs.length > 0 && callbacks.onOperators) {
          callbacks.onOperators(mergedOps);
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/operators`)
    )
  );

  // 2. Inventory Overrides merged with REAL_USER_INVENTORY
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'inventory_items'), where('ownerId', '==', uid)),
      (snap) => {
        const known = getSet(knownInventoryDocs, uid);
        const overrideMap = new Map<string, { item: InventoryItem; isDeleted: boolean }>();

        snap.docs.forEach((d) => {
          known.add(d.id);
          const data = d.data();
          const item: InventoryItem = {
            sku: String(data.sku || ''),
            barcode: String(data.barcode || data.sku || ''),
            name: String(data.name || ''),
            category: String(data.category || 'Umum'),
            unit: String(data.unit || 'Pcs'),
            defaultBin: String(data.defaultBin || 'A-01'),
            costPrice: typeof data.costPrice === 'number' ? data.costPrice : undefined,
            stock: {
              'Gudang Pusat': Number(data.stockPusat ?? 0),
              'Gudang Meruya': Number(data.stockMeruya ?? 0),
              'Gudang Denpasar': Number(data.stockDenpasar ?? 0),
              'Gudang Surabaya': Number(data.stockSurabaya ?? 0),
            },
            minStock: Number(data.minStock ?? 0),
            minStockPerWarehouse: {
              'Gudang Pusat': typeof data.minPusat === 'number' ? data.minPusat : Number(data.minStock ?? 0),
              'Gudang Meruya': typeof data.minMeruya === 'number' ? data.minMeruya : Number(data.minStock ?? 0),
              'Gudang Denpasar': typeof data.minDenpasar === 'number' ? data.minDenpasar : Number(data.minStock ?? 0),
              'Gudang Surabaya': typeof data.minSurabaya === 'number' ? data.minSurabaya : Number(data.minStock ?? 0),
            },
          };
          overrideMap.set(item.sku, { item, isDeleted: Boolean(data.isDeleted) });
        });

        const merged: InventoryItem[] = [];
        const seenSkus = new Set<string>();

        for (const base of REAL_USER_INVENTORY) {
          seenSkus.add(base.sku);
          const ov = overrideMap.get(base.sku);
          if (ov) {
            if (!ov.isDeleted) merged.push(ov.item);
          } else {
            merged.push(base);
          }
        }

        for (const [sku, ov] of overrideMap.entries()) {
          if (!seenSkus.has(sku) && !ov.isDeleted) {
            merged.unshift(ov.item);
          }
        }

        callbacks.onInventory(merged);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/inventory_items`)
    )
  );

  // 3. Scan Logs
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'scan_logs'), where('ownerId', '==', uid)),
      (snap) => {
        const logs: ScanLog[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              timestamp: String(data.timestamp || ''),
              barcode: String(data.barcode || ''),
              sku: String(data.sku || ''),
              name: String(data.name || ''),
              type: data.type,
              binLocation: String(data.binLocation || ''),
              lotNumber: data.lotNumber ? String(data.lotNumber) : undefined,
              quantity: Number(data.quantity || 1),
              notes: String(data.notes || ''),
              operatorId: String(data.operatorId || 'op-nazar'),
              operatorName: String(data.operatorName || 'Operator'),
              warehouse: sanitizeWarehouse(data.warehouse),
              referenceNo: data.referenceNo ? String(data.referenceNo) : undefined,
              syncedToSheet: Boolean(data.syncedToSheet),
            } as ScanLog;
          })
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        callbacks.onScanLogs(logs);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/scan_logs`)
    )
  );

  // 4. Opname Sessions
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'opname_sessions'), where('ownerId', '==', uid)),
      async (snap) => {
        const knownSess = getSet(knownOpnameSessions, uid);
        const sessions: OpnameSession[] = [];

        for (const d of snap.docs) {
          knownSess.add(d.id);
          const data = d.data();
          const countsPath = `users/${uid}/opname_sessions/${d.id}/counts`;
          let counts: OpnameItemCount[] = [];
          try {
            const countSnap = await getDocs(
              query(collection(db, 'users', uid, 'opname_sessions', d.id, 'counts'), where('ownerId', '==', uid))
            );
            const knownC = getSet(knownOpnameCounts, `${uid}_${d.id}`);
            counts = countSnap.docs.map((cd) => {
              knownC.add(cd.id);
              const c = cd.data();
              return {
                sku: String(c.sku || ''),
                barcode: String(c.barcode || ''),
                name: String(c.name || ''),
                binLocation: String(c.binLocation || ''),
                systemStock: Number(c.systemStock || 0),
                physicalCount: Number(c.physicalCount || 0),
                difference: Number(c.difference || 0),
                costPrice: typeof c.costPrice === 'number' ? c.costPrice : undefined,
                lastScannedAt: c.lastScannedAt ? String(c.lastScannedAt) : undefined,
                notes: c.notes ? String(c.notes) : undefined,
              };
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.LIST, countsPath);
          }

          sessions.push({
            id: String(data.id || d.id),
            code: String(data.code || ''),
            title: String(data.title || ''),
            warehouse: sanitizeWarehouse(data.warehouse),
            targetBinZone: String(data.targetBinZone || ''),
            status: data.status || 'active',
            createdAt: String(data.createdAtStr || ''),
            completedAt: data.completedAtStr ? String(data.completedAtStr) : undefined,
            operatorName: String(data.operatorName || ''),
            approvedBy: data.approvedBy ? String(data.approvedBy) : undefined,
            items: counts,
          });
        }

        sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (sessions.length > 0) {
          callbacks.onOpnameSessions(sessions);
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/opname_sessions`)
    )
  );

  // 5. Inbound Orders
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'inbound_orders'), where('ownerId', '==', uid)),
      (snap) => {
        const knownInb = getSet(knownInboundDocs, uid);
        const orders: InboundOrder[] = snap.docs
          .map((d) => {
            knownInb.add(d.id);
            const data = d.data();
            return {
              id: String(data.id || d.id),
              poNumber: String(data.poNumber || ''),
              supplier: String(data.supplier || ''),
              orderDate: String(data.orderDate || ''),
              warehouse: sanitizeWarehouse(data.warehouse),
              status: data.status || 'receiving',
              receivedAt: data.receivedAt ? String(data.receivedAt) : undefined,
              items: Array.isArray(data.items) ? data.items : [],
              suratJalanNumber: String(data.suratJalanNumber || ''),
              receiverOperator: String(data.receiverOperator || ''),
              notes: String(data.notes || ''),
            } as InboundOrder;
          })
          .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
        if (orders.length > 0) callbacks.onInboundOrders(orders);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/inbound_orders`)
    )
  );

  // 6. Outbound Orders
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'outbound_orders'), where('ownerId', '==', uid)),
      (snap) => {
        const knownOut = getSet(knownOutboundDocs, uid);
        const orders: OutboundOrder[] = snap.docs
          .map((d) => {
            knownOut.add(d.id);
            const data = d.data();
            return {
              id: String(data.id || d.id),
              doNumber: String(data.doNumber || ''),
              destination: String(data.destination || ''),
              customerName: String(data.customerName || ''),
              orderDate: String(data.orderDate || ''),
              warehouse: sanitizeWarehouse(data.warehouse),
              status: data.status || 'picking',
              dispatchedAt: data.dispatchedAt ? String(data.dispatchedAt) : undefined,
              purpose: data.purpose || 'Penjualan',
              driverName: String(data.driverName || ''),
              vehicleNumber: String(data.vehicleNumber || ''),
              items: Array.isArray(data.items) ? data.items : [],
              pickerOperator: String(data.pickerOperator || ''),
              notes: String(data.notes || ''),
            } as OutboundOrder;
          })
          .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
        if (orders.length > 0) callbacks.onOutboundOrders(orders);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/outbound_orders`)
    )
  );

  // 7. Stock Cards
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'stock_cards'), where('ownerId', '==', uid)),
      (snap) => {
        const knownSC = getSet(knownStockCardDocs, uid);
        const entries: StockCardEntry[] = snap.docs
          .map((d) => {
            knownSC.add(d.id);
            const data = d.data();
            return {
              id: String(data.id || d.id),
              date: String(data.date || ''),
              sku: String(data.sku || ''),
              name: String(data.name || ''),
              warehouse: sanitizeWarehouse(data.warehouse),
              referenceNo: String(data.referenceNo || ''),
              transactionType: data.transactionType,
              qtyIn: Number(data.qtyIn || 0),
              qtyOut: Number(data.qtyOut || 0),
              balanceAfter: Number(data.balanceAfter || 0),
              operator: String(data.operator || ''),
              notes: String(data.notes || ''),
            } as StockCardEntry;
          })
          .sort((a, b) => b.date.localeCompare(a.date));
        if (entries.length > 0) callbacks.onStockCards(entries);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/stock_cards`)
    )
  );

  // 8. Spreadsheet Settings + Queue
  unsubs.push(
    onSnapshot(
      doc(db, 'users', uid, 'settings', 'spreadsheet'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          latestSettings = {
            spreadsheetUrl: String(data.spreadsheetUrl || ''),
            webhookUrl: data.webhookUrl ? String(data.webhookUrl) : '',
            sheetId: String(data.sheetId || ''),
            activeSheetName: String(data.activeSheetName || 'Log_Transaksi'),
            autoSync: Boolean(data.autoSync),
            lastSyncTime: data.lastSyncTime ? String(data.lastSyncTime) : undefined,
            status: data.status || 'connected',
          };
          emitConfigIfReady();
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, `users/${uid}/settings/spreadsheet`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'sync_queue'), where('ownerId', '==', uid)),
      (snap) => {
        const knownQ = getSet(knownQueueDocs, uid);
        latestQueue = snap.docs
          .map((d) => {
            knownQ.add(d.id);
            const data = d.data();
            return {
              id: String(data.id || d.id),
              type: String(data.type || 'SCAN_LOG'),
              barcode: data.barcode ? String(data.barcode) : undefined,
              binLocation: data.binLocation ? String(data.binLocation) : undefined,
              referenceNo: String(data.referenceNo || ''),
              sku: String(data.sku || ''),
              name: String(data.name || ''),
              quantity: Number(data.quantity || 0),
              warehouse: String(data.warehouse || ''),
              operator: String(data.operator || ''),
              timestamp: String(data.timestamp || ''),
              status: data.status || 'pending',
              errorMessage: data.errorMessage ? String(data.errorMessage) : undefined,
              notes: data.notes ? String(data.notes) : undefined,
            } as SyncQueueItem;
          })
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        emitConfigIfReady();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/sync_queue`)
    )
  );

  // 9. Accurate Records
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'accurate_records'), where('ownerId', '==', uid)),
      (snap) => {
        const knownAcc = getSet(knownAccurateDocs, uid);
        const records: AccurateItemRecord[] = snap.docs.map((d) => {
          knownAcc.add(d.id);
          const data = d.data();
          return {
            sku: String(data.sku || ''),
            name: String(data.name || ''),
            category: String(data.category || ''),
            unit: String(data.unit || 'Pcs'),
            accurateBookQty: Number(data.accurateBookQty || 0),
            costPerUnit: Number(data.costPerUnit || 0),
            lastUpdated: String(data.lastUpdated || ''),
          };
        });
        if (records.length > 0) callbacks.onAccurateRecords(records);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/accurate_records`)
    )
  );

  return () => {
    unsubs.forEach((u) => u());
  };
}
