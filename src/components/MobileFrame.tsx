import React, { useState, useEffect } from 'react';
import { Wifi, Signal } from 'lucide-react';

interface MobileFrameProps {
  children: React.ReactNode;
  viewMode: 'mobile_frame' | 'responsive';
  onHardwareScanTrigger?: () => void;
}

export const MobileFrame: React.FC<MobileFrameProps> = ({
  children,
  viewMode,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('9:41');
  const [isMobileOrNative, setIsMobileOrNative] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const isCapacitor = Boolean((window as unknown as { Capacitor?: unknown }).Capacitor);
    return isCapacitor || window.innerWidth < 768;
  });

  useEffect(() => {
    const checkViewport = () => {
      const isCapacitor = Boolean((window as unknown as { Capacitor?: unknown }).Capacitor);
      setIsMobileOrNative(isCapacitor || window.innerWidth < 768);
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  useEffect(() => {
    if (viewMode === 'responsive' || isMobileOrNative) return;
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, [viewMode, isMobileOrNative]);

  // True full-screen edge-to-edge mode on phones, Capacitor APK, or responsive mode
  if (viewMode === 'responsive' || isMobileOrNative) {
    return (
      <div className="min-h-dvh w-full bg-[#f4f4f5] text-zinc-900 flex flex-col font-sans">
        <div className="flex-1 w-full flex flex-col">{children}</div>
      </div>
    );
  }

  // Optional Desktop Smartphone Preview Frame (only shown on desktop >= 768px when explicitly toggled)
  return (
    <div className="min-h-screen bg-zinc-900 py-3 sm:py-6 px-2 sm:px-4 flex flex-col items-center justify-start text-zinc-900 select-none">
      <div className="relative w-full max-w-[420px] bg-[#f4f4f5] border-[10px] border-zinc-950 rounded-[3rem] shadow-[0_25px_70px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.1)] overflow-hidden flex flex-col min-h-[780px] max-h-[94vh]">
        <div className="h-9 bg-[#f4f4f5] px-7 flex items-center justify-between text-xs text-zinc-800 select-none shrink-0 pt-1">
          <span className="font-extrabold text-zinc-950 text-xs tracking-tight">
            {currentTime}
          </span>

          <div className="w-24 h-4 bg-black rounded-full flex items-center justify-end px-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c8f53c]/80 animate-pulse" />
          </div>

          <div className="flex items-center gap-1.5 text-zinc-900">
            <Signal className="w-3.5 h-3.5 stroke-[2.5]" />
            <Wifi className="w-3.5 h-3.5 stroke-[2.5]" />
            <div className="w-5 h-2.5 rounded-sm border border-zinc-900 p-0.5 flex items-center">
              <div className="h-full w-full bg-zinc-900 rounded-2xs" />
            </div>
          </div>
        </div>

        <div className="relative flex-1 bg-[#f4f4f5] overflow-y-auto flex flex-col pb-16">
          {children}
        </div>

        <div className="bg-[#f4f4f5] py-2 flex items-center justify-center shrink-0">
          <div className="w-32 h-1 bg-zinc-300 rounded-full" />
        </div>
      </div>
    </div>
  );
};

