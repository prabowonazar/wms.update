import {
  WarehouseUser,
  InventoryItem,
  ScanLog,
  OpnameSession,
  InboundOrder,
  OutboundOrder,
  StockCardEntry,
  SpreadsheetSyncConfig,
  AccurateItemRecord,
  WarehouseLocation,
} from '../types/warehouse';
import {
  INITIAL_USERS,
  INITIAL_INVENTORY,
  INITIAL_SCAN_LOGS,
  INITIAL_OPNAME_SESSIONS,
  INITIAL_INBOUND_ORDERS,
  INITIAL_OUTBOUND_ORDERS,
  INITIAL_STOCK_CARD_ENTRIES,
  INITIAL_SPREADSHEET_CONFIG,
  INITIAL_ACCURATE_RECORDS,
} from '../data/mockWarehouseData';

const KEYS = {
  USERS: 'scangudang_users',
  ACTIVE_USER: 'scangudang_active_user',
  ACTIVE_WAREHOUSE: 'scangudang_active_warehouse',
  INVENTORY: 'scangudang_inventory',
  SCAN_LOGS: 'scangudang_scan_logs',
  OPNAME_SESSIONS: 'scangudang_opname_sessions',
  ACTIVE_OPNAME_ID: 'scangudang_active_opname_id',
  INBOUND_ORDERS: 'scangudang_inbound_orders',
  OUTBOUND_ORDERS: 'scangudang_outbound_orders',
  STOCK_CARDS: 'scangudang_stock_cards',
  SPREADSHEET_CONFIG: 'scangudang_spreadsheet_config',
  ACCURATE_RECORDS: 'scangudang_accurate_records',
  VIEW_MODE: 'scangudang_view_mode',
  SOUND_ENABLED: 'scangudang_sound_enabled',
};

const DUMMY_CLEANUP_KEY = 'scangudang_dummy_cleanup_rev';
const CURRENT_DUMMY_CLEANUP_REV = 'cleanup_dummy_20261125_v1';

const DUMMY_SCAN_LOG_IDS = new Set([
  'scan-101',
  'scan-102',
  'scan-103',
  'scan-104',
  'scan-105',
  'scan-106',
]);
const DUMMY_OPNAME_IDS = new Set(['opname-001']);
const DUMMY_INBOUND_IDS = new Set(['inbound-01', 'inbound-02']);
const DUMMY_OUTBOUND_IDS = new Set(['outbound-01']);
const DUMMY_STOCK_CARD_IDS = new Set([
  'sc-01',
  'sc-02',
  'sc-03',
  'sc-04',
  'sc-11',
  'sc-12',
  'sc-13',
  'sc-21',
  'sc-22',
  'sc-23',
  'sc-31',
  'sc-32',
]);
const DUMMY_QUEUE_IDS = new Set(['q-01', 'q-02']);
const DUMMY_ACCURATE_SKUS = new Set([
  'EL-001',
  'EL-002',
  'MC-101',
  'MC-102',
  'PC-301',
  'PC-302',
  'SF-501',
  'SF-502',
]);
const DUMMY_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

export class StorageService {
  private static dummyCleaned = false;

  private static getItem<T>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private static setItem<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or quota exceeded
    }
  }

  private static ensureDummyCleaned(): void {
    if (typeof window === 'undefined' || this.dummyCleaned) return;
    this.dummyCleaned = true;

    const currentRev = localStorage.getItem(DUMMY_CLEANUP_KEY);
    if (currentRev === CURRENT_DUMMY_CLEANUP_REV) return;

    // Strip known dummy records from localStorage while preserving any real user transactions
    const logs = this.getItem<ScanLog[]>(KEYS.SCAN_LOGS, []);
    this.setItem(
      KEYS.SCAN_LOGS,
      logs.filter((l) => !DUMMY_SCAN_LOG_IDS.has(l.id))
    );

    const opnames = this.getItem<OpnameSession[]>(KEYS.OPNAME_SESSIONS, []);
    this.setItem(
      KEYS.OPNAME_SESSIONS,
      opnames.filter((s) => !DUMMY_OPNAME_IDS.has(s.id))
    );

    const inbounds = this.getItem<InboundOrder[]>(KEYS.INBOUND_ORDERS, []);
    this.setItem(
      KEYS.INBOUND_ORDERS,
      inbounds.filter((o) => !DUMMY_INBOUND_IDS.has(o.id))
    );

    const outbounds = this.getItem<OutboundOrder[]>(KEYS.OUTBOUND_ORDERS, []);
    this.setItem(
      KEYS.OUTBOUND_ORDERS,
      outbounds.filter((o) => !DUMMY_OUTBOUND_IDS.has(o.id))
    );

    const cards = this.getItem<StockCardEntry[]>(KEYS.STOCK_CARDS, []);
    this.setItem(
      KEYS.STOCK_CARDS,
      cards.filter((c) => !DUMMY_STOCK_CARD_IDS.has(c.id))
    );

    const cfg = this.getItem<SpreadsheetSyncConfig>(
      KEYS.SPREADSHEET_CONFIG,
      INITIAL_SPREADSHEET_CONFIG
    );
    const cleanedQueue = Array.isArray(cfg.queue)
      ? cfg.queue.filter((q) => !DUMMY_QUEUE_IDS.has(q.id))
      : [];
    const isDummySheet =
      cfg.sheetId === DUMMY_SPREADSHEET_ID ||
      (cfg.spreadsheetUrl || '').includes(DUMMY_SPREADSHEET_ID);
    this.setItem(KEYS.SPREADSHEET_CONFIG, {
      ...cfg,
      spreadsheetUrl: isDummySheet ? '' : cfg.spreadsheetUrl || '',
      sheetId: isDummySheet ? '' : cfg.sheetId || '',
      autoSync: isDummySheet ? false : Boolean(cfg.autoSync),
      lastSyncTime: isDummySheet ? undefined : cfg.lastSyncTime,
      status: isDummySheet ? 'disconnected' : cfg.status,
      queue: cleanedQueue,
    });

    const accs = this.getItem<AccurateItemRecord[]>(KEYS.ACCURATE_RECORDS, []);
    this.setItem(
      KEYS.ACCURATE_RECORDS,
      accs.filter(
        (a) => !(DUMMY_ACCURATE_SKUS.has(a.sku) && a.lastUpdated === '2026-10-12 00:00')
      )
    );

    localStorage.setItem(DUMMY_CLEANUP_KEY, CURRENT_DUMMY_CLEANUP_REV);
  }

  // Users / Operators
  static getUsers(): WarehouseUser[] {
    const USERS_REV_KEY = 'scangudang_users_rev';
    const CURRENT_USERS_REV = 'rev_20261124_branch_rules_v3';
    const currentRev = typeof window !== 'undefined' ? localStorage.getItem(USERS_REV_KEY) : null;

    if (currentRev !== CURRENT_USERS_REV) {
      this.setItem(KEYS.USERS, INITIAL_USERS);
      if (typeof window !== 'undefined') {
        localStorage.setItem(USERS_REV_KEY, CURRENT_USERS_REV);
      }
      return INITIAL_USERS;
    }

    const users = this.getItem<WarehouseUser[]>(KEYS.USERS, INITIAL_USERS);
    if (!users || users.length === 0) return INITIAL_USERS;
    return users;
  }

  static saveUsers(users: WarehouseUser[]): void {
    this.setItem(KEYS.USERS, users);
  }

  static getActiveUser(): WarehouseUser {
    const users = this.getUsers();
    const stored = this.getItem<WarehouseUser | null>(KEYS.ACTIVE_USER, null);
    if (stored) {
      const matched = users.find((u) => u.id === stored.id || u.name === stored.name);
      if (matched) return matched;
    }
    this.setItem(KEYS.ACTIVE_USER, users[0]);
    return users[0];
  }

  static setActiveUser(user: WarehouseUser): void {
    this.setItem(KEYS.ACTIVE_USER, user);
  }

  // Active Warehouse
  static getActiveWarehouse(): WarehouseLocation {
    return this.getItem(KEYS.ACTIVE_WAREHOUSE, 'Gudang Pusat');
  }

  static setActiveWarehouse(warehouse: WarehouseLocation): void {
    this.setItem(KEYS.ACTIVE_WAREHOUSE, warehouse);
  }

  // Inventory
  static getInventory(): InventoryItem[] {
    const DB_REV_KEY = 'scangudang_inventory_rev';
    const CURRENT_REV = 'rev_20261112_branch_min_v2';
    const currentStoredRev = typeof window !== 'undefined' ? localStorage.getItem(DB_REV_KEY) : null;

    if (currentStoredRev !== CURRENT_REV) {
      this.setItem(KEYS.INVENTORY, INITIAL_INVENTORY);
      if (typeof window !== 'undefined') {
        localStorage.setItem(DB_REV_KEY, CURRENT_REV);
      }
      return INITIAL_INVENTORY;
    }

    const stored = this.getItem<InventoryItem[]>(KEYS.INVENTORY, INITIAL_INVENTORY);
    if (!stored || stored.length === 0) return INITIAL_INVENTORY;

    const hasRealItems = stored.some(
      (i) => i.sku.startsWith('ACCL-') || i.sku.startsWith('CHML-') || i.sku.startsWith('BELT-')
    );
    if (!hasRealItems && INITIAL_INVENTORY.length > 50) {
      this.setItem(KEYS.INVENTORY, INITIAL_INVENTORY);
      return INITIAL_INVENTORY;
    }

    const existingSkus = new Set(stored.map((i) => i.sku));
    const missing = INITIAL_INVENTORY.filter((i) => !existingSkus.has(i.sku));
    let result = missing.length > 0 ? [...stored, ...missing] : stored;

    const needsMigration = result.some((i) => !i.minStockPerWarehouse);
    if (needsMigration) {
      const initialMap = new Map(INITIAL_INVENTORY.map((it) => [it.sku, it]));
      result = result.map((item) => {
        if (!item.minStockPerWarehouse) {
          const fromInit = initialMap.get(item.sku);
          const base = item.minStock || 5;
          return {
            ...item,
            minStockPerWarehouse: fromInit?.minStockPerWarehouse || {
              'Gudang Pusat': base,
              'Gudang Meruya': Math.max(3, Math.floor(base * 0.5) || 5),
              'Gudang Denpasar': Math.max(3, Math.floor(base * 0.5) || 5),
              'Gudang Surabaya': Math.max(5, Math.floor(base * 0.7) || 5),
            },
          };
        }
        return item;
      });
      this.setItem(KEYS.INVENTORY, result);
    } else if (missing.length > 0) {
      this.setItem(KEYS.INVENTORY, result);
    }

    return result;
  }

  static resetToMasterSpreadsheet(): InventoryItem[] {
    this.setItem(KEYS.INVENTORY, INITIAL_INVENTORY);
    return INITIAL_INVENTORY;
  }

  static saveInventory(items: InventoryItem[]): void {
    this.setItem(KEYS.INVENTORY, items);
  }

  // Scan Logs
  static getScanLogs(): ScanLog[] {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.SCAN_LOGS, INITIAL_SCAN_LOGS);
  }

  static saveScanLogs(logs: ScanLog[]): void {
    this.setItem(KEYS.SCAN_LOGS, logs);
  }

  // Opname
  static getOpnameSessions(): OpnameSession[] {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.OPNAME_SESSIONS, INITIAL_OPNAME_SESSIONS);
  }

  static saveOpnameSessions(sessions: OpnameSession[]): void {
    this.setItem(KEYS.OPNAME_SESSIONS, sessions);
  }

  // Inbound Orders
  static getInboundOrders(): InboundOrder[] {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.INBOUND_ORDERS, INITIAL_INBOUND_ORDERS);
  }

  static saveInboundOrders(orders: InboundOrder[]): void {
    this.setItem(KEYS.INBOUND_ORDERS, orders);
  }

  // Outbound Orders
  static getOutboundOrders(): OutboundOrder[] {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.OUTBOUND_ORDERS, INITIAL_OUTBOUND_ORDERS);
  }

  static saveOutboundOrders(orders: OutboundOrder[]): void {
    this.setItem(KEYS.OUTBOUND_ORDERS, orders);
  }

  // Stock Cards
  static getStockCards(): StockCardEntry[] {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.STOCK_CARDS, INITIAL_STOCK_CARD_ENTRIES);
  }

  static saveStockCards(entries: StockCardEntry[]): void {
    this.setItem(KEYS.STOCK_CARDS, entries);
  }

  // Spreadsheet Config
  static getSpreadsheetConfig(): SpreadsheetSyncConfig {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.SPREADSHEET_CONFIG, INITIAL_SPREADSHEET_CONFIG);
  }

  static saveSpreadsheetConfig(config: SpreadsheetSyncConfig): void {
    this.setItem(KEYS.SPREADSHEET_CONFIG, config);
  }

  // Accurate Records
  static getAccurateRecords(): AccurateItemRecord[] {
    this.ensureDummyCleaned();
    return this.getItem(KEYS.ACCURATE_RECORDS, INITIAL_ACCURATE_RECORDS);
  }

  static saveAccurateRecords(records: AccurateItemRecord[]): void {
    this.setItem(KEYS.ACCURATE_RECORDS, records);
  }

  // View Mode (Default fullscreen responsive for mobile & APK)
  static getViewMode(): 'mobile_frame' | 'responsive' {
    if (typeof window !== 'undefined') {
      const migrated = localStorage.getItem('scangudang_fullscreen_migrated_v1');
      if (!migrated) {
        this.setItem(KEYS.VIEW_MODE, 'responsive');
        localStorage.setItem('scangudang_fullscreen_migrated_v1', '1');
        return 'responsive';
      }
    }
    return this.getItem(KEYS.VIEW_MODE, 'responsive');
  }

  static setViewMode(mode: 'mobile_frame' | 'responsive'): void {
    this.setItem(KEYS.VIEW_MODE, mode);
  }

  // Sound
  static getSoundEnabled(): boolean {
    return this.getItem(KEYS.SOUND_ENABLED, true);
  }

  static setSoundEnabled(val: boolean): void {
    this.setItem(KEYS.SOUND_ENABLED, val);
  }

  // Reset to Clean Master Data
  static resetAll(): void {
    if (typeof window === 'undefined') return;
    localStorage.clear();
    localStorage.setItem(DUMMY_CLEANUP_KEY, CURRENT_DUMMY_CLEANUP_REV);
    this.saveInventory(INITIAL_INVENTORY);
    this.saveScanLogs(INITIAL_SCAN_LOGS);
    this.saveOpnameSessions(INITIAL_OPNAME_SESSIONS);
    this.saveInboundOrders(INITIAL_INBOUND_ORDERS);
    this.saveOutboundOrders(INITIAL_OUTBOUND_ORDERS);
    this.saveStockCards(INITIAL_STOCK_CARD_ENTRIES);
    this.saveSpreadsheetConfig(INITIAL_SPREADSHEET_CONFIG);
    this.saveAccurateRecords(INITIAL_ACCURATE_RECORDS);
    this.setActiveUser(INITIAL_USERS[0]);
    this.setActiveWarehouse('Gudang Pusat');
  }
}
