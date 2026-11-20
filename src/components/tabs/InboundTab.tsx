import React, { useState, useEffect } from 'react';
import {
  InventoryItem,
  InboundOrder,
  InboundItem,
  WarehouseLocation,
  WarehouseUser,
} from '../../types/warehouse';
import { CameraBarcodeScanner } from '../CameraBarcodeScanner';
import {
  PackageCheck,
  Truck,
  Scan,
  CheckCircle2,
  AlertTriangle,
  Plus,
  FileSpreadsheet,
  Building,
  User,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { soundService } from '../../utils/audio';

interface InboundTabProps {
  inventory: InventoryItem[];
  inboundOrders: InboundOrder[];
  onSaveInboundOrders: (orders: InboundOrder[]) => void;
  onConfirmInboundReceipt: (order: InboundOrder) => void;
  activeWarehouse: WarehouseLocation;
  activeUser: WarehouseUser;
  onOpenTestBarcodes: () => void;
  externalBarcodeToScan?: string | null;
  onClearExternalBarcode?: () => void;
}

export const InboundTab: React.FC<InboundTabProps> = ({
  inventory,
  inboundOrders,
  onSaveInboundOrders,
  onConfirmInboundReceipt,
  activeWarehouse,
  activeUser,
  onOpenTestBarcodes,
  externalBarcodeToScan,
  onClearExternalBarcode,
}) => {
  // Select active receiving order
  const [activeOrderId, setActiveOrderId] = useState<string>(
    inboundOrders.find((o) => o.status === 'receiving')?.id || inboundOrders[0]?.id || ''
  );

  const activeOrder = inboundOrders.find((o) => o.id === activeOrderId) || inboundOrders[0];

  // Scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [lastScannedItemName, setLastScannedItemName] = useState<string | null>(null);

  // New PO modal
  const [isCreatingPO, setIsCreatingPO] = useState(false);
  const [newPoNumber, setNewPoNumber] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [newSuratJalan, setNewSuratJalan] = useState('');

  // Handle barcode scanned during inbound
  const handleBarcodeDecoded = (code: string) => {
    if (!activeOrder) return;

    // Check if barcode matches any expected item in this PO
    const itemIndex = activeOrder.items.findIndex(
      (it) => it.barcode === code || it.sku.toLowerCase() === code.toLowerCase()
    );

    if (itemIndex >= 0) {
      const item = activeOrder.items[itemIndex];
      const updatedReceived = item.receivedQty + 1;

      const updatedItems = [...activeOrder.items];
      updatedItems[itemIndex] = {
        ...item,
        receivedQty: updatedReceived,
      };

      const updatedOrder: InboundOrder = {
        ...activeOrder,
        items: updatedItems,
        receiverOperator: activeUser.name,
      };

      const updatedOrders = inboundOrders.map((o) =>
        o.id === activeOrder.id ? updatedOrder : o
      );
      onSaveInboundOrders(updatedOrders);

      setLastScannedItemName(`${item.name} (+1 diterima)`);
      soundService.playScanBeep();
    } else {
      // Check if product exists in master inventory
      const master = inventory.find(
        (m) => m.barcode === code || m.sku.toLowerCase() === code.toLowerCase()
      );

      if (master) {
        // Add as extra line item
        const extraItem: InboundItem = {
          sku: master.sku,
          barcode: master.barcode,
          name: master.name,
          orderedQty: 0,
          receivedQty: 1,
          unit: master.unit,
          binLocation: master.defaultBin,
        };

        const updatedOrder: InboundOrder = {
          ...activeOrder,
          items: [...activeOrder.items, extraItem],
          receiverOperator: activeUser.name,
        };

        const updatedOrders = inboundOrders.map((o) =>
          o.id === activeOrder.id ? updatedOrder : o
        );
        onSaveInboundOrders(updatedOrders);

        setLastScannedItemName(`${master.name} (Tambahan luar PO)`);
        soundService.playSuccessChime();
      } else {
        soundService.playErrorBuzz();
        alert(`Barcode ${code} tidak dikenali dalam katalog.`);
      }
    }
  };

  useEffect(() => {
    if (externalBarcodeToScan) {
      handleBarcodeDecoded(externalBarcodeToScan);
      if (onClearExternalBarcode) onClearExternalBarcode();
    }
  }, [externalBarcodeToScan]);

  const handleUpdateItemReceived = (sku: string, newQty: number) => {
    if (!activeOrder) return;
    const validQty = Math.max(0, newQty);
    const updatedItems = activeOrder.items.map((it) =>
      it.sku === sku ? { ...it, receivedQty: validQty } : it
    );
    const updatedOrder = { ...activeOrder, items: updatedItems };
    const updatedOrders = inboundOrders.map((o) =>
      o.id === activeOrder.id ? updatedOrder : o
    );
    onSaveInboundOrders(updatedOrders);
  };

  const handleFinalizeReceipt = () => {
    if (!activeOrder) return;
    const confirmed = window.confirm(
      `Konfirmasi penerimaan barang untuk ${activeOrder.poNumber}? Saldo stok gudang (${activeOrder.warehouse}) akan bertambah dan mutasi masuk akan dicatat.`
    );
    if (!confirmed) return;

    onConfirmInboundReceipt(activeOrder);
    soundService.playSuccessChime();
  };

  const handleCreateNewOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const poNum = newPoNumber.trim() || `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const newOrder: InboundOrder = {
      id: 'inbound-' + Date.now(),
      poNumber: poNum,
      supplier: newSupplier.trim() || 'PT Supplier Logistik Terpadu',
      orderDate: new Date().toISOString().slice(0, 10),
      warehouse: activeWarehouse,
      status: 'receiving',
      suratJalanNumber: newSuratJalan.trim() || `SJ-${Date.now().toString().slice(-6)}`,
      receiverOperator: activeUser.name,
      notes: 'Penerimaan barang baru',
      items: inventory.slice(0, 3).map((item) => ({
        sku: item.sku,
        barcode: item.barcode,
        name: item.name,
        orderedQty: 10,
        receivedQty: 0,
        unit: item.unit,
        binLocation: item.defaultBin,
      })),
    };

    onSaveInboundOrders([newOrder, ...inboundOrders]);
    setActiveOrderId(newOrder.id);
    setIsCreatingPO(false);
    setNewPoNumber('');
    setNewSupplier('');
    setNewSuratJalan('');
    soundService.playSuccessChime();
  };

  // Metrics
  const totalOrdered = activeOrder?.items.reduce((sum, it) => sum + it.orderedQty, 0) || 0;
  const totalReceived = activeOrder?.items.reduce((sum, it) => sum + it.receivedQty, 0) || 0;
  const isAllComplete =
    activeOrder &&
    activeOrder.items.length > 0 &&
    activeOrder.items.every((it) => it.receivedQty >= it.orderedQty && it.orderedQty > 0);

  return (
    <div className="space-y-4 px-1 py-1 font-sans select-none pb-12">
      {/* Sub Fitur 1: Terima Barang Header & Dokumen PO */}
      <section className="bg-white border border-zinc-200/90 rounded-3xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200 shrink-0">
              <Truck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-black text-zinc-950 uppercase tracking-wider truncate">
                GR (Good Receipt) - Barang Masuk
              </h2>
              <p className="text-[11px] text-zinc-500 truncate">
                Penerimaan Barang Dari Supplier / Vendor (Good Receipt)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreatingPO(!isCreatingPO)}
            className="text-[11px] font-extrabold bg-[#C6F232] hover:bg-[#B8E62B] text-zinc-950 px-3 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer transition-colors shadow-xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Buat GR / PO Baru
          </button>
        </div>

        {/* Modal Buat PO Baru */}
        {isCreatingPO && (
          <form
            onSubmit={handleCreateNewOrder}
            className="p-3.5 mb-3 bg-[#F4F5F7] border border-emerald-300 rounded-2xl space-y-2.5 animate-in fade-in"
          >
            <div className="text-xs font-extrabold text-emerald-800">
              Buat Dokumen Penerimaan Good Receipt (GR) Baru
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">Nomor PO</label>
                <input
                  type="text"
                  value={newPoNumber}
                  onChange={(e) => setNewPoNumber(e.target.value)}
                  placeholder="PO-2026-0099"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                  No. Surat Jalan (SJ)
                </label>
                <input
                  type="text"
                  value={newSuratJalan}
                  onChange={(e) => setNewSuratJalan(e.target.value)}
                  placeholder="SJ-VND-5512"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                Nama Supplier / Vendor
              </label>
              <input
                type="text"
                value={newSupplier}
                onChange={(e) => setNewSupplier(e.target.value)}
                placeholder="PT Mitra Perkasa Indonesia"
                className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreatingPO(false)}
                className="px-3 py-1.5 text-xs font-bold text-zinc-600 hover:text-zinc-900 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-[#18181B] hover:bg-zinc-800 text-[#C6F232] text-xs font-bold rounded-xl cursor-pointer"
              >
                Simpan & Mulai Terima
              </button>
            </div>
          </form>
        )}

        {/* PO Selector Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-none">
          {inboundOrders.map((order) => (
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
                    activeOrderId === order.id ? 'text-[#C6F232]' : 'text-emerald-700'
                  }`}
                >
                  {order.poNumber}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    order.status === 'completed'
                      ? activeOrderId === order.id
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-emerald-100 text-emerald-700'
                      : activeOrderId === order.id
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {order.status === 'completed' ? 'SELESAI' : 'PROSES'}
                </span>
              </div>
              <div
                className={`text-[11px] truncate max-w-[140px] mt-0.5 ${
                  activeOrderId === order.id ? 'text-zinc-300' : 'text-zinc-500'
                }`}
              >
                {order.supplier}
              </div>
            </button>
          ))}
        </div>

        {/* Active PO Details Card */}
        {activeOrder && (
          <div className="bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-extrabold text-zinc-950 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-zinc-500" /> {activeOrder.supplier}
                </h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Surat Jalan:{' '}
                  <span className="text-zinc-900 font-mono font-bold">
                    {activeOrder.suratJalanNumber}
                  </span>{' '}
                  · Tgl: <span className="text-zinc-900 font-semibold">{activeOrder.orderDate}</span>
                </p>
                <p className="text-[11px] text-zinc-600">
                  Tujuan:{' '}
                  <span className="text-emerald-700 font-bold">{activeOrder.warehouse}</span> ·
                  Penerima: <span className="text-zinc-800 font-semibold">{activeOrder.receiverOperator}</span>
                </p>
              </div>

              <div className="text-right shrink-0">
                <div className="text-xs font-mono font-black text-zinc-950">
                  <span className="text-emerald-600">{totalReceived}</span> / {totalOrdered} Unit
                </div>
                <span className="text-[10px] text-zinc-500 font-semibold">Total Diterima</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${totalOrdered > 0 ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Sub Fitur 2: Scan Barang Datang */}
      {activeOrder && (
        <section className="bg-white border border-zinc-200/90 rounded-3xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-zinc-100 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#18181B] text-[#C6F232] rounded-xl">
                <Scan className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-zinc-950 uppercase tracking-wider">
                  Scan Barang Datang
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Arahkan scanner ke kemasan fisik barang kedatangan
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
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
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

          {/* Sub Fitur 3: Cek Jumlah Terima vs PO */}
          <div className="space-y-2.5 pt-1">
            <h4 className="text-xs font-black text-zinc-950 uppercase tracking-wider flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-zinc-500" /> Cek & Validasi Jumlah Terima
            </h4>

            <div className="space-y-2">
              {activeOrder.items.map((item) => {
                const isComplete = item.receivedQty === item.orderedQty;
                const isOver = item.receivedQty > item.orderedQty;
                const isPartial = item.receivedQty > 0 && item.receivedQty < item.orderedQty;

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
                          Barcode: {item.barcode} · Rak Simpan:{' '}
                          <span className="text-zinc-900 font-bold">{item.binLocation}</span>
                        </p>
                      </div>

                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shrink-0 ${
                          isComplete
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : isOver
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : isPartial
                            ? 'bg-blue-100 text-blue-700 border border-blue-200'
                            : 'bg-zinc-200 text-zinc-600'
                        }`}
                      >
                        {isComplete
                          ? '✓ LENGKAP'
                          : isOver
                          ? '⚠ LEBIH'
                          : isPartial
                          ? '● SEBAGIAN'
                          : '○ BELUM'}
                      </span>
                    </div>

                    {/* Quantity counter and verification */}
                    <div className="flex items-center justify-between pt-2 border-t border-zinc-200/70">
                      <div className="text-xs text-zinc-600 font-mono">
                        Target PO: <strong className="text-zinc-950">{item.orderedQty}</strong>{' '}
                        {item.unit}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-zinc-600">Diterima:</span>
                        <div className="flex items-center bg-white border border-zinc-200 rounded-xl overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateItemReceived(item.sku, item.receivedQty - 1)
                            }
                            className="px-2.5 py-1 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 text-xs font-black cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={item.receivedQty}
                            onChange={(e) =>
                              handleUpdateItemReceived(
                                item.sku,
                                parseInt(e.target.value) || 0
                              )
                            }
                            className="w-12 bg-white text-center py-1 text-xs font-extrabold text-emerald-700 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateItemReceived(item.sku, item.receivedQty + 1)
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

            {/* Tombol Konfirmasi Selesai Terima */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleFinalizeReceipt}
                className="w-full py-3.5 bg-[#C6F232] hover:bg-[#B8E62B] active:scale-[0.99] text-zinc-950 font-extrabold text-xs rounded-2xl shadow-lg shadow-[#C6F232]/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <PackageCheck className="w-4 h-4 stroke-[2.5]" />
                Konfirmasi Good Receipt (GR) Selesai & Tambah Saldo Stok
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
