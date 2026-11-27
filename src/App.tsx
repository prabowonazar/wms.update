import React, { useState, useEffect, useMemo, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  User,
} from 'firebase/auth';
import {
  WarehouseLocation,
  WarehouseUser,
  InventoryItem,
  ScanLog,
  OpnameSession,
  InboundOrder,
  OutboundOrder,
  StockCardEntry,
  StockCardTransactionType,
  SpreadsheetSyncConfig,
  AccurateItemRecord,
  SyncQueueItem,
  getItemMinStock,
  getAllowedWarehousesForUser,
} from './types/warehouse';
import { StorageService } from './utils/storage';
import { soundService } from './utils/audio';
import { auth } from './firebase';
import { Loader2 } from 'lucide-react';
import {
  ensureUserWorkspace,
  seedInitialCloudWorkspaceIfEmpty,
  syncAllLocalDataToCloud,
  subscribeToWarehouseCloud,
  updateWorkspaceWarehouseInCloud,
  resolveOperatorFromFirebaseUser,
  isFirebaseUserBranchLocked,
  syncInventoryItemsToCloud,
  syncScanLogToCloud,
  deleteScanLogFromCloud,
  markScanLogsSyncedInCloud,
  syncOpnameSessionToCloud,
  syncInboundOrderToCloud,
  syncOutboundOrderToCloud,
  syncStockCardsToCloud,
  syncSpreadsheetSettingsToCloud,
  syncQueueItemsToCloud,
  syncAccurateRecordsToCloud,
} from './services/cloudSyncService';

import { HeaderNav } from './components/HeaderNav';
import { BottomNavBar, AppTab } from './components/BottomNavBar';
import { MobileFrame } from './components/MobileFrame';
import { BarcodeHelperModal } from './components/BarcodeHelperModal';
import { MobileConnectModal } from './components/MobileConnectModal';
import { AuthModal } from './components/tabs/AuthModal';
import { LoginScreen } from './components/auth/LoginScreen';

import { ScanLogTab } from './components/tabs/ScanLogTab';
import { StockOpnameTab } from './components/tabs/StockOpnameTab';
import { InboundTab } from './components/tabs/InboundTab';
import { OutboundTab } from './components/tabs/OutboundTab';
import { StockCardTab } from './components/tabs/StockCardTab';
import { SyncSpreadsheetTab } from './components/tabs/SyncSpreadsheetTab';
import { AccurateReconciliationTab } from './components/tabs/AccurateReconciliationTab';

export default function App() {
  // Application Data States initialized from localStorage
  const [users, setUsers] = useState<WarehouseUser[]>(StorageService.getUsers());
  const [activeUser, setActiveUser] = useState<WarehouseUser | null>(
    StorageService.getActiveUser()
  );
  const [activeWarehouse, setActiveWarehouse] = useState<WarehouseLocation>(() => {
    const initialUser = StorageService.getActiveUser();
    const storedWh = StorageService.getActiveWarehouse();
    const allowed = getAllowedWarehousesForUser(initialUser);
    return allowed.includes(storedWh) ? storedWh : allowed[0];
  });

  const [inventory, setInventory] = useState<InventoryItem[]>(StorageService.getInventory());
  const [scanLogs, setScanLogs] = useState<ScanLog[]>(StorageService.getScanLogs());
  const [opnameSessions, setOpnameSessions] = useState<OpnameSession[]>(
    StorageService.getOpnameSessions()
  );
  const [inboundOrders, setInboundOrders] = useState<InboundOrder[]>(
    StorageService.getInboundOrders()
  );
  const [outboundOrders, setOutboundOrders] = useState<OutboundOrder[]>(
    StorageService.getOutboundOrders()
  );
  const [stockCards, setStockCards] = useState<StockCardEntry[]>(
    StorageService.getStockCards()
  );
  const [spreadsheetConfig, setSpreadsheetConfig] = useState<SpreadsheetSyncConfig>(
    StorageService.getSpreadsheetConfig()
  );
  const [accurateRecords, setAccurateRecords] = useState<AccurateItemRecord[]>(
    StorageService.getAccurateRecords()
  );

  // UI state
  const [activeTab, setActiveTab] = useState<AppTab>('scan_log');
  const [viewMode, setViewMode] = useState<'mobile_frame' | 'responsive'>(
    StorageService.getViewMode()
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(StorageService.getSoundEnabled());

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isBarcodeHelperOpen, setIsBarcodeHelperOpen] = useState(false);
  const [isMobileConnectOpen, setIsMobileConnectOpen] = useState(false);
  const [externalBarcodeToScan, setExternalBarcodeToScan] = useState<string | null>(null);

  // Firebase Cloud Auth & Sync States
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudSuccessMsg, setCloudSuccessMsg] = useState<string | null>(null);
  const cloudUnsubRef = useRef<(() => void) | null>(null);

  const lockedCloudOperator = useMemo(
    () => isFirebaseUserBranchLocked(cloudUser, users),
    [cloudUser, users]
  );

  const allowedWarehouses = useMemo(
    () => getAllowedWarehousesForUser(lockedCloudOperator || activeUser),
    [lockedCloudOperator, activeUser]
  );

  const latestLocalStateRef = useRef({
    activeWarehouse,
    activeUser,
    branchLockedOperator: lockedCloudOperator,
    operators: users,
    inventory,
    scanLogs,
    opnameSessions,
    inboundOrders,
    outboundOrders,
    stockCards,
    spreadsheetConfig,
    accurateRecords,
  });

  useEffect(() => {
    latestLocalStateRef.current = {
      activeWarehouse,
      activeUser,
      branchLockedOperator: lockedCloudOperator,
      operators: users,
      inventory,
      scanLogs,
      opnameSessions,
      inboundOrders,
      outboundOrders,
      stockCards,
      spreadsheetConfig,
      accurateRecords,
    };
  }, [
    activeWarehouse,
    activeUser,
    lockedCloudOperator,
    users,
    inventory,
    scanLogs,
    opnameSessions,
    inboundOrders,
    outboundOrders,
    stockCards,
    spreadsheetConfig,
    accurateRecords,
  ]);

  const parseFirestoreErrorDetail = (err: any): { isPermission: boolean; path?: string; op?: string } => {
    const rawMsg = String(err?.message || '');
    const isPermission =
      rawMsg.includes('permission') ||
      rawMsg.includes('PERMISSION_DENIED') ||
      err?.code === 'permission-denied';
    try {
      const parsed = JSON.parse(rawMsg);
      const innerErr = String(parsed?.error || '');
      return {
        isPermission:
          isPermission ||
          innerErr.includes('permission') ||
          innerErr.includes('PERMISSION_DENIED'),
        path: parsed?.path ? String(parsed.path) : undefined,
        op: parsed?.operationType ? String(parsed.operationType) : undefined,
      };
    } catch {
      return { isPermission };
    }
  };

  const runCloudTask = (task: (uid: string) => Promise<void>) => {
    const uid = auth.currentUser?.uid || cloudUser?.uid;
    if (!uid) return;
    task(uid).catch((err) => {
      console.error('Cloud sync error:', err);
      const info = parseFirestoreErrorDetail(err);
      if (info.isPermission && info.path) {
        setCloudError(
          `Izin Firestore ditolak (${info.op || 'write'} di ${info.path}). Pastikan firestore.rules terbaru sudah dipublish di Firebase Console wmsfascoo.`
        );
      } else {
        setCloudError('Sinkronisasi Cloud tertunda. Perubahan tetap tersimpan di HP ini.');
      }
    });
  };

  // Helper to diff inventory lists before writing overrides to Firestore
  const syncInventoryDiff = (prevList: InventoryItem[], nextList: InventoryItem[]) => {
    const prevMap = new Map(prevList.map((i) => [i.sku, i]));
    const nextSkus = new Set(nextList.map((i) => i.sku));
    const changedItems = nextList.filter((item) => {
      const prev = prevMap.get(item.sku);
      if (!prev) return true;
      return (
        prev.barcode !== item.barcode ||
        prev.name !== item.name ||
        prev.category !== item.category ||
        prev.unit !== item.unit ||
        prev.defaultBin !== item.defaultBin ||
        prev.costPrice !== item.costPrice ||
        prev.minStock !== item.minStock ||
        prev.stock['Gudang Pusat'] !== item.stock['Gudang Pusat'] ||
        prev.stock['Gudang Meruya'] !== item.stock['Gudang Meruya'] ||
        prev.stock['Gudang Denpasar'] !== item.stock['Gudang Denpasar'] ||
        prev.stock['Gudang Surabaya'] !== item.stock['Gudang Surabaya']
      );
    });
    const deletedSkus = prevList.filter((i) => !nextSkus.has(i.sku)).map((i) => i.sku);
    if (changedItems.length > 0 || deletedSkus.length > 0) {
      runCloudTask((uid) => syncInventoryItemsToCloud(uid, changedItems, deletedSkus));
    }
  };

  // Subscribe to Firebase Authentication & Real-time Firestore Cloud Sync
  useEffect(() => {
    let active = true;
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }

      setCloudUser(user);
      setIsAuthChecking(false);
      setCloudError(null);

      if (!user) {
        setIsAuthModalOpen(false);
        setActiveUser(null);
        setIsCloudSyncing(false);
        return;
      }

      setIsCloudSyncing(true);
      try {
        const snapshot = latestLocalStateRef.current;
        const lockedOp = isFirebaseUserBranchLocked(user, snapshot.operators);
        const matchedOp = lockedOp || resolveOperatorFromFirebaseUser(user, snapshot.operators);
        const fallbackCustomOp: WarehouseUser = {
          id: `op-fb-${user.uid.slice(0, 8)}`,
          nik: 'STAFF',
          name: user.displayName || user.email?.split('@')[0] || 'Operator Gudang',
          role: 'operator',
          pin: '',
          avatar:
            user.photoURL ||
            'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
          phone: '-',
          assignedWarehouse: snapshot.activeWarehouse || 'Gudang Pusat',
        };
        const initialOp = matchedOp || fallbackCustomOp;
        const allowedForOp = getAllowedWarehousesForUser(initialOp);
        const targetWarehouse =
          matchedOp?.assignedWarehouse ||
          (allowedForOp.includes(snapshot.activeWarehouse)
            ? snapshot.activeWarehouse
            : allowedForOp[0]);

        setActiveUser(initialOp);
        StorageService.setActiveUser(initialOp);
        setActiveWarehouse(targetWarehouse);
        StorageService.setActiveWarehouse(targetWarehouse);

        await ensureUserWorkspace(user, targetWarehouse, initialOp);
        await seedInitialCloudWorkspaceIfEmpty(user.uid, {
          ...snapshot,
          activeWarehouse: targetWarehouse,
          activeUser: initialOp,
          branchLockedOperator: lockedOp,
        });

        if (!active) return;

        cloudUnsubRef.current = subscribeToWarehouseCloud(user.uid, {
          onWorkspace: (ws) => {
            const currentOps = latestLocalStateRef.current.operators;
            const lockedBranchOp = isFirebaseUserBranchLocked(user, currentOps);
            const resolvedOp =
              lockedBranchOp ||
              resolveOperatorFromFirebaseUser(
                { displayName: ws.displayName || user.displayName, email: user.email },
                currentOps
              ) ||
              (ws.activeOperatorId && currentOps.find((u) => u.id === ws.activeOperatorId)) || {
                ...fallbackCustomOp,
                name: ws.displayName || fallbackCustomOp.name,
                assignedWarehouse: ws.activeWarehouse,
              };

            setActiveUser(resolvedOp);
            StorageService.setActiveUser(resolvedOp);

            const allowed = getAllowedWarehousesForUser(resolvedOp);
            const safeWarehouse = allowed.includes(ws.activeWarehouse)
              ? ws.activeWarehouse
              : allowed[0];
            setActiveWarehouse(safeWarehouse);
            StorageService.setActiveWarehouse(safeWarehouse);
          },
          onOperators: (cloudOps) => {
            setUsers(cloudOps);
            StorageService.saveUsers(cloudOps);
          },
          onInventory: (merged) => {
            setInventory(merged);
            StorageService.saveInventory(merged);
          },
          onScanLogs: (logs) => {
            setScanLogs(logs);
            StorageService.saveScanLogs(logs);
          },
          onOpnameSessions: (sessions) => {
            setOpnameSessions(sessions);
            StorageService.saveOpnameSessions(sessions);
          },
          onInboundOrders: (orders) => {
            setInboundOrders(orders);
            StorageService.saveInboundOrders(orders);
          },
          onOutboundOrders: (orders) => {
            setOutboundOrders(orders);
            StorageService.saveOutboundOrders(orders);
          },
          onStockCards: (entries) => {
            setStockCards(entries);
            StorageService.saveStockCards(entries);
          },
          onSpreadsheetConfig: (cfg) => {
            setSpreadsheetConfig(cfg);
            StorageService.saveSpreadsheetConfig(cfg);
          },
          onAccurateRecords: (records) => {
            setAccurateRecords(records);
            StorageService.saveAccurateRecords(records);
          },
        });
      } catch (err: any) {
        console.error('Firebase initialization error:', err);
        if (active) {
          const info = parseFirestoreErrorDetail(err);
          if (info.isPermission) {
            const detail = info.path ? ` (${info.op || 'read/write'} di ${info.path})` : '';
            setCloudError(
              `Akses Firestore ditolak${detail}. Pastikan Rules terbaru (firestore.rules) di Firebase Console wmsfascoo sudah dipublish.`
            );
          } else {
            setCloudError('Gagal menghubungkan Firestore wmsfascoo. Mode lokal tetap berjalan.');
          }
        }
      } finally {
        if (active) {
          setIsCloudSyncing(false);
        }
      }
    });

    return () => {
      active = false;
      unsubAuth();
      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }
    };
  }, []);

  const mapEmailAuthError = (err: any): string => {
    const code = err?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Email atau password salah.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'Email sudah terdaftar. Silakan pindah ke tab "Masuk Akun".';
    }
    if (code === 'auth/weak-password') {
      return 'Password terlalu lemah (minimal 6 karakter).';
    }
    if (code === 'auth/invalid-email') {
      return 'Format alamat email tidak valid.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Terlalu banyak percobaan login. Coba lagi beberapa saat.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Login Email/Password belum aktif di Firebase wmsfascoo. Aktifkan di Authentication → Sign-in method → Email/Password.';
    }
    return err?.message || 'Gagal autentikasi akun Firebase.';
  };

  const handleEmailSignIn = async (email: string, password: string) => {
    setCloudError(null);
    setCloudSuccessMsg(null);
    setIsCloudSyncing(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      soundService.playSuccessChime();
    } catch (err: any) {
      soundService.playErrorBuzz();
      setCloudError(mapEmailAuthError(err));
      setIsCloudSyncing(false);
    }
  };

  const handleEmailRegister = async (
    email: string,
    password: string,
    displayName?: string,
    assignedWarehouse?: WarehouseLocation
  ) => {
    setCloudError(null);
    setCloudSuccessMsg(null);
    setIsCloudSyncing(true);
    try {
      const matchedBefore = resolveOperatorFromFirebaseUser({ displayName, email }, users);
      const effectiveWarehouse =
        matchedBefore?.assignedWarehouse || assignedWarehouse || activeWarehouse;
      setActiveWarehouse(effectiveWarehouse);
      StorageService.setActiveWarehouse(effectiveWarehouse);
      latestLocalStateRef.current.activeWarehouse = effectiveWarehouse;

      if (matchedBefore) {
        setActiveUser(matchedBefore);
        StorageService.setActiveUser(matchedBefore);
        latestLocalStateRef.current.activeUser = matchedBefore;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (cred.user) {
        const finalName = displayName?.trim() || email.split('@')[0] || 'Operator Gudang';
        if (displayName) {
          await updateProfile(cred.user, { displayName: finalName });
        }
        const matchedOp = resolveOperatorFromFirebaseUser(
          { displayName: finalName, email },
          users
        );
        const resolvedNewOp: WarehouseUser = matchedOp || {
          id: `op-fb-${cred.user.uid.slice(0, 8)}`,
          nik: 'STAFF',
          name: finalName,
          role: 'operator',
          pin: '',
          avatar:
            cred.user.photoURL ||
            'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
          phone: '-',
          assignedWarehouse: effectiveWarehouse,
        };
        setActiveUser(resolvedNewOp);
        StorageService.setActiveUser(resolvedNewOp);
        await ensureUserWorkspace(cred.user, effectiveWarehouse, resolvedNewOp);
      }
      soundService.playSuccessChime();
    } catch (err: any) {
      soundService.playErrorBuzz();
      setCloudError(mapEmailAuthError(err));
      setIsCloudSyncing(false);
    }
  };

  const handlePasswordReset = async (email: string) => {
    setCloudError(null);
    setCloudSuccessMsg(null);
    setIsCloudSyncing(true);
    try {
      await sendPasswordResetEmail(auth, email);
      soundService.playSuccessChime();
      setCloudSuccessMsg(`Link reset password telah dikirim ke ${email}. Cek inbox atau folder spam.`);
    } catch (err: any) {
      soundService.playErrorBuzz();
      setCloudError(mapEmailAuthError(err));
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const handleCloudSignOut = async () => {
    setCloudError(null);
    setCloudSuccessMsg(null);
    setIsAuthModalOpen(false);
    try {
      await signOut(auth);
      soundService.playSuccessChime();
    } catch (err: any) {
      setCloudError(err?.message || 'Gagal keluar dari akun Firebase.');
    }
  };

  const handleSyncAllToCloud = async () => {
    const uid = auth.currentUser?.uid || cloudUser?.uid;
    if (!uid) return;
    setCloudError(null);
    setCloudSuccessMsg(null);
    setIsCloudSyncing(true);
    try {
      const res = await syncAllLocalDataToCloud(uid, latestLocalStateRef.current);
      soundService.playSuccessChime();
      setCloudSuccessMsg(
        `Berhasil menyimpan semua data ke Firebase wmsfascoo (${res.inventoryCount} barang, ${res.scanLogCount} scan log, ${res.stockCardCount} kartu stok).`
      );
    } catch (err: any) {
      soundService.playErrorBuzz();
      const info = parseFirestoreErrorDetail(err);
      if (info.isPermission) {
        const detail = info.path ? ` (${info.op || 'write'} di ${info.path})` : '';
        setCloudError(
          `Izin Firestore ditolak${detail}. Pastikan firestore.rules terbaru di Firebase Console wmsfascoo sudah dipublish.`
        );
      } else {
        setCloudError('Gagal mengunggah semua data ke Firebase. Cek koneksi dan Firestore Rules.');
      }
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Sync sound service preference
  useEffect(() => {
    soundService.setSoundEnabled(soundEnabled);
    StorageService.setSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  // Persist states
  const handleUpdateWarehouse = (wh: WarehouseLocation) => {
    if (!allowedWarehouses.includes(wh)) {
      soundService.playErrorBuzz();
      setCloudError(
        `Akses gudang ditolak: ${activeUser?.name || 'Operator'} tidak memiliki izin ke ${wh}.`
      );
      return;
    }
    setActiveWarehouse(wh);
    StorageService.setActiveWarehouse(wh);
    runCloudTask((uid) => updateWorkspaceWarehouseInCloud(uid, wh));
  };

  const handleToggleViewMode = () => {
    const next = viewMode === 'mobile_frame' ? 'responsive' : 'mobile_frame';
    setViewMode(next);
    StorageService.setViewMode(next);
  };

  const handleToggleSound = () => {
    setSoundEnabled((prev) => !prev);
  };

  const handleResetFactoryData = () => {
    const confirmReset = window.confirm(
      'Apakah Anda ingin me-reset semua data gudang ke data bawaan awal?'
    );
    if (!confirmReset) return;

    StorageService.resetAll();
    const resetUsers = StorageService.getUsers();
    const resetActiveUser = lockedCloudOperator || StorageService.getActiveUser();
    const allowed = getAllowedWarehousesForUser(resetActiveUser);
    const storedWh = StorageService.getActiveWarehouse();
    const safeWh = allowed.includes(storedWh) ? storedWh : allowed[0];

    setUsers(resetUsers);
    setInventory(StorageService.getInventory());
    setScanLogs(StorageService.getScanLogs());
    setOpnameSessions(StorageService.getOpnameSessions());
    setInboundOrders(StorageService.getInboundOrders());
    setOutboundOrders(StorageService.getOutboundOrders());
    setStockCards(StorageService.getStockCards());
    setSpreadsheetConfig(StorageService.getSpreadsheetConfig());
    setAccurateRecords(StorageService.getAccurateRecords());
    setActiveUser(resetActiveUser);
    setActiveWarehouse(safeWh);
    soundService.playSuccessChime();
  };

  // Scan Log Handlers (Fase 1)
  const handleSaveScanLog = (newLog: ScanLog) => {
    if (!allowedWarehouses.includes(newLog.warehouse)) {
      soundService.playErrorBuzz();
      setCloudError(
        `Akses ditolak: ${activeUser?.name || 'Operator'} tidak berhak mencatat transaksi di ${newLog.warehouse}.`
      );
      return;
    }
    const updatedLogs = [newLog, ...scanLogs];
    setScanLogs(updatedLogs);
    StorageService.saveScanLogs(updatedLogs);

    // 1. Connect directly to Kartu Stok & Inventory if GR, DO, or Mutasi
    const isGR = newLog.type === 'gr' || newLog.type === 'inbound';
    const isDO = newLog.type === 'do' || newLog.type === 'outbound';
    const isMutasiMasuk = newLog.type === 'mutation_in';
    const isMutasiKeluar = newLog.type === 'mutation_out' || newLog.type === 'relocation';

    let syncedItem: InventoryItem | null = null;
    let createdCardEntry: StockCardEntry | null = null;

    if (isGR || isDO || isMutasiMasuk || isMutasiKeluar) {
      const isIncoming = isGR || isMutasiMasuk;
      const qtyIn = isIncoming ? newLog.quantity : 0;
      const qtyOut = isIncoming ? 0 : newLog.quantity;
      const transType: StockCardTransactionType = isGR
        ? 'GR'
        : isMutasiMasuk
        ? 'MUTASI_MASUK'
        : isDO
        ? 'DO'
        : 'MUTASI_KELUAR';

      let newBalance = 0;
      let matchedFound = false;

      // Update Inventory
      const updatedInventory = inventory.map((inv) => {
        if (inv.sku === newLog.sku || inv.barcode === newLog.barcode) {
          matchedFound = true;
          const currentQty = inv.stock[newLog.warehouse] || 0;
          newBalance = isIncoming
            ? currentQty + newLog.quantity
            : Math.max(0, currentQty - newLog.quantity);
          const nextItem = {
            ...inv,
            stock: {
              ...inv.stock,
              [newLog.warehouse]: newBalance,
            },
          };
          syncedItem = nextItem;
          return nextItem;
        }
        return inv;
      });

      // If item was not in inventory (e.g. newly scanned item), add it to inventory
      let finalInventory = updatedInventory;
      if (!matchedFound) {
        newBalance = isIncoming ? newLog.quantity : 0;
        const newItem: InventoryItem = {
          sku: newLog.sku,
          barcode: newLog.barcode,
          name: newLog.name,
          category: 'Penerimaan Langsung (GR)',
          unit: 'Pcs',
          defaultBin: newLog.binLocation || 'A-01-01',
          stock: {
            'Gudang Pusat': newLog.warehouse === 'Gudang Pusat' ? newBalance : 0,
            'Gudang Meruya': newLog.warehouse === 'Gudang Meruya' ? newBalance : 0,
            'Gudang Denpasar': newLog.warehouse === 'Gudang Denpasar' ? newBalance : 0,
            'Gudang Surabaya': newLog.warehouse === 'Gudang Surabaya' ? newBalance : 0,
          },
          minStock: 10,
        };
        syncedItem = newItem;
        finalInventory = [newItem, ...updatedInventory];
      }

      setInventory(finalInventory);
      StorageService.saveInventory(finalInventory);

      // Create & Add Stock Card Entry
      const newCardEntry: StockCardEntry = {
        id: 'sc-scan-' + Date.now(),
        date: newLog.timestamp.slice(0, 16),
        sku: newLog.sku,
        name: newLog.name,
        warehouse: newLog.warehouse,
        referenceNo: newLog.referenceNo || newLog.barcode,
        transactionType: transType,
        qtyIn,
        qtyOut,
        balanceAfter: newBalance,
        operator: newLog.operatorName || activeUser?.name || 'Nazar Prabowo',
        notes: newLog.notes || (isGR ? 'Scan Barang Masuk (GR)' : isDO ? 'Scan Barang Keluar (DO)' : 'Scan Mutasi Gudang'),
      };
      createdCardEntry = newCardEntry;

      const updatedCards = [newCardEntry, ...stockCards];
      setStockCards(updatedCards);
      StorageService.saveStockCards(updatedCards);
    }

    // Queue for spreadsheet
    const queueItem: SyncQueueItem = {
      id: 'q-' + Date.now(),
      type: (newLog.type || 'GR').toUpperCase(),
      barcode: newLog.barcode,
      binLocation: newLog.binLocation,
      referenceNo: newLog.referenceNo || newLog.barcode,
      sku: newLog.sku,
      name: newLog.name,
      quantity: newLog.quantity,
      warehouse: newLog.warehouse,
      operator: newLog.operatorName,
      timestamp: newLog.timestamp,
      notes: newLog.notes,
      status: spreadsheetConfig.autoSync ? 'synced' : 'pending',
    };

    const updatedQueue = [queueItem, ...spreadsheetConfig.queue];
    const updatedConfig = {
      ...spreadsheetConfig,
      queue: updatedQueue,
      lastSyncTime: spreadsheetConfig.autoSync
        ? new Date().toISOString().replace('T', ' ').slice(0, 19)
        : spreadsheetConfig.lastSyncTime,
    };
    setSpreadsheetConfig(updatedConfig);
    StorageService.saveSpreadsheetConfig(updatedConfig);

    // Sync transaction to Firestore Cloud
    runCloudTask(async (uid) => {
      await syncScanLogToCloud(uid, newLog);
      if (syncedItem) {
        await syncInventoryItemsToCloud(uid, [syncedItem]);
      }
      if (createdCardEntry) {
        await syncStockCardsToCloud(uid, [createdCardEntry]);
      }
      await syncQueueItemsToCloud(uid, [queueItem], false);
    });
  };

  const handleDeleteScanLog = (id: string) => {
    const updated = scanLogs.filter((l) => l.id !== id);
    setScanLogs(updated);
    StorageService.saveScanLogs(updated);
    runCloudTask((uid) => deleteScanLogFromCloud(uid, id));
  };

  // Stock Opname Handlers (Fase 1)
  const handleSaveOpnameSessions = (sessions: OpnameSession[]) => {
    const prevMap = new Map(opnameSessions.map((s) => [s.id, s]));
    setOpnameSessions(sessions);
    StorageService.saveOpnameSessions(sessions);

    sessions.forEach((sess) => {
      const prev = prevMap.get(sess.id);
      if (prev?.status === 'completed' && sess.status === 'completed') return;
      if (!prev || JSON.stringify(prev) !== JSON.stringify(sess)) {
        const prevCountMap = new Map((prev?.items || []).map((it) => [it.sku, it]));
        const changedCounts = sess.items.filter((it) => {
          const p = prevCountMap.get(it.sku);
          if (!p) return Boolean(it.lastScannedAt) || it.physicalCount > 0;
          return (
            p.physicalCount !== it.physicalCount ||
            p.lastScannedAt !== it.lastScannedAt ||
            p.notes !== it.notes
          );
        });
        runCloudTask((uid) => syncOpnameSessionToCloud(uid, sess, changedCounts));
      }
    });
  };

  const handleApplyOpnameAdjustment = (session: OpnameSession) => {
    if (!allowedWarehouses.includes(session.warehouse)) {
      soundService.playErrorBuzz();
      setCloudError(
        `Akses ditolak: ${activeUser?.name || 'Operator'} tidak berhak memproses opname di ${session.warehouse}.`
      );
      return;
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const changedInventoryItems: InventoryItem[] = [];

    // 1. Update Inventory stock
    const updatedInventory = inventory.map((inv) => {
      const counted = session.items.find((it) => it.sku === inv.sku);
      if (counted && counted.lastScannedAt) {
        const nextInv = {
          ...inv,
          stock: {
            ...inv.stock,
            [session.warehouse]: counted.physicalCount,
          },
        };
        changedInventoryItems.push(nextInv);
        return nextInv;
      }
      return inv;
    });
    setInventory(updatedInventory);
    StorageService.saveInventory(updatedInventory);

    // 2. Generate stock card entries for variances
    const newCardEntries: StockCardEntry[] = [];
    session.items.forEach((item) => {
      if (item.difference !== 0) {
        newCardEntries.push({
          id: 'sc-opn-' + Date.now() + '-' + item.sku,
          date: now,
          sku: item.sku,
          name: item.name,
          warehouse: session.warehouse,
          referenceNo: session.code,
          transactionType: 'OPNAME_ADJUSTMENT',
          qtyIn: item.difference > 0 ? item.difference : 0,
          qtyOut: item.difference < 0 ? Math.abs(item.difference) : 0,
          balanceAfter: item.physicalCount,
          operator: activeUser?.name || 'Supervisor',
          notes: `Hasil Opname Fisik: Selisih ${item.difference > 0 ? '+' : ''}${item.difference} (${item.notes || 'Penyesuaian'})`,
        });
      }
    });

    const updatedStockCards = [...newCardEntries, ...stockCards];
    setStockCards(updatedStockCards);
    StorageService.saveStockCards(updatedStockCards);

    // 3. Mark session completed
    const completedSession: OpnameSession = {
      ...session,
      status: 'completed',
      completedAt: now,
      approvedBy: activeUser?.name || 'Supervisor Gudang',
    };
    const updatedSessions = opnameSessions.map((s) =>
      s.id === session.id ? completedSession : s
    );
    setOpnameSessions(updatedSessions);
    StorageService.saveOpnameSessions(updatedSessions);

    // 4. Queue spreadsheet sync
    const queueItem: SyncQueueItem = {
      id: 'q-opn-' + Date.now(),
      type: 'OPNAME_RESULT',
      referenceNo: session.code,
      sku: 'ALL_BATCH',
      name: session.title,
      quantity: session.items.reduce((acc, it) => acc + Math.abs(it.difference), 0),
      warehouse: session.warehouse,
      operator: activeUser?.name || 'Supervisor',
      timestamp: now,
      status: spreadsheetConfig.autoSync ? 'synced' : 'pending',
    };
    const updatedConfig = {
      ...spreadsheetConfig,
      queue: [queueItem, ...spreadsheetConfig.queue],
    };
    setSpreadsheetConfig(updatedConfig);
    StorageService.saveSpreadsheetConfig(updatedConfig);

    runCloudTask(async (uid) => {
      if (changedInventoryItems.length > 0) {
        await syncInventoryItemsToCloud(uid, changedInventoryItems);
      }
      if (newCardEntries.length > 0) {
        await syncStockCardsToCloud(uid, newCardEntries);
      }
      await syncOpnameSessionToCloud(uid, completedSession, []);
      await syncQueueItemsToCloud(uid, [queueItem], false);
    });

    confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
    alert(`Hasil opname ${session.code} berhasil diterapkan ke Saldo Stok dan Kartu Stok!`);
  };

  // Inbound Handlers (Fase 2)
  const handleSaveInboundOrders = (orders: InboundOrder[]) => {
    const prevMap = new Map(inboundOrders.map((o) => [o.id, o]));
    setInboundOrders(orders);
    StorageService.saveInboundOrders(orders);

    orders.forEach((ord) => {
      const prev = prevMap.get(ord.id);
      if (prev?.status === 'completed' && ord.status === 'completed') return;
      if (!prev || JSON.stringify(prev) !== JSON.stringify(ord)) {
        runCloudTask((uid) => syncInboundOrderToCloud(uid, ord));
      }
    });
  };

  const handleConfirmInboundReceipt = (order: InboundOrder) => {
    if (!allowedWarehouses.includes(order.warehouse)) {
      soundService.playErrorBuzz();
      setCloudError(
        `Akses ditolak: ${activeUser?.name || 'Operator'} tidak berhak memproses GR di ${order.warehouse}.`
      );
      return;
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const changedInventoryItems: InventoryItem[] = [];

    // 1. Update inventory
    const updatedInventory = inventory.map((inv) => {
      const receivedLine = order.items.find((it) => it.sku === inv.sku);
      if (receivedLine && receivedLine.receivedQty > 0) {
        const currentQty = inv.stock[order.warehouse] || 0;
        const nextInv = {
          ...inv,
          stock: {
            ...inv.stock,
            [order.warehouse]: currentQty + receivedLine.receivedQty,
          },
        };
        changedInventoryItems.push(nextInv);
        return nextInv;
      }
      return inv;
    });
    setInventory(updatedInventory);
    StorageService.saveInventory(updatedInventory);

    // 2. Generate stock card entries
    const newCardEntries: StockCardEntry[] = [];
    order.items.forEach((item) => {
      if (item.receivedQty > 0) {
        const matched = updatedInventory.find((i) => i.sku === item.sku);
        const bal = matched ? matched.stock[order.warehouse] : item.receivedQty;

        newCardEntries.push({
          id: 'sc-in-' + Date.now() + '-' + item.sku,
          date: now,
          sku: item.sku,
          name: item.name,
          warehouse: order.warehouse,
          referenceNo: order.poNumber,
          transactionType: 'INBOUND',
          qtyIn: item.receivedQty,
          qtyOut: 0,
          balanceAfter: bal,
          operator: activeUser?.name || order.receiverOperator,
          notes: `Penerimaan dari ${order.supplier} (SJ: ${order.suratJalanNumber})`,
        });
      }
    });

    const updatedCards = [...newCardEntries, ...stockCards];
    setStockCards(updatedCards);
    StorageService.saveStockCards(updatedCards);

    // 3. Mark PO completed
    const completedOrder: InboundOrder = {
      ...order,
      status: 'completed',
      receivedAt: now,
    };
    const updatedOrders = inboundOrders.map((o) =>
      o.id === order.id ? completedOrder : o
    );
    setInboundOrders(updatedOrders);
    StorageService.saveInboundOrders(updatedOrders);

    // 4. Add to sync queue
    const queueItems: SyncQueueItem[] = order.items.map((it) => ({
      id: 'q-in-' + Date.now() + '-' + it.sku,
      type: 'BARANG_MASUK',
      referenceNo: order.poNumber,
      sku: it.sku,
      name: it.name,
      quantity: it.receivedQty,
      warehouse: order.warehouse,
      operator: activeUser?.name || order.receiverOperator,
      timestamp: now,
      status: spreadsheetConfig.autoSync ? 'synced' : 'pending',
    }));

    const updatedConfig = {
      ...spreadsheetConfig,
      queue: [...queueItems, ...spreadsheetConfig.queue],
    };
    setSpreadsheetConfig(updatedConfig);
    StorageService.saveSpreadsheetConfig(updatedConfig);

    runCloudTask(async (uid) => {
      if (changedInventoryItems.length > 0) {
        await syncInventoryItemsToCloud(uid, changedInventoryItems);
      }
      if (newCardEntries.length > 0) {
        await syncStockCardsToCloud(uid, newCardEntries);
      }
      await syncInboundOrderToCloud(uid, completedOrder);
      if (queueItems.length > 0) {
        await syncQueueItemsToCloud(uid, queueItems, false);
      }
    });

    confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    alert(`Barang Masuk untuk ${order.poNumber} berhasil diselesaikan & stok bertambah!`);
  };

  // Outbound Handlers (Fase 2)
  const handleSaveOutboundOrders = (orders: OutboundOrder[]) => {
    const prevMap = new Map(outboundOrders.map((o) => [o.id, o]));
    setOutboundOrders(orders);
    StorageService.saveOutboundOrders(orders);

    orders.forEach((ord) => {
      const prev = prevMap.get(ord.id);
      if (prev?.status === 'dispatched' && ord.status === 'dispatched') return;
      if (!prev || JSON.stringify(prev) !== JSON.stringify(ord)) {
        runCloudTask((uid) => syncOutboundOrderToCloud(uid, ord));
      }
    });
  };

  const handleConfirmOutboundDispatch = (order: OutboundOrder) => {
    if (!allowedWarehouses.includes(order.warehouse)) {
      soundService.playErrorBuzz();
      setCloudError(
        `Akses ditolak: ${activeUser?.name || 'Operator'} tidak berhak memproses DO di ${order.warehouse}.`
      );
      return;
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const changedInventoryItems: InventoryItem[] = [];

    // 1. Update inventory
    const updatedInventory = inventory.map((inv) => {
      const pickedLine = order.items.find((it) => it.sku === inv.sku);
      if (pickedLine && pickedLine.pickedQty > 0) {
        const currentQty = inv.stock[order.warehouse] || 0;
        const nextInv = {
          ...inv,
          stock: {
            ...inv.stock,
            [order.warehouse]: Math.max(0, currentQty - pickedLine.pickedQty),
          },
        };
        changedInventoryItems.push(nextInv);
        return nextInv;
      }
      return inv;
    });
    setInventory(updatedInventory);
    StorageService.saveInventory(updatedInventory);

    // 2. Generate stock card entries
    const newCardEntries: StockCardEntry[] = [];
    order.items.forEach((item) => {
      if (item.pickedQty > 0) {
        const matched = updatedInventory.find((i) => i.sku === item.sku);
        const bal = matched ? matched.stock[order.warehouse] : 0;

        newCardEntries.push({
          id: 'sc-out-' + Date.now() + '-' + item.sku,
          date: now,
          sku: item.sku,
          name: item.name,
          warehouse: order.warehouse,
          referenceNo: order.doNumber,
          transactionType: 'OUTBOUND',
          qtyIn: 0,
          qtyOut: item.pickedQty,
          balanceAfter: bal,
          operator: activeUser?.name || order.pickerOperator,
          notes: `Pengeluaran ${order.purpose} ke ${order.destination} (${order.driverName})`,
        });
      }
    });

    const updatedCards = [...newCardEntries, ...stockCards];
    setStockCards(updatedCards);
    StorageService.saveStockCards(updatedCards);

    // 3. Mark DO as dispatched
    const dispatchedOrder: OutboundOrder = {
      ...order,
      status: 'dispatched',
      dispatchedAt: now,
    };
    const updatedOrders = outboundOrders.map((o) =>
      o.id === order.id ? dispatchedOrder : o
    );
    setOutboundOrders(updatedOrders);
    StorageService.saveOutboundOrders(updatedOrders);

    // 4. Add to sync queue
    const queueItems: SyncQueueItem[] = order.items.map((it) => ({
      id: 'q-out-' + Date.now() + '-' + it.sku,
      type: 'BARANG_KELUAR',
      referenceNo: order.doNumber,
      sku: it.sku,
      name: it.name,
      quantity: it.pickedQty,
      warehouse: order.warehouse,
      operator: activeUser?.name || order.pickerOperator,
      timestamp: now,
      status: spreadsheetConfig.autoSync ? 'synced' : 'pending',
    }));

    const updatedConfig = {
      ...spreadsheetConfig,
      queue: [...queueItems, ...spreadsheetConfig.queue],
    };
    setSpreadsheetConfig(updatedConfig);
    StorageService.saveSpreadsheetConfig(updatedConfig);

    runCloudTask(async (uid) => {
      if (changedInventoryItems.length > 0) {
        await syncInventoryItemsToCloud(uid, changedInventoryItems);
      }
      if (newCardEntries.length > 0) {
        await syncStockCardsToCloud(uid, newCardEntries);
      }
      await syncOutboundOrderToCloud(uid, dispatchedOrder);
      if (queueItems.length > 0) {
        await syncQueueItemsToCloud(uid, queueItems, false);
      }
    });

    confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    alert(`Barang Keluar untuk ${order.doNumber} berhasil dikonfirmasi & stok berkurang!`);
  };

  // Spreadsheet Sync Handlers (Fase 3)
  const handleUpdateSpreadsheetConfig = (cfg: SpreadsheetSyncConfig) => {
    setSpreadsheetConfig(cfg);
    StorageService.saveSpreadsheetConfig(cfg);
    runCloudTask((uid) => syncSpreadsheetSettingsToCloud(uid, cfg));
  };

  const handlePushQueueToSheet = () => {
    const pendingToUpdate = spreadsheetConfig.queue
      .filter((q) => q.status === 'pending')
      .map((q) => ({ ...q, status: 'synced' as const }));

    const updatedQueue = spreadsheetConfig.queue.map((q) => ({
      ...q,
      status: 'synced' as const,
    }));
    const updatedConfig: SpreadsheetSyncConfig = {
      ...spreadsheetConfig,
      queue: updatedQueue,
      lastSyncTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: 'connected',
    };
    setSpreadsheetConfig(updatedConfig);
    StorageService.saveSpreadsheetConfig(updatedConfig);

    // Also mark scan logs as synced
    const unsyncedLogs = scanLogs.filter((l) => !l.syncedToSheet);
    const updatedLogs = scanLogs.map((l) => ({ ...l, syncedToSheet: true }));
    setScanLogs(updatedLogs);
    StorageService.saveScanLogs(updatedLogs);

    runCloudTask(async (uid) => {
      await syncSpreadsheetSettingsToCloud(uid, updatedConfig);
      if (pendingToUpdate.length > 0) {
        await syncQueueItemsToCloud(uid, pendingToUpdate, true);
      }
      if (unsyncedLogs.length > 0) {
        await markScanLogsSyncedInCloud(uid, unsyncedLogs);
      }
    });

    confetti({ particleCount: 40, spread: 50, origin: { y: 0.5 } });
  };

  // Manual Stock Card Mutation Handler
  const handleManualStockMutation = (mutation: {
    sku: string;
    transactionType:
      | 'GR'
      | 'DO'
      | 'MUTASI_MASUK'
      | 'MUTASI_KELUAR'
      | 'INBOUND'
      | 'OUTBOUND'
      | 'OPNAME_ADJUSTMENT'
      | 'OPNAME_RECONSEL';
    referenceNo: string;
    notes: string;
    qtyIn: number;
    qtyOut: number;
    warehouse: WarehouseLocation;
    date: string;
  }) => {
    if (!allowedWarehouses.includes(mutation.warehouse)) {
      soundService.playErrorBuzz();
      setCloudError(
        `Akses ditolak: ${activeUser?.name || 'Operator'} tidak berhak mencatat mutasi stok di ${mutation.warehouse}.`
      );
      return;
    }
    // 1. Update inventory stock
    let changedItem: InventoryItem | null = null;
    const updatedInventory = inventory.map((inv) => {
      if (inv.sku === mutation.sku) {
        const cur = inv.stock[mutation.warehouse] || 0;
        const newBalance = Math.max(0, cur + mutation.qtyIn - mutation.qtyOut);
        const nextInv = {
          ...inv,
          stock: {
            ...inv.stock,
            [mutation.warehouse]: newBalance,
          },
        };
        changedItem = nextInv;
        return nextInv;
      }
      return inv;
    });
    setInventory(updatedInventory);
    StorageService.saveInventory(updatedInventory);

    // 2. Add Stock Card Entry
    const matched = updatedInventory.find((i) => i.sku === mutation.sku);
    const newBalance = matched ? matched.stock[mutation.warehouse] : 0;
    const newEntry: StockCardEntry = {
      id: 'sc-man-' + Date.now(),
      date: mutation.date,
      sku: mutation.sku,
      name: matched?.name || mutation.sku,
      warehouse: mutation.warehouse,
      referenceNo: mutation.referenceNo,
      transactionType: mutation.transactionType,
      qtyIn: mutation.qtyIn,
      qtyOut: mutation.qtyOut,
      balanceAfter: newBalance,
      operator: activeUser?.name || 'Operator Gudang',
      notes: mutation.notes,
    };
    const updatedCards = [...stockCards, newEntry];
    setStockCards(updatedCards);
    StorageService.saveStockCards(updatedCards);

    // 3. Queue Spreadsheet Sync
    const queueItem: SyncQueueItem = {
      id: 'q-sc-' + Date.now(),
      type: mutation.qtyIn > 0 ? 'BARANG_MASUK' : 'BARANG_KELUAR',
      referenceNo: mutation.referenceNo,
      sku: mutation.sku,
      name: matched?.name || mutation.sku,
      quantity: mutation.qtyIn > 0 ? mutation.qtyIn : mutation.qtyOut,
      warehouse: mutation.warehouse,
      operator: activeUser?.name || 'Operator Gudang',
      timestamp: mutation.date,
      status: spreadsheetConfig.autoSync ? 'synced' : 'pending',
    };
    const updatedConfig = {
      ...spreadsheetConfig,
      queue: [queueItem, ...spreadsheetConfig.queue],
    };
    setSpreadsheetConfig(updatedConfig);
    StorageService.saveSpreadsheetConfig(updatedConfig);

    runCloudTask(async (uid) => {
      if (changedItem) {
        await syncInventoryItemsToCloud(uid, [changedItem]);
      }
      await syncStockCardsToCloud(uid, [newEntry]);
      await syncQueueItemsToCloud(uid, [queueItem], false);
    });
  };

  // Accurate Handlers (Fase 3)
  const handleUpdateAccurateRecords = (records: AccurateItemRecord[]) => {
    setAccurateRecords(records);
    StorageService.saveAccurateRecords(records);
    runCloudTask((uid) => syncAccurateRecordsToCloud(uid, records));
  };

  // Barcode helper tap handler
  const handleSelectBarcodeFromHelper = (barcode: string) => {
    setExternalBarcodeToScan(barcode);
  };

  // Hardware scan button simulation (cycles through available barcodes)
  const handleHardwareScanTrigger = () => {
    const randomItem = inventory[Math.floor(Math.random() * inventory.length)];
    if (randomItem) {
      setExternalBarcodeToScan(randomItem.barcode);
    }
  };

  const pendingSyncCount = spreadsheetConfig.queue.filter((q) => q.status === 'pending').length;

  // Items reaching or dropping below minimum threshold in active warehouse
  const lowStockCount = useMemo(() => {
    return inventory.filter(
      (item) => (item.stock[activeWarehouse] || 0) <= getItemMinStock(item, activeWarehouse)
    ).length;
  }, [inventory, activeWarehouse]);

  return (
    <MobileFrame
      viewMode={viewMode}
      onHardwareScanTrigger={cloudUser ? handleHardwareScanTrigger : undefined}
    >
      {isAuthChecking ? (
        <div className="flex-1 w-full min-h-full bg-zinc-950 text-white flex flex-col items-center justify-center gap-3 p-6">
          <Loader2 className="w-7 h-7 animate-spin text-[#C6F232]" />
          <p className="text-xs text-zinc-400 font-medium">Memeriksa sesi akun...</p>
        </div>
      ) : !cloudUser ? (
        <LoginScreen
          isLoading={isCloudSyncing}
          error={cloudError}
          successMsg={cloudSuccessMsg}
          onSignIn={handleEmailSignIn}
          onRegister={handleEmailRegister}
          onPasswordReset={handlePasswordReset}
        />
      ) : (
        <>
          {/* Sticky Header */}
          <HeaderNav
            activeWarehouse={activeWarehouse}
            onChangeWarehouse={handleUpdateWarehouse}
            activeUser={activeUser}
            allowedWarehouses={allowedWarehouses}
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onOpenBarcodeHelper={() => setIsBarcodeHelperOpen(true)}
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onResetFactoryData={handleResetFactoryData}
        lowStockCount={lowStockCount}
        onOpenStockCard={() => setActiveTab('stock_card')}
        onOpenMobileConnect={() => setIsMobileConnectOpen(true)}
        cloudUserEmail={cloudUser?.email || null}
        isCloudSyncing={isCloudSyncing}
      />

      {/* Main Tab Viewport */}
      <main className="flex-1 w-full p-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] overflow-y-auto">
        {activeTab === 'scan_log' && (
          <ScanLogTab
            inventory={inventory}
            scanLogs={scanLogs}
            onSaveScanLog={handleSaveScanLog}
            onDeleteScanLog={handleDeleteScanLog}
            activeWarehouse={activeWarehouse}
            activeUser={activeUser || users[0]}
            onOpenTestBarcodes={() => setIsBarcodeHelperOpen(true)}
            externalBarcodeToScan={externalBarcodeToScan}
            onClearExternalBarcode={() => setExternalBarcodeToScan(null)}
            onNavigateToInbound={() => setActiveTab('inbound')}
            onNavigateToOutbound={() => setActiveTab('outbound')}
            onNavigateToOpname={() => setActiveTab('opname')}
            onNavigateToStockCard={() => setActiveTab('stock_card')}
          />
        )}

        {activeTab === 'opname' && (
          <StockOpnameTab
            inventory={inventory}
            opnameSessions={opnameSessions}
            onSaveOpnameSessions={handleSaveOpnameSessions}
            activeWarehouse={activeWarehouse}
            activeUser={activeUser || users[0]}
            onOpenTestBarcodes={() => setIsBarcodeHelperOpen(true)}
            onApplyOpnameAdjustment={handleApplyOpnameAdjustment}
            externalBarcodeToScan={externalBarcodeToScan}
            onClearExternalBarcode={() => setExternalBarcodeToScan(null)}
          />
        )}

        {activeTab === 'inbound' && (
          <InboundTab
            inventory={inventory}
            inboundOrders={inboundOrders}
            onSaveInboundOrders={handleSaveInboundOrders}
            onConfirmInboundReceipt={handleConfirmInboundReceipt}
            activeWarehouse={activeWarehouse}
            activeUser={activeUser || users[0]}
            onOpenTestBarcodes={() => setIsBarcodeHelperOpen(true)}
            externalBarcodeToScan={externalBarcodeToScan}
            onClearExternalBarcode={() => setExternalBarcodeToScan(null)}
          />
        )}

        {activeTab === 'outbound' && (
          <OutboundTab
            inventory={inventory}
            outboundOrders={outboundOrders}
            onSaveOutboundOrders={handleSaveOutboundOrders}
            onConfirmOutboundDispatch={handleConfirmOutboundDispatch}
            onLinkItemBarcode={(sku, barcode) => {
              const updated = inventory.map((item) =>
                item.sku === sku ? { ...item, barcode } : item
              );
              syncInventoryDiff(inventory, updated);
              setInventory(updated);
              StorageService.saveInventory(updated);
            }}
            activeWarehouse={activeWarehouse}
            activeUser={activeUser || users[0]}
            onOpenTestBarcodes={() => setIsBarcodeHelperOpen(true)}
            externalBarcodeToScan={externalBarcodeToScan}
            onClearExternalBarcode={() => setExternalBarcodeToScan(null)}
          />
        )}

        {activeTab === 'stock_card' && (
          <StockCardTab
            inventory={inventory}
            stockCards={stockCards}
            activeWarehouse={activeWarehouse}
            allowedWarehouses={allowedWarehouses}
            onChangeWarehouse={handleUpdateWarehouse}
            onAddManualMutation={handleManualStockMutation}
          />
        )}

        {activeTab === 'sync' && (
          <SyncSpreadsheetTab
            config={spreadsheetConfig}
            onUpdateConfig={handleUpdateSpreadsheetConfig}
            onPushQueueToSheet={handlePushQueueToSheet}
            onUpdateInventory={(updatedItems) => {
              syncInventoryDiff(inventory, updatedItems);
              setInventory(updatedItems);
              StorageService.saveInventory(updatedItems);
            }}
            inventory={inventory}
            scanLogs={scanLogs}
            stockCards={stockCards}
            cloudUserEmail={cloudUser?.email || null}
            onOpenCloudLogin={() => setIsAuthModalOpen(true)}
          />
        )}

        {activeTab === 'accurate' && (
          <AccurateReconciliationTab
            inventory={inventory}
            accurateRecords={accurateRecords}
            onUpdateAccurateRecords={handleUpdateAccurateRecords}
            activeWarehouse={activeWarehouse}
          />
        )}
      </main>

      {/* Sticky Bottom Navigation Bar */}
      <BottomNavBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingSyncCount={pendingSyncCount}
      />

      {/* Global Modals */}
      <BarcodeHelperModal
        isOpen={isBarcodeHelperOpen}
        onClose={() => setIsBarcodeHelperOpen(false)}
        items={inventory}
        onSelectBarcode={handleSelectBarcodeFromHelper}
        activeWarehouse={activeWarehouse}
        onSaveNewItem={(newItem) => {
          const updated = [newItem, ...inventory.filter((i) => i.sku !== newItem.sku && i.barcode !== newItem.barcode)];
          syncInventoryDiff(inventory, updated);
          setInventory(updated);
          StorageService.saveInventory(updated);
        }}
        onImportItems={(importedItems, replaceAll) => {
          let updated: InventoryItem[];
          if (replaceAll) {
            updated = importedItems;
          } else {
            const existingSkus = new Set(importedItems.map((i) => i.sku));
            const existingBarcodes = new Set(importedItems.map((i) => i.barcode));
            const preserved = inventory.filter(
              (i) => !existingSkus.has(i.sku) && !existingBarcodes.has(i.barcode)
            );
            updated = [...importedItems, ...preserved];
          }
          syncInventoryDiff(inventory, updated);
          setInventory(updated);
          StorageService.saveInventory(updated);
        }}
        onDeleteItem={(sku) => {
          const updated = inventory.filter((i) => i.sku !== sku);
          setInventory(updated);
          StorageService.saveInventory(updated);
          runCloudTask((uid) => syncInventoryItemsToCloud(uid, [], [sku]));
        }}
        onOpenSpreadsheetTab={() => {
          setIsBarcodeHelperOpen(false);
          setActiveTab('sync');
        }}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        activeUser={activeUser}
        lockedCloudOperator={lockedCloudOperator}
        cloudUser={cloudUser}
        isCloudSyncing={isCloudSyncing}
        cloudError={cloudError}
        cloudSuccessMsg={cloudSuccessMsg}
        totalInventoryCount={inventory.length}
        onCloudSignOut={handleCloudSignOut}
        onSyncAllToCloud={handleSyncAllToCloud}
      />

      <MobileConnectModal
        isOpen={isMobileConnectOpen}
        onClose={() => setIsMobileConnectOpen(false)}
      />
        </>
      )}
    </MobileFrame>
  );
}
