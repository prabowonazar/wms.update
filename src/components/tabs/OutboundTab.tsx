import React, { useState, useEffect } from 'react';
import {
  InventoryItem,
  OutboundOrder,
  OutboundItem,
  WarehouseLocation,
  WarehouseUser,
} from '../../types/warehouse';
import { CameraBarcodeScanner } from '../CameraBarcodeScanner';
import {
  PackageMinus,
  Truck,
  Scan,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Send,
  Navigation,
  FileText,
  User,
  Sparkles,
  ClipboardCheck,
} from 'lucide-react';
import { soundService } from '../../utils/audio';

interface OutboundTabProps {
  inventory: InventoryItem[];
  outboundOrders: OutboundOrder[];
  onSaveOutboundOrders: (orders: OutboundOrder[]) => void;
  onConfirmOutboundDispatch: (order: OutboundOrder) => void;
  activeWarehouse: WarehouseLocation;
  activeUser: WarehouseUser;
  onOpenTestBarcodes: () => void;
  externalBarcodeToScan?: string | null;
  onClearExternalBarcode?: () => void;
}

export const OutboundTab: React.FC<OutboundTabProps> = ({
  inventory,
  outboundOrders,
  onSaveOutboundOrders,
  onConfirmOutboundDispatch,
  activeWarehouse,
  activeUser,
  onOpenTestBarcodes,
  externalBarcodeToScan,
  onClearExternalBarcode,
}) => {
  // Select active outbound order
  const [activeOrderId, setActiveOrderId] = useState<string>(
    outboundOrders.find((o) => o.status === 'picking')?.id || outboundOrders[0]?.id || ''
  );

  const activeOrder = outboundOrders.find((o) => o.id === activeOrderId) || outboundOrders[0];

  // Scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [lastScannedItemName, setLastScannedItemName] = useState<string | null>(null);

  // New DO modal
  const [isCreatingDO, setIsCreatingDO] = useState(false);
  const [newDoNumber, setNewDoNumber] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newPurpose, setNewPurpose] = useState<OutboundOrder['purpose']>('Penjualan');
  const [newDriver, setNewDriver] = useState('');
  const [newVehicle, setNewVehicle] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Handle barcode scanned during outbound
  const handleBarcodeDecoded = (code: string) => {
    if (!activeOrder) return;

    // Check if barcode matches any requested item in DO
    const itemIndex = activeOrder.items.findIndex(
      (it) => it.barcode === code || it.sku.toLowerCase() === code.toLowerCase()
    );

    if (itemIndex >= 0) {
      const item = activeOrder.items[itemIndex];
      const masterInv = inventory.find((m) => m.sku === item.sku);
      const currentStock = masterInv ? masterInv.stock[activeOrder.warehouse] || 0 : 0;

      if (currentStock <= item.pickedQty) {
        soundService.playErrorBuzz();
        alert(
          `Peringatan: Stok fisik di ${activeOrder.warehouse} tidak mencukupi! Sisa stok: ${currentStock} ${item.unit}.`
        );
        return;
      }

      const updatedPicked = item.pickedQty + 1;
      const updatedItems = [...activeOrder.items];
      updatedItems[itemIndex] = {
        ...item,
        pickedQty: updatedPicked,
      };

      const updatedOrder: OutboundOrder = {
        ...activeOrder,
        items: updatedItems,
        pickerOperator: activeUser.name,
      };

      const updatedOrders = outboundOrders.map((o) =>
        o.id === activeOrder.id ? updatedOrder : o
      );
      onSaveOutboundOrders(updatedOrders);

      setLastScannedItemName(`${item.name} (+1 diambil)`);
      soundService.playScanBeep();
    } else {
      // Not in list or unknown
      const master = inventory.find(
        (m) => m.barcode === code || m.sku.toLowerCase() === code.toLowerCase()
      );

      if (master) {
        const extraItem: OutboundItem = {
          sku: master.sku,
          barcode: master.barcode,
          name: master.name,
          requestedQty: 1,
          pickedQty: 1,
          unit: master.unit,
        };

        const updatedOrder: OutboundOrder = {
          ...activeOrder,
          items: [...activeOrder.items, extraItem],
          pickerOperator: activeUser.name,
        };

        const updatedOrders = outboundOrders.map((o) =>
          o.id === activeOrder.id ? updatedOrder : o
        );
        onSaveOutboundOrders(updatedOrders);

        setLastScannedItemName(`${master.name} (Item tambahan DO)`);
        soundService.playSuccessChime();
      } else {
        soundService.playErrorBuzz();
        alert(`Barcode ${code} tidak terdaftar di sistem.`);
      }
    }
  };

  useEffect(() => {
    if (externalBarcodeToScan) {
      handleBarcodeDecoded(externalBarcodeToScan);
      if (onClearExternalBarcode) onClearExternalBarcode();
    }
  }, [externalBarcodeToScan]);

  const handleUpdateItemPicked = (sku: string, newQty: number) => {
    if (!activeOrder) return;
    const validQty = Math.max(0, newQty);
    const updatedItems = activeOrder.items.map((it) =>
      it.sku === sku ? { ...it, pickedQty: validQty } : it
    );
    const updatedOrder = { ...activeOrder, items: updatedItems };
    const updatedOrders = outboundOrders.map((o) =>
      o.id === activeOrder.id ? updatedOrder : o
    );
    onSaveOutboundOrders(updatedOrders);
  };

  const handleFinalizeDispatch = () => {
    if (!activeOrder) return;
    const confirmed = window.confirm(
      `Konfirmasi pengeluaran barang untuk ${activeOrder.doNumber}? Saldo stok ${activeOrder.warehouse} akan dipotong dan dicatat ke Kartu Stok Keluar.`
    );
    if (!confirmed) return;

    onConfirmOutboundDispatch(activeOrder);
    soundService.playSuccessChime();
  };

  const handleCreateNewDO = (e: React.FormEvent) => {
    e.preventDefault();
    const doNum = newDoNumber.trim() || `DO-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const newOrder: OutboundOrder = {
      id: 'outbound-' + Date.now(),
      doNumber: doNum,
      destination: newDestination.trim() || 'Cabang Distribusi',
      customerName: newCustomer.trim() || 'Pelanggan / Penerima Umum',
      orderDate: new Date().toISOString().slice(0, 10),
      warehouse: activeWarehouse,
      status: 'picking',
      purpose: newPurpose,
      driverName: newDriver.trim() || 'Driver Internal',
      vehicleNumber: newVehicle.trim() || 'B 1234 WMS',
      pickerOperator: activeUser.name,
      notes: newNotes.trim() || 'Pengeluaran barang standar',
      items: inventory.slice(2, 5).map((item) => ({
        sku: item.sku,
        barcode: item.barcode,
        name: item.name,
        requestedQty: 5,
        pickedQty: 0,
        unit: item.unit,
      })),
    };

    onSaveOutboundOrders([newOrder, ...outboundOrders]);
    setActiveOrderId(newOrder.id);
    setIsCreatingDO(false);
    setNewDoNumber('');
    setNewDestination('');
    setNewCustomer('');
    setNewDriver('');
    setNewVehicle('');
    setNewNotes('');
    soundService.playSuccessChime();
  };

  // Metrics
  const totalRequested = activeOrder?.items.reduce((sum, it) => sum + it.requestedQty, 0) || 0;
  const totalPicked = activeOrder?.items.reduce((sum, it) => sum + it.pickedQty, 0) || 0;

  return (
    <div className="space-y-4 px-1 py-1 font-sans select-none pb-12">
      {/* Sub Fitur 1: Barang Keluar Header & Dokumen DO */}
      <section className="bg-white border border-zinc-200/90 rounded-3xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-red-50 text-red-600 rounded-xl border border-red-200 shrink-0">
              <PackageMinus className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-black text-zinc-950 uppercase tracking-wider truncate">
                DO (Delivery Order) - Barang Keluar
              </h2>
              <p className="text-[11px] text-zinc-500 truncate">
                Pengiriman, Transfer Cabang & Retur (Delivery Order)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreatingDO(!isCreatingDO)}
            className="text-[11px] font-extrabold bg-[#C6F232] hover:bg-[#B8E62B] text-zinc-950 px-3 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer transition-colors shadow-xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Buat DO Baru
          </button>
        </div>

        {/* Modal Buat DO Baru */}
        {isCreatingDO && (
          <form
            onSubmit={handleCreateNewDO}
            className="p-3.5 mb-3 bg-[#F4F5F7] border border-red-300 rounded-2xl space-y-2.5 animate-in fade-in"
          >
            <div className="text-xs font-extrabold text-red-700">
              Buat Dokumen Delivery Order (DO) Baru
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">Nomor DO</label>
                <input
                  type="text"
                  value={newDoNumber}
                  onChange={(e) => setNewDoNumber(e.target.value)}
                  placeholder="DO-2026-0910"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Tujuan Pengiriman
                </label>
                <input
                  type="text"
                  value={newDestination}
                  onChange={(e) => setNewDestination(e.target.value)}
                  placeholder="Cabang Surabaya / Alamat Pelanggan"
                  required
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Tujuan / Keperluan
                </label>
                <select
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value as OutboundOrder['purpose'])}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                >
                  <option value="Penjualan">Penjualan Pelanggan</option>
                  <option value="Transfer Cabang">Transfer Antar Cabang</option>
                  <option value="Retur Supplier">Retur ke Supplier</option>
                  <option value="Pemakaian Internal">Pemakaian Internal</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Nama Penerima/Customer
                </label>
                <input
                  type="text"
                  value={newCustomer}
                  onChange={(e) => setNewCustomer(e.target.value)}
                  placeholder="PT Maju Sentosa Bersama"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Nama Driver / Ekspedisi
                </label>
                <input
                  type="text"
                  value={newDriver}
                  onChange={(e) => setNewDriver(e.target.value)}
                  placeholder="J&T Cargo / Pak Dedi"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  Nomor Polisi Kendaraan
                </label>
                <input
                  type="text"
                  value={newVehicle}
                  onChange={(e) => setNewVehicle(e.target.value)}
                  placeholder="B 9821 TZX"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreatingDO(false)}
                className="px-3 py-1.5 text-xs font-bold text-zinc-600 hover:text-zinc-900 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-[#18181B] hover:bg-zinc-800 text-[#C6F232] text-xs font-bold rounded-xl cursor-pointer"
              >
                Simpan & Mulai Picking
              </button>
            </div>
          </form>
        )}

        {/* DO Selector Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-none">
          {outboundOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => setActiveOrderId(order.id)}
              className={`px-3 py-2 rounded-2xl text-left border shrink-0 transition-all cursor-pointer ${
                activeOrderId === order.id
                  ? 'bg-[#18181B] border-zinc-900 text-white shadow-sm'
                  : 'bg-[#F4F5F7] border-zinc-200 text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-[11px] font-bold ${
                    activeOrderId === order.id ? 'text-[#C6F232]' : 'text-red-600'
                  }`}
                >
                  {order.doNumber}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    order.status === 'dispatched'
                      ? activeOrderId === order.id
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-emerald-100 text-emerald-700'
                      : activeOrderId === order.id
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {order.status === 'dispatched' ? 'TERKIRIM' : 'PICKING'}
                </span>
              </div>
              <div
                className={`text-[11px] truncate max-w-[140px] mt-0.5 ${
                  activeOrderId === order.id ? 'text-zinc-300' : 'text-zinc-500'
                }`}
              >
                {order.destination}
              </div>
            </button>
          ))}
        </div>

        {/* Active DO Details Card (Sub Fitur 3: Tujuan dan Keterangan) */}
        {activeOrder && (
          <div className="bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-extrabold text-zinc-950 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-red-600" /> {activeOrder.destination}
                </h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Penerima:{' '}
                  <span className="text-zinc-900 font-bold">{activeOrder.customerName}</span> ·
                  Tujuan:{' '}
                  <span className="text-amber-700 font-mono font-bold">{activeOrder.purpose}</span>
                </p>
                <p className="text-[11px] text-zinc-600">
                  Armada:{' '}
                  <span className="text-zinc-900 font-mono font-semibold">
                    {activeOrder.vehicleNumber}
                  </span>{' '}
                  ({activeOrder.driverName}) · Picker:{' '}
                  <span className="text-zinc-900 font-semibold">{activeOrder.pickerOperator}</span>
                </p>
                {activeOrder.notes && (
                  <p className="text-[11px] text-zinc-500 italic mt-1">
                    Catatan: &ldquo;{activeOrder.notes}&rdquo;
                  </p>
                )}
              </div>

              <div className="text-right shrink-0">
                <div className="text-xs font-mono font-black text-zinc-950">
                  <span className="text-red-600">{totalPicked}</span> / {totalRequested} Unit
                </div>
                <span className="text-[10px] text-zinc-500 font-semibold">Barang Dipacking</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-red-500 h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${totalRequested > 0 ? Math.min(100, (totalPicked / totalRequested) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Sub Fitur 2: Scan Barang Keluar */}
      {activeOrder && (
        <section className="bg-white border border-zinc-200/90 rounded-3xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-zinc-100 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#18181B] text-[#C6F232] rounded-xl">
                <Scan className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-zinc-950 uppercase tracking-wider">
                  Scan Barang Keluar (Picking)
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Scan barcode item untuk validasi dan pemotongan stok
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenTestBarcodes}
                className="text-[11px] font-bold bg-[#F4F5F7] hover:bg-zinc-200 text-zinc-800 px-2.5 py-1.5 rounded-xl border border-zinc-200 flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3 text-amber-500" /> Lembar Barcode
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

          {lastScannedItemName && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-red-600" />
              <span>
                Hasil Scan Terakhir: <strong>{lastScannedItemName}</strong>
              </span>
            </div>
          )}

          {showScanner && (
            <CameraBarcodeScanner
              isScanning={showScanner}
              onScan={handleBarcodeDecoded}
              onClose={() => setShowScanner(false)}
              onOpenTestBarcodes={onOpenTestBarcodes}
            />
          )}

          {/* List Item Picking & Verification */}
          <div className="space-y-2.5 pt-1">
            <h4 className="text-xs font-black text-zinc-950 uppercase tracking-wider flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5 text-zinc-500" /> Daftar Item DO & Saldo Gudang
            </h4>

            <div className="space-y-2">
              {activeOrder.items.map((item) => {
                const master = inventory.find((m) => m.sku === item.sku);
                const currentPhysicalStock = master ? master.stock[activeOrder.warehouse] || 0 : 0;
                const isComplete = item.pickedQty >= item.requestedQty;

                return (
                  <div
                    key={item.sku}
                    className="p-3 bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-zinc-950 bg-[#C6F232] px-2 py-0.5 rounded-lg">
                            {item.sku}
                          </span>
                          <span className="text-xs font-bold text-zinc-950">{item.name}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                          Barcode: {item.barcode} · Saldo Stok Fisik:{' '}
                          <span
                            className={
                              currentPhysicalStock > 0
                                ? 'text-emerald-700 font-bold'
                                : 'text-red-600 font-bold'
                            }
                          >
                            {currentPhysicalStock} {item.unit}
                          </span>
                        </p>
                      </div>

                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shrink-0 ${
                          isComplete
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : item.pickedQty > 0
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-zinc-200 text-zinc-600'
                        }`}
                      >
                        {isComplete ? '✓ LENGKAP' : `${item.pickedQty}/${item.requestedQty}`}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-200/70">
                      <div className="text-xs text-zinc-600 font-mono">
                        Target DO: <strong className="text-zinc-950">{item.requestedQty}</strong>{' '}
                        {item.unit}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-zinc-600">Diambil:</span>
                        <div className="flex items-center bg-white border border-zinc-200 rounded-xl overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateItemPicked(item.sku, item.pickedQty - 1)
                            }
                            className="px-2.5 py-1 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 text-xs font-black cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={item.pickedQty}
                            onChange={(e) =>
                              handleUpdateItemPicked(
                                item.sku,
                                parseInt(e.target.value) || 0
                              )
                            }
                            className="w-12 bg-white text-center py-1 text-xs font-extrabold text-red-600 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateItemPicked(item.sku, item.pickedQty + 1)
                            }
                            className="px-2.5 py-1 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 text-xs font-black cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tombol Konfirmasi Selesai Pengeluaran */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleFinalizeDispatch}
                className="w-full py-3.5 bg-[#C6F232] hover:bg-[#B8E62B] active:scale-[0.99] text-zinc-950 font-extrabold text-xs rounded-2xl shadow-lg shadow-[#C6F232]/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Send className="w-4 h-4 stroke-[2.5]" />
                Konfirmasi Delivery Order (DO) Selesai & Potong Stok Gudang
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
