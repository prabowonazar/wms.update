import React, { useState, useEffect } from 'react';
import {
  InventoryItem,
  ScanLog,
  WarehouseLocation,
  WarehouseUser,
  getItemMinStock,
} from '../../types/warehouse';
import { CameraBarcodeScanner } from '../CameraBarcodeScanner';
import { IsometricPackageBox } from '../IsometricPackageBox';
import {
  Search,
  Scan,
  MapPin,
  Truck,
  PackageMinus,
  Calculator,
  CreditCard,
  Download,
  Trash2,
  CheckCircle2,
  Sparkles,
  Check,
  Building2,
  Layers,
  ArrowRight,
  Plus,
  Box,
} from 'lucide-react';
import { soundService } from '../../utils/audio';

interface ScanLogTabProps {
  inventory: InventoryItem[];
  scanLogs: ScanLog[];
  onSaveScanLog: (log: ScanLog) => void;
  onDeleteScanLog: (id: string) => void;
  activeWarehouse: WarehouseLocation;
  activeUser: WarehouseUser;
  onOpenTestBarcodes: () => void;
  externalBarcodeToScan?: string | null;
  onClearExternalBarcode?: () => void;
  onNavigateToInbound?: () => void;
  onNavigateToOutbound?: () => void;
  onNavigateToOpname?: () => void;
  onNavigateToStockCard?: () => void;
}

export const ScanLogTab: React.FC<ScanLogTabProps> = ({
  inventory,
  scanLogs,
  onSaveScanLog,
  onDeleteScanLog,
  activeWarehouse,
  activeUser,
  onOpenTestBarcodes,
  externalBarcodeToScan,
  onClearExternalBarcode,
  onNavigateToInbound,
  onNavigateToOutbound,
  onNavigateToOpname,
  onNavigateToStockCard,
}) => {
  // Scanner state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);

  // Form Catatan Scan
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemSku, setItemSku] = useState('');
  const [binLocation, setBinLocation] = useState('A-01-01');
  const [scanWarehouse, setScanWarehouse] = useState<WarehouseLocation>(activeWarehouse);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Filters for Daftar Scan
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    setScanWarehouse(activeWarehouse);
  }, [activeWarehouse]);

  // Handle barcode scanned from camera or test modal
  const handleBarcodeDecoded = (code: string) => {
    setScannedBarcode(code);
    const trimmed = code.trim();
    if (!trimmed) {
      setItemSku('');
      setItemName('');
      setBinLocation('A-01-01');
      return;
    }

    const found = inventory.find(
      (item) => item.barcode === trimmed || item.sku.toLowerCase() === trimmed.toLowerCase()
    );

    if (found) {
      setItemSku(found.sku);
      setItemName(found.name);
      setBinLocation(found.defaultBin);
      soundService.playScanBeep();
    } else {
      setItemSku('SKU-' + trimmed.slice(-4));
      setItemName('Barang Baru (' + trimmed + ')');
      setBinLocation('A-01-01');
      soundService.playScanBeep();
    }
  };

  const matchedInventoryItem = inventory.find(
    (item) =>
      (scannedBarcode.trim() &&
        (item.barcode === scannedBarcode.trim() ||
          item.sku.toLowerCase() === scannedBarcode.trim().toLowerCase())) ||
      (itemSku.trim() && item.sku.toLowerCase() === itemSku.trim().toLowerCase())
  );
  const currentBranchQty = matchedInventoryItem
    ? matchedInventoryItem.stock[activeWarehouse] || 0
    : null;
  const currentBranchMinQty = matchedInventoryItem
    ? getItemMinStock(matchedInventoryItem, activeWarehouse)
    : null;
  const isBelowMinQty =
    currentBranchQty !== null &&
    currentBranchMinQty !== null &&
    currentBranchQty <= currentBranchMinQty;

  useEffect(() => {
    if (externalBarcodeToScan) {
      handleBarcodeDecoded(externalBarcodeToScan);
      if (onClearExternalBarcode) onClearExternalBarcode();
    }
  }, [externalBarcodeToScan]);

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scannedBarcode && !itemSku) {
      soundService.playErrorBuzz();
      return;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

    const newLog: ScanLog = {
      id: 'scan-' + Date.now(),
      timestamp,
      barcode: scannedBarcode || 'MANUAL-' + Date.now().toString().slice(-6),
      sku: itemSku || 'UNKNOWN',
      name: itemName || 'Barang Tanpa Nama',
      type: 'general_scan',
      binLocation: binLocation || 'A-01-01',
      quantity: 1,
      notes: 'Pemeriksaan barcode standar',
      operatorId: activeUser.id,
      operatorName: activeUser.name,
      warehouse: scanWarehouse,
      syncedToSheet: false,
    };

    onSaveScanLog(newLog);
    soundService.playSuccessChime();

    // Trigger visual toast
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);

    // Reset Form for next scan
    setScannedBarcode('');
    setItemName('');
    setItemSku('');
    setBinLocation('A-01-01');
  };

  const getScanTypeLabel = (type: ScanLog['type']) => {
    switch (type) {
      case 'gr':
      case 'inbound':
        return 'GR (Good Receipt)';
      case 'do':
      case 'outbound':
        return 'DO (Delivery Order)';
      case 'opname':
        return 'Hitung Opname (Rekonsel)';
      case 'mutation_in':
        return 'Mutasi Masuk (Terima Barang)';
      case 'mutation_out':
      case 'relocation':
        return 'Mutasi Keluar (Item Transfer)';
      default:
        return 'Scan Bebas';
    }
  };

  // Filtered logs
  const filteredLogs = scanLogs.filter((log) => {
    const matchesSearch =
      log.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.barcode.includes(searchTerm) ||
      log.binLocation.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.operatorName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType =
      filterType === 'all' ||
      log.type === filterType ||
      (filterType === 'gr' && log.type === 'inbound') ||
      (filterType === 'do' && log.type === 'outbound') ||
      (filterType === 'mutation_out' && log.type === 'relocation');

    return matchesSearch && matchesType;
  });

  const exportToCSV = () => {
    const headers = [
      'ID',
      'Waktu',
      'Barcode',
      'SKU',
      'Nama Barang',
      'Tipe Scan',
      'Lokasi Rak',
      'Qty',
      'Gudang',
      'Operator',
      'Catatan',
    ];
    const rows = filteredLogs.map((log) => [
      log.id,
      log.timestamp,
      `"${log.barcode}"`,
      log.sku,
      `"${log.name.replace(/"/g, '""')}"`,
      `"${getScanTypeLabel(log.type)}"`,
      log.binLocation,
      log.quantity,
      `"${log.warehouse}"`,
      `"${log.operatorName}"`,
      `"${(log.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Daftar_Scan_Gudang_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Count summary by type today
  const grCount = scanLogs.filter((l) => l.type === 'gr' || l.type === 'inbound').length;
  const doCount = scanLogs.filter((l) => l.type === 'do' || l.type === 'outbound').length;
  const opnameCount = scanLogs.filter((l) => l.type === 'opname').length;
  const latestLog = scanLogs[0];

  return (
    <div className="space-y-4 px-1 py-1 font-sans select-none pb-12">
      {/* 1. Barcode Search & Scanner Input Bar (Theme: Rounded White Input + Black Squircle Scanner) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-extrabold text-zinc-950 tracking-tight">
            Scan & Cari Barcode Gudang
          </h2>
          <span className="text-[11px] font-mono text-zinc-500 font-bold">
            {activeWarehouse}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 bg-white rounded-2xl px-3.5 py-3 flex items-center gap-2.5 border border-zinc-200/90 shadow-xs">
            <Search className="w-4 h-4 text-zinc-400 shrink-0" />
            <input
              type="text"
              placeholder="Ketik Barcode / SKU / Nama Barang..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-xs font-semibold text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
            />
          </div>

          {/* Barcode Scanner Button (Black Square with Neon Lime Icon) */}
          <button
            type="button"
            onClick={() => setIsScannerOpen(!isScannerOpen)}
            title="Buka / Tutup Kamera Scan Barcode"
            className="w-12 h-12 rounded-2xl bg-[#18181B] hover:bg-zinc-800 text-[#C6F232] flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer shrink-0 border border-zinc-800"
          >
            <Scan className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>
      </section>

      {/* Camera Barcode Scanner Section if Active */}
      {isScannerOpen && (
        <section className="bg-white rounded-3xl p-2.5 sm:p-3.5 shadow-xl border border-zinc-200 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-1 pb-2.5 mb-2 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C6F232] animate-pulse" />
              <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wide">
                Kamera Barcode Scanner Aktif
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsScannerOpen(false)}
              className="text-xs font-bold text-zinc-500 hover:text-zinc-900 px-2.5 py-1 bg-zinc-100 rounded-lg cursor-pointer"
            >
              Tutup Kamera
            </button>
          </div>

          <CameraBarcodeScanner
            isScanning={isScannerOpen}
            onScan={handleBarcodeDecoded}
            onClose={() => setIsScannerOpen(false)}
            onOpenTestBarcodes={onOpenTestBarcodes}
          />
        </section>
      )}

      {/* 2. Warehouse Summary Card (Deep Obsidian Card with Lime Accent) */}
      <section className="bg-[#18181B] rounded-3xl p-4 text-white shadow-xl relative overflow-hidden border border-zinc-800">
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-black text-zinc-950 bg-[#C6F232] px-2 py-0.5 rounded-full uppercase">
                STATUS GUDANG
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">
                {activeWarehouse}
              </span>
            </div>

            {latestLog ? (
              <div className="mt-2.5">
                <span className="text-[10px] text-zinc-400 uppercase font-mono block">
                  Aktivitas Scan Terakhir:
                </span>
                <h3 className="text-sm font-bold text-white truncate max-w-[210px] mt-0.5">
                  {latestLog.name}
                </h3>
                <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-zinc-300">
                  <span className="text-[#C6F232] font-bold">
                    {getScanTypeLabel(latestLog.type).split(' ')[0]}
                  </span>
                  <span>·</span>
                  <span>Qty: {latestLog.quantity}</span>
                  <span>·</span>
                  <span>Rak {latestLog.binLocation}</span>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <h3 className="text-sm font-bold text-white">Siap Melakukan Scan</h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Arahkan kamera ke barcode barang atau input manual di bawah.
                </p>
              </div>
            )}
          </div>

          {/* Right graphic box */}
          <div className="shrink-0 pl-2">
            <IsometricPackageBox size="small" className="w-20 h-20" />
          </div>
        </div>

        {/* 3 Metric Pills on Card Bottom */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-zinc-800 text-center">
          <div className="bg-[#242428] rounded-xl py-1.5 px-2">
            <span className="text-[9px] text-zinc-400 block">GR (Masuk)</span>
            <span className="text-xs font-black text-[#C6F232] font-mono">{grCount}</span>
          </div>
          <div className="bg-[#242428] rounded-xl py-1.5 px-2">
            <span className="text-[9px] text-zinc-400 block">DO (Keluar)</span>
            <span className="text-xs font-black text-amber-300 font-mono">{doCount}</span>
          </div>
          <div className="bg-[#242428] rounded-xl py-1.5 px-2">
            <span className="text-[9px] text-zinc-400 block">Opname</span>
            <span className="text-xs font-black text-purple-300 font-mono">{opnameCount}</span>
          </div>
        </div>
      </section>

      {/* 3. Quick Feature Shortcuts (4 Clean Circular Buttons) */}
      <section>
        <h3 className="text-xs font-extrabold text-zinc-950 uppercase tracking-wider mb-2.5">
          Fitur Cepat Gudang
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {/* 1. GR Masuk */}
          <button
            type="button"
            onClick={onNavigateToInbound}
            className="flex flex-col items-center group cursor-pointer"
          >
            <div className="w-13 h-13 rounded-2xl bg-white group-hover:bg-zinc-50 border border-zinc-200/90 shadow-xs flex items-center justify-center relative transition-transform active:scale-95">
              <Truck className="w-5 h-5 text-zinc-900 stroke-[2]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#C6F232]" />
            </div>
            <span className="text-[10px] font-bold text-zinc-800 mt-1.5 text-center leading-tight">
              GR Masuk
            </span>
          </button>

          {/* 2. DO Keluar */}
          <button
            type="button"
            onClick={onNavigateToOutbound}
            className="flex flex-col items-center group cursor-pointer"
          >
            <div className="w-13 h-13 rounded-2xl bg-white group-hover:bg-zinc-50 border border-zinc-200/90 shadow-xs flex items-center justify-center relative transition-transform active:scale-95">
              <PackageMinus className="w-5 h-5 text-zinc-900 stroke-[2]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#C6F232]" />
            </div>
            <span className="text-[10px] font-bold text-zinc-800 mt-1.5 text-center leading-tight">
              DO Keluar
            </span>
          </button>

          {/* 3. Opname Rekonsel */}
          <button
            type="button"
            onClick={onNavigateToOpname}
            className="flex flex-col items-center group cursor-pointer"
          >
            <div className="w-13 h-13 rounded-2xl bg-white group-hover:bg-zinc-50 border border-zinc-200/90 shadow-xs flex items-center justify-center relative transition-transform active:scale-95">
              <Calculator className="w-5 h-5 text-zinc-900 stroke-[2]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#C6F232]" />
            </div>
            <span className="text-[10px] font-bold text-zinc-800 mt-1.5 text-center leading-tight">
              Opname
            </span>
          </button>

          {/* 4. Kartu Stok */}
          <button
            type="button"
            onClick={onNavigateToStockCard}
            className="flex flex-col items-center group cursor-pointer"
          >
            <div className="w-13 h-13 rounded-2xl bg-white group-hover:bg-zinc-50 border border-zinc-200/90 shadow-xs flex items-center justify-center relative transition-transform active:scale-95">
              <CreditCard className="w-5 h-5 text-zinc-900 stroke-[2]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#C6F232]" />
            </div>
            <span className="text-[10px] font-bold text-zinc-800 mt-1.5 text-center leading-tight">
              Kartu Stok
            </span>
          </button>
        </div>
      </section>

      {/* 4. Form Input Transaksi Hasil Scan (Original Complete Form with Modern Theme) */}
      <section className="bg-white rounded-3xl p-5 shadow-sm border border-zinc-200/90 space-y-3.5">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
          <div>
            <h3 className="text-xs font-black text-zinc-950 uppercase tracking-wider">
              Form Hasil Scan Barcode
            </h3>
            <p className="text-[11px] text-zinc-500">
              Verifikasi data barang & simpan ke riwayat scan
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenTestBarcodes}
            className="text-[11px] font-extrabold text-zinc-950 bg-[#C6F232] hover:bg-[#B8E62B] px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
            title="Kelola Database Barang, Input Barang Baru atau Import File Excel"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>+ Database / Input Barang</span>
          </button>
        </div>

        <form onSubmit={handleSaveForm} className="space-y-3">
          {/* Barcode & SKU */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                Nomor Barcode / QR
              </label>
              <input
                type="text"
                value={scannedBarcode}
                onChange={(e) => handleBarcodeDecoded(e.target.value)}
                placeholder="Scan atau ketik..."
                required
                className="w-full bg-[#F4F5F7] border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-zinc-900 focus:outline-none focus:border-zinc-900"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                Kode SKU
              </label>
              <input
                type="text"
                value={itemSku}
                onChange={(e) => setItemSku(e.target.value)}
                placeholder="SKU-001"
                required
                className="w-full bg-[#F4F5F7] border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-zinc-900 focus:outline-none focus:border-zinc-900"
              />
            </div>
          </div>

          {/* Nama Barang */}
          <div>
            <label className="text-[11px] font-bold text-zinc-700 block mb-1">
              Nama Lengkap Barang
            </label>
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Contoh: Industrial Barcode Scanner..."
              required
              className="w-full bg-[#F4F5F7] border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
            />
          </div>

          {/* Qty & Min Qty dari Hasil Scan */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                Qty ({activeWarehouse.replace('Gudang ', '')})
              </label>
              <div
                className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-bold border ${
                  isBelowMinQty
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-[#F4F5F7] border-zinc-200 text-zinc-900'
                }`}
              >
                {currentBranchQty !== null
                  ? `${currentBranchQty} ${matchedInventoryItem?.unit || ''}`.trim()
                  : '-'}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                Min Qty
              </label>
              <div className="w-full bg-[#F4F5F7] border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-zinc-900">
                {currentBranchMinQty !== null
                  ? `${currentBranchMinQty} ${matchedInventoryItem?.unit || ''}`.trim()
                  : '-'}
              </div>
            </div>
          </div>

          {/* Tombol Simpan (Electric Lime Action Button) */}
          <button
            type="submit"
            className="w-full py-3.5 bg-[#C6F232] hover:bg-[#B8E62B] active:scale-[0.99] text-zinc-950 font-extrabold text-sm rounded-2xl shadow-lg shadow-[#C6F232]/25 transition-all cursor-pointer flex items-center justify-center gap-2 mt-2"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Simpan Hasil Scan</span>
          </button>

          {saveSuccess && (
            <div className="p-3 bg-[#18181B] border border-[#C6F232]/50 rounded-2xl text-xs text-white font-semibold flex items-center gap-2.5 animate-in fade-in shadow-lg">
              <CheckCircle2 className="w-4 h-4 text-[#C6F232] shrink-0" />
              <div>
                <span className="font-bold text-[#C6F232] block">
                  Hasil Scan Berhasil Disimpan!
                </span>
                <span className="text-[11px] text-zinc-300">
                  Data scan barang tercatat di riwayat scan log.
                </span>
              </div>
            </div>
          )}
        </form>
      </section>

      {/* 5. Daftar Riwayat Scan Log (Original Complete Table with Modern Styling) */}
      <section className="bg-white rounded-3xl p-5 shadow-sm border border-zinc-200/90 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
          <div>
            <h3 className="text-xs font-black text-zinc-950 uppercase tracking-wider">
              Riwayat Hasil Scan ({filteredLogs.length})
            </h3>
            <p className="text-[11px] text-zinc-500">
              Log aktivitas scan barcode di {activeWarehouse}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportToCSV}
              className="text-xs font-bold text-zinc-800 bg-[#F4F5F7] hover:bg-zinc-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Unduh CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Filter Tipe Transaksi Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
          {[
            { id: 'all', label: 'Semua' },
            { id: 'gr', label: 'GR' },
            { id: 'do', label: 'DO' },
            { id: 'opname', label: 'Opname' },
            { id: 'mutation_in', label: 'Mutasi Masuk' },
            { id: 'mutation_out', label: 'Mutasi Keluar' },
          ].map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setFilterType(btn.id)}
              className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                filterType === btn.id
                  ? 'bg-zinc-950 text-[#C6F232] shadow-xs'
                  : 'bg-[#F4F5F7] text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* List of Log Items */}
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-xs">
              Belum ada riwayat scan yang cocok dengan filter.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 bg-[#F4F5F7] hover:bg-zinc-100 rounded-2xl flex items-center justify-between gap-3 text-xs transition-colors border border-zinc-200/50"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-zinc-950">
                      {log.barcode}
                    </span>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-zinc-950 text-[#C6F232] font-mono">
                      {getScanTypeLabel(log.type).split(' ')[0]}
                    </span>
                  </div>
                  <h4 className="font-semibold text-zinc-900 truncate text-xs">
                    {log.name}
                  </h4>
                  <div className="text-[10px] text-zinc-500 font-mono flex flex-wrap items-center gap-2">
                    <span>SKU: {log.sku}</span>
                    <span>·</span>
                    <span>Rak: {log.binLocation}</span>
                    <span>·</span>
                    <span className="font-bold text-zinc-800">Qty: {log.quantity}</span>
                    <span>·</span>
                    <span>{log.timestamp.slice(11, 16)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onDeleteScanLog(log.id)}
                  className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer shrink-0"
                  title="Hapus Log"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
