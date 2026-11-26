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
} from '../types/warehouse';
import { REAL_USER_INVENTORY } from './masterInventoryData';

export const INITIAL_USERS: WarehouseUser[] = [
  {
    id: 'op-nazar',
    nik: 'JKT-001',
    name: 'Nazar Prabowo',
    role: 'supervisor',
    pin: '',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
    phone: '-',
    assignedWarehouse: 'Gudang Pusat',
    warehouseLabel: 'Semua Gudang (Supervisor)',
    allowedWarehouses: ['Gudang Pusat', 'Gudang Meruya', 'Gudang Denpasar', 'Gudang Surabaya'],
  },
  {
    id: 'op-atang',
    nik: 'JKT-002',
    name: 'Atang',
    role: 'operator',
    pin: '',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
    phone: '-',
    assignedWarehouse: 'Gudang Pusat',
    warehouseLabel: 'Hanya Gudang Jakarta',
    allowedWarehouses: ['Gudang Pusat'],
  },
  {
    id: 'op-husein',
    nik: 'JKT-003',
    name: 'Husein',
    role: 'operator',
    pin: '',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
    phone: '-',
    assignedWarehouse: 'Gudang Pusat',
    warehouseLabel: 'Hanya Gudang Jakarta',
    allowedWarehouses: ['Gudang Pusat'],
  },
  {
    id: 'op-burhan',
    nik: 'MRY-001',
    name: 'Burhan',
    role: 'operator',
    pin: '',
    avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=120&auto=format&fit=crop&q=80',
    phone: '-',
    assignedWarehouse: 'Gudang Meruya',
    warehouseLabel: 'Hanya Gudang Meruya',
    allowedWarehouses: ['Gudang Meruya'],
  },
  {
    id: 'op-krisna',
    nik: 'DPS-001',
    name: 'Krisna',
    role: 'operator',
    pin: '',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=120&auto=format&fit=crop&q=80',
    phone: '-',
    assignedWarehouse: 'Gudang Denpasar',
    warehouseLabel: 'Hanya Gudang Bali',
    allowedWarehouses: ['Gudang Denpasar'],
  },
  {
    id: 'op-ajeng',
    nik: 'SBY-001',
    name: 'Ajeng',
    role: 'operator',
    pin: '',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
    phone: '-',
    assignedWarehouse: 'Gudang Surabaya',
    warehouseLabel: 'Hanya Gudang Surabaya',
    allowedWarehouses: ['Gudang Surabaya'],
  },
];

export const INITIAL_INVENTORY: InventoryItem[] = REAL_USER_INVENTORY;

export const INITIAL_SCAN_LOGS: ScanLog[] = [];

export const INITIAL_OPNAME_SESSIONS: OpnameSession[] = [];

export const INITIAL_INBOUND_ORDERS: InboundOrder[] = [];

export const INITIAL_OUTBOUND_ORDERS: OutboundOrder[] = [];

export const INITIAL_STOCK_CARD_ENTRIES: StockCardEntry[] = [];

export const INITIAL_SPREADSHEET_CONFIG: SpreadsheetSyncConfig = {
  spreadsheetUrl: '',
  sheetId: '',
  activeSheetName: 'ScanLog_Warehouse_Live',
  autoSync: false,
  status: 'disconnected',
  queue: [],
};

export const INITIAL_ACCURATE_RECORDS: AccurateItemRecord[] = [];
