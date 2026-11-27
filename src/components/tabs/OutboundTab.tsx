import React, { useState, useEffect, useMemo } from 'react';
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
  Scan,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Send,
  Navigation,
  Sparkles,
  ClipboardCheck,
  Search,
  Trash2,
  Link2,
  X,
} from 'lucide-react';
import { soundService } from '../../utils/audio';

interface OutboundTabProps {
  inventory: InventoryItem[];
  outboundOrders: OutboundOrder[];
  onSaveOutboundOrders: (orders: OutboundOrder[]) => void;
  onConfirmOutboundDispatch: (order: OutboundOrder) => void;
  onLinkItemBarcode?: (sku: string, barcode: string) => void;
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
  onLinkItemBarcode,
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

  // Scanner & immediate feedback state
  const [showScanner, setShowScanner] = useState(false);
  const [lastScannedItemName, setLastScannedItemName] = useState<string | null>(null);
  const [lastScannedSku, setLastScannedSku] = useState<string | null>(null);
  const [stockWarningMsg, setStockWarningMsg] = useState<string | null>(null);

  // Unmatched barcode inline resolver (replaces blocked window.alert)
  const [unmatchedBarcode, setUnmatchedBarcode] = useState<string | null>(null);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [customNewName, setCustomNewName] = useState('');
  const [customNewQty, setCustomNewQty] = useState(1);

  // Manual catalog search to add item to DO
  const [catalogSearch, setCatalogSearch] = useState('');

  // Inline dispatch confirmation (avoids iframe confirm issues)
  const [confirmingDispatch, setConfirmingDispatch] = useState(false);

  // New DO modal
  const [isCreatingDO, setIsCreatingDO] = useState(false);
  const [newDoNumber, setNewDoNumber] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newPurpose, setNewPurpose] = useState<OutboundOrder['purpose']>('Penjualan');
  const [newDriver, setNewDriver] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const addOrIncrementOrderItem = (
    order: OutboundOrder,
    itemData: { sku: string; barcode: string; name: string; unit: string },
    qtyToAdd = 1
  ) => {
    const existingIndex = order.items.findIndex(
      (it) => it.sku.trim().toLowerCase() === itemData.sku.trim().toLowerCase()
    );

    const masterInv = inventory.find((m) => m.sku === itemData.sku);
    const currentStock = masterInv ? masterInv.stock[order.warehouse] || 0 : 0;

    let updatedItems: OutboundItem[];
    let nextPickedQty = qtyToAdd;

    if (existingIndex >= 0) {
      const existing = order.items[existingIndex];
      nextPickedQty = existing.pickedQty + qtyToAdd;
      const updatedItem: OutboundItem = {
        ...existing,
        pickedQty: nextPickedQty,
        requestedQty: Math.max(existing.requestedQty, nextPickedQty),
      };
      // Move recently scanned item to top so it's immediately visible
      updatedItems = [
        updatedItem,
        ...order.items.filter((_, idx) => idx !== existingIndex),
      ];
    } else {
      const newItem: OutboundItem = {
        sku: itemData.sku,
        barcode: itemData.barcode,
        name: itemData.name,
        requestedQty: qtyToAdd,
        pickedQty: qtyToAdd,
        unit: itemData.unit || 'PCS',
      };
      updatedItems = [newItem, ...order.items];
    }

    const updatedOrder: OutboundOrder = {
      ...order,
      items: updatedItems,
      pickerOperator: activeUser.name,
    };

    const updatedOrders = outboundOrders.map((o) =>
      o.id === order.id ? updatedOrder : o
    );
    onSaveOutboundOrders(updatedOrders);

    setLastScannedSku(itemData.sku);
    setLastScannedItemName(`${itemData.name} (Qty: ${nextPickedQty})`);
    setUnmatchedBarcode(null);
    setLinkSearchQuery('');

    if (masterInv && currentStock < nextPickedQty) {
      setStockWarningMsg(
        `Stok ${itemData.name} di ${order.warehouse} saat ini ${currentStock} ${itemData.unit} (lebih kecil dari Qty DO ${nextPickedQty}).`
      );
    } else {
      setStockWarningMsg(null);
    }
  };

  // Handle barcode scanned during outbound
  const handleBarcodeDecoded = (code: string) => {
    if (!activeOrder) return;
    const rawTrimmed = code.trim();
    if (!rawTrimmed) return;
    const normalized = rawTrimmed.toLowerCase();

    // 1. Check if barcode matches any item already in DO
    const existingItem = activeOrder.items.find(
      (it) =>
        it.barcode.trim().toLowerCase() === normalized ||
        it.sku.trim().toLowerCase() === normalized
    );

    if (existingItem) {
      addOrIncrementOrderItem(
        activeOrder,
        {
          sku: existingItem.sku,
          barcode: existingItem.barcode,
          name: existingItem.name,
          unit: existingItem.unit,
        },
        1
      );
      soundService.playScanBeep();
      return;
    }

    // 2. Check master inventory by barcode or SKU
    const master = inventory.find(
      (m) =>
        m.barcode.trim().toLowerCase() === normalized ||
        m.sku.trim().toLowerCase() === normalized
    );

    if (master) {
      addOrIncrementOrderItem(
        activeOrder,
        {
          sku: master.sku,
          barcode: master.barcode,
          name: master.name,
          unit: master.unit,
        },
        1
      );
      soundService.playSuccessChime();
      return;
    }

    // 3. Barcode not found in catalog -> show inline linking/add card instead of blocked alert()
    soundService.playErrorBuzz();
    setUnmatchedBarcode(rawTrimmed);
    setLinkSearchQuery('');
    setCustomNewName('');
    setCustomNewQty(1);
    setLastScannedItemName(null);
    setStockWarningMsg(null);
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
      it.sku === sku
        ? {
            ...it,
            pickedQty: validQty,
            requestedQty: Math.max(it.requestedQty, validQty),
          }
        : it
    );
    const updatedOrder = { ...activeOrder, items: updatedItems };
    const updatedOrders = outboundOrders.map((o) =>
      o.id === activeOrder.id ? updatedOrder : o
    );
    onSaveOutboundOrders(updatedOrders);

    const masterInv = inventory.find((m) => m.sku === sku);
    if (masterInv) {
      const currentStock = masterInv.stock[activeOrder.warehouse] || 0;
      if (currentStock < validQty) {
        setStockWarningMsg(
          `Stok ${masterInv.name} di ${activeOrder.warehouse} saat ini ${currentStock} ${masterInv.unit} (lebih kecil dari Qty DO ${validQty}).`
        );
      } else {
        setStockWarningMsg(null);
      }
    }
  };

  const handleRemoveOrderItem = (sku: string) => {
    if (!activeOrder) return;
    const updatedItems = activeOrder.items.filter((it) => it.sku !== sku);
    const updatedOrder = { ...activeOrder, items: updatedItems };
    const updatedOrders = outboundOrders.map((o) =>
      o.id === activeOrder.id ? updatedOrder : o
    );
    onSaveOutboundOrders(updatedOrders);
    if (lastScannedSku === sku) {
      setLastScannedSku(null);
      setLastScannedItemName(null);
    }
  };

  const handleLinkScannedBarcodeToCatalog = (item: InventoryItem) => {
    if (!activeOrder || !unmatchedBarcode) return;
    if (onLinkItemBarcode) {
      onLinkItemBarcode(item.sku, unmatchedBarcode);
    }
    addOrIncrementOrderItem(
      activeOrder,
      {
        sku: item.sku,
        barcode: unmatchedBarcode,
        name: item.name,
        unit: item.unit,
      },
      1
    );
    soundService.playSuccessChime();
  };

  const handleAddCustomBarcodeItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder || !unmatchedBarcode) return;
    const label = customNewName.trim() || `Produk (${unmatchedBarcode})`;
    const qty = Math.max(1, customNewQty || 1);
    const customSku = `SKU-${unmatchedBarcode.slice(-6).toUpperCase()}`;

    addOrIncrementOrderItem(
      activeOrder,
      {
        sku: customSku,
        barcode: unmatchedBarcode,
        name: label,
        unit: 'PCS',
      },
      qty
    );
    soundService.playSuccessChime();
  };

  const handleFinalizeDispatch = () => {
    if (!activeOrder) return;
    setConfirmingDispatch(false);
    onConfirmOutboundDispatch(activeOrder);
    soundService.playSuccessChime();
  };

  const handleCreateNewDO = (e: React.FormEvent) => {
    e.preventDefault();
    const doNum =
      newDoNumber.trim() ||
      `DO-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
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
      pickerOperator: activeUser.name,
      notes: newNotes.trim() || 'Pengeluaran barang standar',
      items: [],
    };

    onSaveOutboundOrders([newOrder, ...outboundOrders]);
    setActiveOrderId(newOrder.id);
    setIsCreatingDO(false);
    setNewDoNumber('');
    setNewDestination('');
    setNewCustomer('');
    setNewDriver('');
    setNewNotes('');
    setLastScannedSku(null);
    setLastScannedItemName(null);
    setUnmatchedBarcode(null);
    setShowScanner(true);
    soundService.playSuccessChime();
  };

  const catalogSearchResults = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return [];
    return inventory
      .filter(
        (it) =>
          it.sku.toLowerCase().includes(q) ||
          it.name.toLowerCase().includes(q) ||
          it.barcode.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [inventory, catalogSearch]);

  const linkSearchResults = useMemo(() => {
    const q = linkSearchQuery.trim().toLowerCase();
    if (!q) return inventory.slice(0, 6);
    return inventory
      .filter(
        (it) =>
          it.sku.toLowerCase().includes(q) ||
          it.name.toLowerCase().includes(q) ||
          it.barcode.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [inventory, linkSearchQuery]);

  const lastScannedItemObj = useMemo(() => {
    if (!activeOrder || !lastScannedSku) return null;
    return activeOrder.items.find((it) => it.sku === lastScannedSku) || null;
  }, [activeOrder, lastScannedSku]);

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
              onClick={() => {
                setActiveOrderId(order.id);
                setLastScannedSku(null);
                setLastScannedItemName(null);
                setUnmatchedBarcode(null);
                setStockWarningMsg(null);
              }}
              className={`px-3 py-2 rounded-2xl text-left border shrink-0 transition-all cursor-pointer ${
                activeOrder?.id === order.id
                  ? 'bg-[#18181B] border-zinc-900 text-white shadow-sm'
                  : 'bg-[#F4F5F7] border-zinc-200 text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-[11px] font-bold ${
                    activeOrder?.id === order.id ? 'text-[#C6F232]' : 'text-red-600'
                  }`}
                >
                  {order.doNumber}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    order.status === 'dispatched'
                      ? activeOrder?.id === order.id
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-emerald-100 text-emerald-700'
                      : activeOrder?.id === order.id
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {order.status === 'dispatched' ? 'TERKIRIM' : 'PICKING'}
                </span>
              </div>
              <div
                className={`text-[11px] truncate max-w-[140px] mt-0.5 ${
                  activeOrder?.id === order.id ? 'text-zinc-300' : 'text-zinc-500'
                }`}
              >
                {order.destination}
              </div>
            </button>
          ))}
        </div>

        {/* Active DO Details Card */}
        {activeOrder ? (
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
                  Driver / Ekspedisi:{' '}
                  <span className="text-zinc-900 font-semibold">{activeOrder.driverName}</span> ·{' '}
                  Picker:{' '}
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

            <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-red-500 h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${totalRequested > 0 ? Math.min(100, (totalPicked / totalRequested) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        ) : (
          !isCreatingDO && (
            <div className="text-xs text-zinc-500 py-4 text-center bg-[#F4F5F7] border border-zinc-200/80 rounded-2xl">
              Belum ada dokumen Delivery Order (DO). Klik tombol &ldquo;Buat DO Baru&rdquo; untuk memulai.
            </div>
          )
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
                  Scan barcode item untuk langsung tampil &amp; atur Qty keluar
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

          {showScanner && (
            <CameraBarcodeScanner
              isScanning={showScanner}
              onScan={handleBarcodeDecoded}
              onClose={() => setShowScanner(false)}
              onOpenTestBarcodes={onOpenTestBarcodes}
            />
          )}

          {/* IMMEDIATE INTERACTIVE SCANNED ITEM CARD (Appears right below scanner so Qty can be added immediately!) */}
          {lastScannedItemObj && (
            <div className="p-3.5 bg-zinc-950 text-white border-2 border-[#C6F232] rounded-2xl shadow-md space-y-2.5 animate-in fade-in">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <CheckCircle2 className="w-4 h-4 text-[#C6F232] shrink-0" />
                    <span className="text-[10px] font-mono font-black uppercase text-[#C6F232]">
                      Produk Terbaca — Atur Qty Keluar
                    </span>
                    <span className="font-mono text-[10px] bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded-md">
                      {lastScannedItemObj.sku}
                    </span>
                  </div>
                  <h4 className="text-xs font-extrabold text-white mt-1">
                    {lastScannedItemObj.name}
                  </h4>
                  <p className="text-[11px] font-mono text-zinc-400">
                    Barcode: {lastScannedItemObj.barcode}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setLastScannedSku(null);
                    setLastScannedItemName(null);
                  }}
                  className="p-1 text-zinc-400 hover:text-white rounded-lg cursor-pointer"
                  title="Tutup kartu sorotan"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800">
                <div className="text-[11px] font-mono text-zinc-300">
                  Stok {activeOrder.warehouse}:{' '}
                  <strong className="text-[#C6F232]">
                    {inventory.find((m) => m.sku === lastScannedItemObj.sku)?.stock[
                      activeOrder.warehouse
                    ] || 0}{' '}
                    {lastScannedItemObj.unit}
                  </strong>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-zinc-300">Qty Keluar:</span>
                  <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateItemPicked(
                          lastScannedItemObj.sku,
                          lastScannedItemObj.pickedQty - 1
                        )
                      }
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-black cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={lastScannedItemObj.pickedQty}
                      onChange={(e) =>
                        handleUpdateItemPicked(
                          lastScannedItemObj.sku,
                          parseInt(e.target.value) || 0
                        )
                      }
                      className="w-14 bg-zinc-950 text-center py-1.5 text-sm font-black text-[#C6F232] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateItemPicked(
                          lastScannedItemObj.sku,
                          lastScannedItemObj.pickedQty + 1
                        )
                      }
                      className="px-3 py-1.5 bg-[#C6F232] hover:bg-[#B8E62B] text-zinc-950 text-sm font-black cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* INLINE STOCK WARNING BANNER */}
          {stockWarningMsg && (
            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-2xl text-xs text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{stockWarningMsg}</span>
            </div>
          )}

          {/* INLINE UNMATCHED BARCODE RESOLVER (Appears when scanned barcode isn't linked to a product yet!) */}
          {unmatchedBarcode && (
            <div className="p-3.5 bg-amber-50 border-2 border-amber-400 rounded-2xl space-y-3 animate-in fade-in">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Barcode Terbaca: <span className="font-mono underline">{unmatchedBarcode}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Barcode ini belum terhubung ke barang di katalog. Pilih barang di bawah untuk menghubungkan &amp; menambahkan Qty DO, atau input sebagai item baru:
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUnmatchedBarcode(null)}
                  className="p-1 text-amber-700 hover:text-amber-950 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search & Link to existing catalog item */}
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={linkSearchQuery}
                    onChange={(e) => setLinkSearchQuery(e.target.value)}
                    placeholder="Cari nama barang / SKU untuk dihubungkan..."
                    className="w-full bg-white border border-amber-300 rounded-xl pl-8 pr-3 py-2 text-xs font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                  />
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1 bg-white border border-amber-200 rounded-xl p-1.5">
                  {linkSearchResults.map((inv) => (
                    <button
                      key={inv.sku}
                      type="button"
                      onClick={() => handleLinkScannedBarcodeToCatalog(inv)}
                      className="w-full text-left p-2 hover:bg-[#F4F5F7] rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold bg-[#C6F232] text-zinc-950 px-1.5 py-0.5 rounded">
                            {inv.sku}
                          </span>
                          <span className="text-xs font-bold text-zinc-900 truncate">
                            {inv.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          Stok {activeOrder.warehouse}: {inv.stock[activeOrder.warehouse] || 0} {inv.unit}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold bg-[#18181B] text-[#C6F232] px-2 py-1 rounded-lg flex items-center gap-1 shrink-0">
                        <Link2 className="w-3 h-3" /> Pilih &amp; +1 Qty
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick add as custom DO line item */}
              <form
                onSubmit={handleAddCustomBarcodeItem}
                className="pt-2 border-t border-amber-200 flex flex-col sm:flex-row gap-2"
              >
                <input
                  type="text"
                  value={customNewName}
                  onChange={(e) => setCustomNewName(e.target.value)}
                  placeholder={`Nama barang (default: Produk ${unmatchedBarcode})`}
                  className="flex-1 bg-white border border-amber-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-zinc-900 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={customNewQty}
                    onChange={(e) => setCustomNewQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 bg-white border border-amber-300 rounded-xl px-2 py-1.5 text-xs font-bold text-center text-zinc-900"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-[#18181B] hover:bg-zinc-800 text-[#C6F232] text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    + Tambah Item Baru
                  </button>
                </div>
              </form>
            </div>
          )}

          {lastScannedItemName && !lastScannedItemObj && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-red-600" />
              <span>
                Hasil Scan Terakhir: <strong>{lastScannedItemName}</strong>
              </span>
            </div>
          )}

          {/* Manual Quick Catalog Search to Add Products to DO */}
          <div className="pt-1 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Cari & tambah produk ke DO (ketik SKU / Nama / Barcode)..."
                className="w-full bg-[#F4F5F7] border border-zinc-200 focus:border-zinc-900 rounded-xl pl-8 pr-8 py-2 text-xs font-semibold text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
              />
              {catalogSearch && (
                <button
                  type="button"
                  onClick={() => setCatalogSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {catalogSearchResults.length > 0 && (
              <div className="max-h-44 overflow-y-auto bg-white border border-zinc-200 rounded-2xl p-1.5 space-y-1 shadow-sm">
                {catalogSearchResults.map((inv) => (
                  <button
                    key={inv.sku}
                    type="button"
                    onClick={() => {
                      addOrIncrementOrderItem(
                        activeOrder,
                        {
                          sku: inv.sku,
                          barcode: inv.barcode,
                          name: inv.name,
                          unit: inv.unit,
                        },
                        1
                      );
                      setCatalogSearch('');
                      soundService.playScanBeep();
                    }}
                    className="w-full text-left p-2 hover:bg-[#F4F5F7] rounded-xl flex items-center justify-between gap-2 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold bg-[#C6F232] text-zinc-950 px-1.5 py-0.5 rounded">
                          {inv.sku}
                        </span>
                        <span className="text-xs font-bold text-zinc-900 truncate">{inv.name}</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        Stok {activeOrder.warehouse}: {inv.stock[activeOrder.warehouse] || 0}{' '}
                        {inv.unit}
                      </span>
                    </div>
                    <span className="text-[11px] font-extrabold bg-[#18181B] text-[#C6F232] px-2.5 py-1 rounded-lg shrink-0">
                      + Tambah
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* List Item Picking & Verification */}
          <div className="space-y-2.5 pt-1">
            <h4 className="text-xs font-black text-zinc-950 uppercase tracking-wider flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5 text-zinc-500" /> Daftar Item DO &amp; Saldo
              Gudang ({activeOrder.items.length})
            </h4>

            {activeOrder.items.length === 0 ? (
              <div className="p-4 bg-[#F4F5F7] border border-dashed border-zinc-300 rounded-2xl text-center text-xs text-zinc-500">
                Belum ada item di DO ini. Scan barcode pakai kamera atau cari barang di kolom atas untuk menambahkan Qty.
              </div>
            ) : (
              <div className="space-y-2">
                {activeOrder.items.map((item) => {
                  const master = inventory.find((m) => m.sku === item.sku);
                  const currentPhysicalStock = master
                    ? master.stock[activeOrder.warehouse] || 0
                    : 0;
                  const isComplete = item.pickedQty >= item.requestedQty && item.pickedQty > 0;
                  const isRecentlyScanned = lastScannedSku === item.sku;

                  return (
                    <div
                      key={item.sku}
                      className={`p-3 rounded-2xl flex flex-col gap-2 border transition-all ${
                        isRecentlyScanned
                          ? 'bg-lime-50/70 border-[#C6F232] shadow-xs'
                          : 'bg-[#F4F5F7] border-zinc-200/80'
                      }`}
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

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                              isComplete
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                : item.pickedQty > 0
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-zinc-200 text-zinc-600'
                            }`}
                          >
                            {isComplete ? '✓ SIAP' : `${item.pickedQty}/${item.requestedQty}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveOrderItem(item.sku)}
                            className="p-1 text-zinc-400 hover:text-red-600 rounded-lg cursor-pointer"
                            title="Hapus item dari DO"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
            )}

            {/* Tombol Konfirmasi Selesai Pengeluaran */}
            <div className="pt-2">
              {confirmingDispatch ? (
                <div className="p-3 bg-zinc-950 text-white rounded-2xl space-y-2.5">
                  <p className="text-xs font-semibold text-zinc-200">
                    Konfirmasi pengeluaran barang untuk{' '}
                    <strong className="text-[#C6F232]">{activeOrder.doNumber}</strong>? Saldo stok{' '}
                    <strong>{activeOrder.warehouse}</strong> akan dipotong dan dicatat ke Kartu Stok.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingDispatch(false)}
                      className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleFinalizeDispatch}
                      className="flex-2 py-2 bg-[#C6F232] hover:bg-[#B8E62B] text-zinc-950 text-xs font-extrabold rounded-xl cursor-pointer"
                    >
                      Ya, Potong Stok &amp; Selesai
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={activeOrder.items.length === 0}
                  onClick={() => setConfirmingDispatch(true)}
                  className="w-full py-3.5 bg-[#C6F232] hover:bg-[#B8E62B] disabled:bg-zinc-200 disabled:text-zinc-400 active:scale-[0.99] text-zinc-950 font-extrabold text-xs rounded-2xl shadow-lg shadow-[#C6F232]/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed disabled:shadow-none"
                >
                  <Send className="w-4 h-4 stroke-[2.5]" />
                  Konfirmasi Delivery Order (DO) Selesai &amp; Potong Stok Gudang
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
