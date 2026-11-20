import React, { useState, useEffect } from 'react';
import {
  InventoryItem,
  OpnameSession,
  OpnameItemCount,
  WarehouseLocation,
  WarehouseUser,
} from '../../types/warehouse';
import { CameraBarcodeScanner } from '../CameraBarcodeScanner';
import {
  Calculator,
  Play,
  CheckCircle2,
  AlertTriangle,
  Scan,
  RefreshCw,
  Plus,
  Minus,
  Sparkles,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  FileCheck2,
} from 'lucide-react';
import { soundService } from '../../utils/audio';

interface StockOpnameTabProps {
  inventory: InventoryItem[];
  opnameSessions: OpnameSession[];
  onSaveOpnameSessions: (sessions: OpnameSession[]) => void;
  activeWarehouse: WarehouseLocation;
  activeUser: WarehouseUser;
  onOpenTestBarcodes: () => void;
  onApplyOpnameAdjustment: (session: OpnameSession) => void;
  externalBarcodeToScan?: string | null;
  onClearExternalBarcode?: () => void;
}

export const StockOpnameTab: React.FC<StockOpnameTabProps> = ({
  inventory,
  opnameSessions,
  onSaveOpnameSessions,
  activeWarehouse,
  activeUser,
  onOpenTestBarcodes,
  onApplyOpnameAdjustment,
  externalBarcodeToScan,
  onClearExternalBarcode,
}) => {
  // Find currently active session or the first one
  const [activeSessionId, setActiveSessionId] = useState<string>(
    opnameSessions.find((s) => s.status === 'active')?.id || opnameSessions[0]?.id || ''
  );

  const activeSession = opnameSessions.find((s) => s.id === activeSessionId) || opnameSessions[0];

  // Camera scanner visibility
  const [showScanner, setShowScanner] = useState(false);

  // Active item being counted
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [activeItemCount, setActiveItemCount] = useState<OpnameItemCount | null>(null);

  // New session modal
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionZone, setNewSessionZone] = useState('Zona A & B (Semua Rak)');

  // Rapid continuous scan mode (each scan increments count by 1 automatically)
  const [rapidIncrementMode, setRapidIncrementMode] = useState(true);

  // Select initial item when session opens
  useEffect(() => {
    if (activeSession && activeSession.items.length > 0 && !selectedSku) {
      const first = activeSession.items[0];
      setSelectedSku(first.sku);
      setActiveItemCount(first);
    }
  }, [activeSession, selectedSku]);

  // Handle barcode scanned during opname
  const handleBarcodeDecoded = (code: string) => {
    if (!activeSession) return;

    // Find in session items
    let target = activeSession.items.find(
      (item) => item.barcode === code || item.sku.toLowerCase() === code.toLowerCase()
    );

    if (!target) {
      // Find in master inventory
      const master = inventory.find(
        (m) => m.barcode === code || m.sku.toLowerCase() === code.toLowerCase()
      );
      if (master) {
        const newItemCount: OpnameItemCount = {
          sku: master.sku,
          barcode: master.barcode,
          name: master.name,
          binLocation: master.defaultBin,
          systemStock: master.stock[activeSession.warehouse] || 0,
          physicalCount: 1,
          difference: 1 - (master.stock[activeSession.warehouse] || 0),
          costPrice: master.costPrice,
          lastScannedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          notes: 'Item baru ditambahkan saat opname fisik',
        };

        const updatedItems = [...activeSession.items, newItemCount];
        updateSessionItems(updatedItems);
        setSelectedSku(newItemCount.sku);
        setActiveItemCount(newItemCount);
        soundService.playSuccessChime();
        return;
      } else {
        soundService.playErrorBuzz();
        alert(`Barcode ${code} tidak ditemukan di master inventory.`);
        return;
      }
    }

    // Found in session
    const nextCount = rapidIncrementMode ? target.physicalCount + 1 : target.physicalCount;
    const diff = nextCount - target.systemStock;

    const updated = activeSession.items.map((it) =>
      it.sku === target!.sku
        ? {
            ...it,
            physicalCount: nextCount,
            difference: diff,
            lastScannedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          }
        : it
    );

    updateSessionItems(updated);
    setSelectedSku(target.sku);
    setActiveItemCount({
      ...target,
      physicalCount: nextCount,
      difference: diff,
    });
    soundService.playScanBeep();
  };

  useEffect(() => {
    if (externalBarcodeToScan) {
      handleBarcodeDecoded(externalBarcodeToScan);
      if (onClearExternalBarcode) onClearExternalBarcode();
    }
  }, [externalBarcodeToScan]);

  const updateSessionItems = (items: OpnameItemCount[]) => {
    const updatedSessions = opnameSessions.map((s) =>
      s.id === activeSession.id ? { ...s, items } : s
    );
    onSaveOpnameSessions(updatedSessions);
  };

  const handleManualCountChange = (newCount: number) => {
    if (!activeItemCount || !activeSession) return;
    const validCount = Math.max(0, newCount);
    const diff = validCount - activeItemCount.systemStock;

    const updated = activeSession.items.map((it) =>
      it.sku === activeItemCount.sku
        ? {
            ...it,
            physicalCount: validCount,
            difference: diff,
            lastScannedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          }
        : it
    );

    updateSessionItems(updated);
    setActiveItemCount({
      ...activeItemCount,
      physicalCount: validCount,
      difference: diff,
    });
  };

  const handleCreateNewSession = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newSessionTitle.trim() || `Opname ${activeWarehouse} - ${new Date().toLocaleDateString('id-ID')}`;
    const newSession: OpnameSession = {
      id: 'opname-' + Date.now(),
      code: `OPN-${new Date().getFullYear()}-${Math.floor(Math.random() * 900 + 100)}`,
      title,
      warehouse: activeWarehouse,
      targetBinZone: newSessionZone,
      status: 'active',
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      operatorName: activeUser.name,
      items: inventory.map((inv) => ({
        sku: inv.sku,
        barcode: inv.barcode,
        name: inv.name,
        binLocation: inv.defaultBin,
        systemStock: inv.stock[activeWarehouse] || 0,
        physicalCount: 0,
        difference: -(inv.stock[activeWarehouse] || 0),
        costPrice: inv.costPrice,
      })),
    };

    onSaveOpnameSessions([newSession, ...opnameSessions]);
    setActiveSessionId(newSession.id);
    setIsCreatingSession(false);
    setNewSessionTitle('');
    soundService.playSuccessChime();
  };

  const handleFinishOpname = () => {
    if (!activeSession) return;
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin menyelesaikan sesi "${activeSession.title}" dan menerapkan penyesuaian selisih ke Kartu Stok gudang?`
    );
    if (!confirmed) return;

    onApplyOpnameAdjustment(activeSession);
    soundService.playSuccessChime();
  };

  // Calculations
  const totalItemsCounted = activeSession?.items.filter((it) => it.lastScannedAt).length || 0;
  const totalItemsTarget = activeSession?.items.length || 0;
  const matchCount = activeSession?.items.filter((it) => it.difference === 0 && it.lastScannedAt).length || 0;
  const discrepancyItems = activeSession?.items.filter((it) => it.difference !== 0) || [];

  return (
    <div className="space-y-4 px-1 py-1 font-sans select-none pb-12">
      {/* Sesi Opname Header & Switcher */}
      <section className="bg-white border border-zinc-200/90 rounded-3xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-purple-50 text-purple-700 rounded-xl border border-purple-200 shrink-0">
              <Calculator className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-black text-zinc-950 uppercase tracking-wider truncate">
                Hitung Opname (Rekonsel)
              </h2>
              <p className="text-[11px] text-zinc-500 truncate">
                Sesi Hitung Fisik vs Saldo Sistem Real-Time (Rekonsiliasi)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreatingSession(!isCreatingSession)}
            className="text-[11px] font-extrabold bg-[#C6F232] hover:bg-[#B8E62B] text-zinc-950 px-3 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer transition-colors active:scale-95 shadow-xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Sesi Baru
          </button>
        </div>

        {/* Modal / Form Buat Sesi Baru */}
        {isCreatingSession && (
          <form
            onSubmit={handleCreateNewSession}
            className="p-3.5 mb-3 bg-[#F4F5F7] border border-amber-300 rounded-2xl space-y-2.5 animate-in fade-in"
          >
            <div className="text-xs font-extrabold text-zinc-950">Mulai Sesi Hitung Baru</div>
            <div>
              <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                Nama / Judul Sesi Sensus
              </label>
              <input
                type="text"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                placeholder="Contoh: Opname Akhir Pekan - Rak A (Komponen)"
                required
                className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Zona / Rak Target
                </label>
                <input
                  type="text"
                  value={newSessionZone}
                  onChange={(e) => setNewSessionZone(e.target.value)}
                  placeholder="Zona A, Rak 01 - 04"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Lokasi Gudang
                </label>
                <div className="px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-950">
                  {activeWarehouse}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreatingSession(false)}
                className="px-3 py-1.5 text-xs font-bold text-zinc-600 hover:text-zinc-900 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-[#18181B] hover:bg-zinc-800 text-[#C6F232] text-xs font-bold rounded-xl cursor-pointer"
              >
                Mulai Sesi Sekarang
              </button>
            </div>
          </form>
        )}

        {/* Active Session Card */}
        {activeSession ? (
          <div className="bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-lg border border-purple-200">
                  {activeSession.code}
                </span>
                <h3 className="text-xs font-extrabold text-zinc-950 mt-1.5">
                  {activeSession.title}
                </h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Gudang:{' '}
                  <span className="text-zinc-900 font-semibold">{activeSession.warehouse}</span> ·
                  PIC:{' '}
                  <span className="text-zinc-900 font-semibold">{activeSession.operatorName}</span>
                </p>
              </div>

              <div className="text-right shrink-0">
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                    activeSession.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-zinc-200 text-zinc-600'
                  }`}
                >
                  {activeSession.status === 'active' ? '● SESI AKTIF' : 'SELESAI'}
                </span>
                <div className="text-[11px] text-zinc-600 mt-1.5 font-mono">
                  Progress: <strong className="text-zinc-950">{totalItemsCounted}</strong> /{' '}
                  {totalItemsTarget} Item
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    totalItemsTarget > 0
                      ? Math.min(100, (totalItemsCounted / totalItemsTarget) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-500 py-3 text-center">
            Belum ada sesi opname aktif. Silakan klik &quot;Sesi Baru&quot;.
          </div>
        )}
      </section>

      {/* Sub Fitur 2 & 3: Scan dan Bandingkan + Input Jumlah Fisik */}
      {activeSession && (
        <section className="bg-white border border-zinc-200/90 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-zinc-100 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#18181B] text-[#C6F232] rounded-xl">
                <Scan className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-zinc-950 uppercase tracking-wider">
                  Scan & Bandingkan Fisik
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Arahkan scanner ke barang untuk update hitungan fisik
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRapidIncrementMode(!rapidIncrementMode)}
                className={`text-[10px] px-2.5 py-1.5 rounded-xl border font-mono font-bold transition-colors cursor-pointer ${
                  rapidIncrementMode
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-[#F4F5F7] text-zinc-600 border-zinc-200'
                }`}
                title="Tiap scan langsung menambah +1"
              >
                {rapidIncrementMode ? '⚡ Multi-Scan (+1)' : 'Manual Mode'}
              </button>

              <button
                type="button"
                onClick={() => setShowScanner(!showScanner)}
                className="text-[11px] font-bold bg-[#18181B] hover:bg-zinc-800 text-[#C6F232] px-3 py-1.5 rounded-xl cursor-pointer transition-colors"
              >
                {showScanner ? 'Tutup Kamera' : 'Buka Kamera'}
              </button>
            </div>
          </div>

          {/* Camera scanner for opname */}
          {showScanner && (
            <CameraBarcodeScanner
              isScanning={showScanner}
              onScan={handleBarcodeDecoded}
              onClose={() => setShowScanner(false)}
              onOpenTestBarcodes={onOpenTestBarcodes}
            />
          )}

          {/* Active Item Discrepancy Card */}
          {activeItemCount ? (
            <div className="bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-zinc-950 bg-[#C6F232] px-2 py-0.5 rounded-lg">
                      {activeItemCount.sku}
                    </span>
                    <span className="text-[11px] text-zinc-600 font-mono">
                      Rak: <strong className="text-zinc-950">{activeItemCount.binLocation}</strong>
                    </span>
                  </div>
                  <h4 className="text-sm font-extrabold text-zinc-950 mt-1.5">
                    {activeItemCount.name}
                  </h4>
                  <p className="font-mono text-[11px] text-zinc-500">
                    Barcode: {activeItemCount.barcode}
                  </p>
                </div>

                {/* Variance Status Pill */}
                <div
                  className={`px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 shrink-0 ${
                    activeItemCount.difference === 0
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : activeItemCount.difference > 0
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-red-100 text-red-700 border-red-200'
                  }`}
                >
                  {activeItemCount.difference === 0 ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Cocok (0)
                    </>
                  ) : activeItemCount.difference > 0 ? (
                    <>
                      <TrendingUp className="w-4 h-4" /> Lebih (+{activeItemCount.difference})
                    </>
                  ) : (
                    <>
                      <TrendingDown className="w-4 h-4" /> Kurang ({activeItemCount.difference})
                    </>
                  )}
                </div>
              </div>

              {/* Side by side comparison: Sistem vs Fisik */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-white border border-zinc-200 rounded-2xl text-center">
                  <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-0.5">
                    Saldo Sistem WMS
                  </span>
                  <span className="text-2xl font-black font-mono text-zinc-950">
                    {activeItemCount.systemStock}
                  </span>
                  <span className="text-[10px] text-zinc-500 block">Unit Terdaftar</span>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-center">
                  <span className="text-[10px] uppercase font-mono font-bold text-amber-800 block mb-0.5">
                    Hitungan Fisik Nyata
                  </span>
                  <span className="text-2xl font-black font-mono text-amber-700">
                    {activeItemCount.physicalCount}
                  </span>
                  <span className="text-[10px] text-amber-700/80 block">Hasil Scan Gudang</span>
                </div>
              </div>

              {/* Quick Input Counter & Keypad Buttons */}
              <div className="space-y-2 pt-2">
                <div className="text-[11px] font-bold text-zinc-700">
                  Input Jumlah Fisik Cepat:
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleManualCountChange(activeItemCount.physicalCount + 1)}
                    className="p-2.5 bg-white hover:bg-zinc-100 border border-zinc-200 active:scale-95 text-zinc-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" /> 1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleManualCountChange(activeItemCount.physicalCount + 5)}
                    className="p-2.5 bg-white hover:bg-zinc-100 border border-zinc-200 active:scale-95 text-zinc-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" /> 5
                  </button>
                  <button
                    type="button"
                    onClick={() => handleManualCountChange(activeItemCount.physicalCount + 10)}
                    className="p-2.5 bg-white hover:bg-zinc-100 border border-zinc-200 active:scale-95 text-zinc-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" /> 10
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleManualCountChange(Math.max(0, activeItemCount.physicalCount - 1))
                    }
                    className="p-2.5 bg-white hover:bg-zinc-100 border border-zinc-200 active:scale-95 text-zinc-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Minus className="w-3.5 h-3.5 text-red-600" /> 1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleManualCountChange(0)}
                    className="p-2.5 bg-white hover:bg-red-50 border border-zinc-200 hover:border-red-200 active:scale-95 text-zinc-700 hover:text-red-600 font-bold text-xs rounded-xl flex items-center justify-center cursor-pointer shadow-2xs"
                  >
                    Reset
                  </button>
                </div>

                {/* Direct Numeric Input */}
                <div className="flex gap-2 items-center pt-1">
                  <span className="text-[11px] font-semibold text-zinc-600 whitespace-nowrap">
                    Input Angka:
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={activeItemCount.physicalCount}
                    onChange={(e) => handleManualCountChange(parseInt(e.target.value) || 0)}
                    className="flex-1 bg-white border border-zinc-200 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 text-center focus:outline-none focus:border-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => handleManualCountChange(activeItemCount.systemStock)}
                    className="px-3 py-1.5 bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-800 text-[11px] font-bold rounded-xl whitespace-nowrap cursor-pointer"
                    title="Set fisik sama dengan sistem"
                  >
                    Samakan Sistem
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl text-center text-xs text-zinc-500">
              Pilih item dari daftar di bawah atau scan barcode untuk mulai menghitung.
            </div>
          )}

          {/* Quick Select Item List inside active session */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-zinc-950">Item Dalam Sesi Hitung:</span>
              <button
                type="button"
                onClick={onOpenTestBarcodes}
                className="text-zinc-800 hover:text-zinc-950 bg-[#F4F5F7] hover:bg-zinc-200 px-2.5 py-1 rounded-xl border border-zinc-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3 text-amber-500" /> Lembar Barcode
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {activeSession.items.map((item) => {
                const isSelected = selectedSku === item.sku;
                return (
                  <div
                    key={item.sku}
                    onClick={() => {
                      setSelectedSku(item.sku);
                      setActiveItemCount(item);
                    }}
                    className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between text-xs ${
                      isSelected
                        ? 'bg-[#18181B] border-zinc-900 text-white shadow-sm'
                        : 'bg-[#F4F5F7] border-zinc-200/80 hover:bg-zinc-100 text-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`font-mono text-[11px] font-bold ${
                          isSelected ? 'text-[#C6F232]' : 'text-zinc-950'
                        }`}
                      >
                        {item.sku}
                      </span>
                      <span
                        className={`truncate font-semibold ${
                          isSelected ? 'text-zinc-100' : 'text-zinc-800'
                        }`}
                      >
                        {item.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <span
                        className={`text-[11px] font-mono ${
                          isSelected ? 'text-zinc-300' : 'text-zinc-600'
                        }`}
                      >
                        Sistem:{' '}
                        <strong className={isSelected ? 'text-white' : 'text-zinc-950'}>
                          {item.systemStock}
                        </strong>{' '}
                        | Fisik:{' '}
                        <strong className={isSelected ? 'text-[#C6F232]' : 'text-amber-700'}>
                          {item.physicalCount}
                        </strong>
                      </span>

                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                          item.difference === 0
                            ? isSelected
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-emerald-100 text-emerald-700'
                            : item.difference > 0
                            ? isSelected
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-amber-100 text-amber-800'
                            : isSelected
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {item.difference > 0 ? `+${item.difference}` : item.difference}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selesaikan Sesi & Terapkan Opname */}
          <div className="p-3.5 bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs font-extrabold text-zinc-950 flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-emerald-600" /> Selesaikan Sesi & Buat Jurnal
              </div>
              <p className="text-[11px] text-zinc-500">
                Sesuaikan saldo stok & update kartu stok otomatis
              </p>
            </div>

            <button
              type="button"
              onClick={handleFinishOpname}
              className="px-4 py-2.5 bg-[#C6F232] hover:bg-[#B8E62B] active:scale-95 text-zinc-950 font-extrabold text-xs rounded-xl shadow-md shadow-[#C6F232]/25 transition-all cursor-pointer"
            >
              Terapkan Opname
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

