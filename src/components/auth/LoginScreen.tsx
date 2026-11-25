import React, { useState } from 'react';
import { WarehouseLocation } from '../../types/warehouse';
import {
  Shield,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  MapPin,
} from 'lucide-react';

interface LoginScreenProps {
  isLoading?: boolean;
  error?: string | null;
  successMsg?: string | null;
  onSignIn: (email: string, password: string) => void;
  onRegister: (
    email: string,
    password: string,
    displayName?: string,
    assignedWarehouse?: WarehouseLocation
  ) => void;
  onPasswordReset: (email: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  isLoading = false,
  error,
  successMsg,
  onSignIn,
  onRegister,
  onPasswordReset,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [assignedWarehouse, setAssignedWarehouse] = useState<WarehouseLocation>('Gudang Pusat');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setValidationError('Masukkan alamat email yang valid.');
      return;
    }
    if (password.length < 6) {
      setValidationError('Password minimal 6 karakter.');
      return;
    }

    if (authMode === 'login') {
      onSignIn(trimmedEmail, password);
    } else {
      const trimmedName = fullName.trim();
      if (!trimmedName) {
        setValidationError('Isi nama lengkap Anda terlebih dahulu.');
        return;
      }
      onRegister(trimmedEmail, password, trimmedName, assignedWarehouse);
    }
  };

  const handleReset = () => {
    setValidationError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setValidationError('Isi alamat email terlebih dahulu untuk reset password.');
      return;
    }
    onPasswordReset(trimmedEmail);
  };

  return (
    <div className="flex-1 w-full min-h-full bg-zinc-950 text-white flex flex-col justify-center px-5 py-8 overflow-y-auto">
      <div className="w-full max-w-sm mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2.5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#C6F232]/15 border border-[#C6F232]/40 flex items-center justify-center shadow-lg">
            <Shield className="w-7 h-7 text-[#C6F232]" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">
              Fascosanwira WMS
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Masuk dengan akun operator masing-masing
            </p>
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4">
          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setValidationError(null);
              }}
              className={`py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                authMode === 'login'
                  ? 'bg-[#C6F232] text-zinc-950'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Masuk Akun
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setValidationError(null);
              }}
              className={`py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                authMode === 'register'
                  ? 'bg-[#C6F232] text-zinc-950'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Daftar Baru
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {authMode === 'register' && (
              <>
                <div>
                  <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                    Nama Lengkap
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Masukkan nama Anda"
                      autoComplete="name"
                      className="w-full pl-9 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#C6F232]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                    Lokasi Gudang
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      value={assignedWarehouse}
                      onChange={(e) => setAssignedWarehouse(e.target.value as WarehouseLocation)}
                      className="w-full pl-9 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:border-[#C6F232]"
                    >
                      <option value="Gudang Pusat">Gudang Jakarta (Pusat)</option>
                      <option value="Gudang Meruya">Gudang Meruya</option>
                      <option value="Gudang Denpasar">Gudang Bali (Denpasar)</option>
                      <option value="Gudang Surabaya">Gudang Surabaya</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                Email Akun
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@fascosanwira.com"
                  autoComplete="email"
                  className="w-full pl-9 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#C6F232]"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full pl-9 pr-10 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#C6F232]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authMode === 'login' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isLoading}
                  className="text-[11px] text-zinc-400 hover:text-[#C6F232] underline underline-offset-2 cursor-pointer disabled:opacity-50"
                >
                  Lupa password?
                </button>
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <span>{successMsg}</span>
              </div>
            )}

            {(validationError || error) && (
              <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-[11px] text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{validationError || error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-[#C6F232] hover:bg-[#d5f855] text-zinc-950 rounded-xl text-xs font-extrabold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {isLoading
                  ? 'Memproses...'
                  : authMode === 'login'
                  ? 'Masuk ke Gudang'
                  : 'Daftar & Masuk'}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
