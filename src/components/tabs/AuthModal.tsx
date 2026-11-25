import React from 'react';
import {
  WarehouseLocation,
  WarehouseUser,
  getAllowedWarehousesForUser,
} from '../../types/warehouse';
import {
  Shield,
  Lock,
  CheckCircle2,
  X,
  AlertCircle,
  Cloud,
  Loader2,
  UploadCloud,
  MapPin,
  LogOut,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeUser: WarehouseUser | null;
  lockedCloudOperator?: WarehouseUser | null;
  cloudUser?: {
    email?: string | null;
    displayName?: string | null;
    photoURL?: string | null;
  } | null;
  isCloudSyncing?: boolean;
  cloudError?: string | null;
  cloudSuccessMsg?: string | null;
  totalInventoryCount?: number;
  onCloudSignOut?: () => void;
  onSyncAllToCloud?: () => void;
}

const WAREHOUSE_DISPLAY: Record<WarehouseLocation, string> = {
  'Gudang Pusat': 'Gudang Jakarta',
  'Gudang Meruya': 'Gudang Meruya',
  'Gudang Denpasar': 'Gudang Bali',
  'Gudang Surabaya': 'Gudang Surabaya',
};

function getOperatorScopeLabel(user: WarehouseUser): string {
  const allowed = getAllowedWarehousesForUser(user);
  if (allowed.length >= 4) {
    return 'Akses Semua Gudang (Jakarta, Meruya, Bali, Surabaya)';
  }
  return user.warehouseLabel || `Hanya ${WAREHOUSE_DISPLAY[allowed[0] || 'Gudang Pusat']}`;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  activeUser,
  lockedCloudOperator = null,
  cloudUser,
  isCloudSyncing = false,
  cloudError,
  cloudSuccessMsg,
  totalInventoryCount = 0,
  onCloudSignOut,
  onSyncAllToCloud,
}) => {
  if (!isOpen) return null;

  const currentOperator = lockedCloudOperator || activeUser;
  const allowedCount = currentOperator ? getAllowedWarehousesForUser(currentOperator).length : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-sm max-h-[90dvh] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#C6F232]/15 border border-[#C6F232]/30 text-[#C6F232] rounded-xl">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                Akun Saya & Cloud Sync
              </h2>
              <p className="text-[11px] text-zinc-400">
                Login Per Akun Operator Gudang
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3.5 overflow-y-auto">
          {/* Active Operator Card */}
          {currentOperator && (
            <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center gap-3">
              <img
                src={currentOperator.avatar}
                alt={currentOperator.name}
                className="w-11 h-11 rounded-full border border-[#C6F232]/60 object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-white truncate">
                    {currentOperator.name}
                  </h3>
                  <span className="text-[9px] bg-[#C6F232]/20 text-[#C6F232] px-1.5 py-0.5 rounded font-bold shrink-0">
                    AKTIF
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                  {cloudUser?.email || currentOperator.nik}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-300 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="font-semibold truncate">
                    {getOperatorScopeLabel(currentOperator)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Access Scope Info */}
          <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 text-[11px] text-zinc-300 flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>
              {allowedCount >= 4
                ? 'Akun Anda memiliki akses penuh ke seluruh cabang gudang. Untuk memakai akun operator lain, silakan keluar lalu login dengan email & password akun tersebut.'
                : 'Hak akses gudang terkunci otomatis sesuai akun Anda. Untuk berganti operator, klik Keluar Akun lalu login dengan email & password operator lain.'}
            </span>
          </div>

          {/* Cloud Sync Card */}
          <div className="p-3.5 rounded-xl border bg-emerald-950/30 border-emerald-500/40 space-y-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg shrink-0 bg-emerald-500/20 text-emerald-400">
                {isCloudSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Cloud className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-white truncate">
                  Cloud Sync Aktif
                </div>
                <div className="text-[10px] text-zinc-400 truncate">
                  {cloudUser?.email || cloudUser?.displayName || 'Terhubung ke Firebase'}
                </div>
              </div>
            </div>

            {onSyncAllToCloud && (
              <button
                type="button"
                onClick={onSyncAllToCloud}
                disabled={isCloudSyncing}
                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>
                  {isCloudSyncing
                    ? 'Menyimpan semua data ke Firebase...'
                    : `Simpan Semua Data ke Firebase (${totalInventoryCount} Barang & Transaksi)`}
                </span>
              </button>
            )}

            {cloudSuccessMsg && (
              <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-[10px] text-emerald-300 flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                <span>{cloudSuccessMsg}</span>
              </div>
            )}

            {cloudError && (
              <div className="p-2 rounded-lg bg-red-950/60 border border-red-500/40 text-[10px] text-red-300 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                <span>{cloudError}</span>
              </div>
            )}
          </div>

          {/* Sign Out Button */}
          {onCloudSignOut && (
            <button
              type="button"
              onClick={onCloudSignOut}
              disabled={isCloudSyncing}
              className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-red-950/70 hover:text-red-200 hover:border-red-500/40 border border-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" />
              <span>Keluar / Ganti Akun</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
