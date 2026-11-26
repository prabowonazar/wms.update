import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CameraOff,
  Zap,
  ZapOff,
  RefreshCw,
  Keyboard,
  QrCode,
  Maximize2,
  Minimize2,
  Focus,
  ZoomIn,
  CheckCircle2,
  Pause,
  Play,
  X,
} from 'lucide-react';
import { soundService } from '../utils/audio';

interface CameraBarcodeScannerProps {
  onScan: (decodedText: string) => void;
  isScanning: boolean;
  onClose?: () => void;
  onOpenTestBarcodes?: () => void;
}

interface DetectedCamera {
  id: string;
  label: string;
}

export const CameraBarcodeScanner: React.FC<CameraBarcodeScannerProps> = ({
  onScan,
  isScanning,
  onClose,
  onOpenTestBarcodes,
}) => {
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [availableCameras, setAvailableCameras] = useState<DetectedCamera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState<string>('');
  const [showManual, setShowManual] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [verifyingText, setVerifyingText] = useState<string | null>(null);

  // Zoom & Autofocus state
  const [zoomSupported, setZoomSupported] = useState<boolean>(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({
    min: 1,
    max: 3,
    step: 0.1,
  });
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [focusStatus, setFocusStatus] = useState<string | null>(null);
  const [tapFocusPoint, setTapFocusPoint] = useState<{ x: number; y: number; key: number } | null>(
    null
  );
  const [lastScannedFlash, setLastScannedFlash] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState<number>(0);

  const html5QrCodeRef = useRef<any>(null);
  const onScanRef = useRef(onScan);
  const isPausedRef = useRef(false);
  const lastDecodedRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const globalCooldownUntilRef = useRef<number>(0);
  const candidateRef = useRef<{ code: string; count: number; lastTime: number } | null>(null);
  const scannerContainerId = 'warehouse-qr-reader';
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    isPausedRef.current = isPaused;
    if (isPaused) {
      candidateRef.current = null;
      setVerifyingText(null);
    }
  }, [isPaused]);

  const getActiveVideoTrack = (): MediaStreamTrack | null => {
    const container = document.getElementById(scannerContainerId);
    const videoEl = container?.querySelector('video') as HTMLVideoElement | null;
    const stream = videoEl?.srcObject as MediaStream | null;
    return stream?.getVideoTracks?.()[0] || null;
  };

  const applyContinuousAutofocus = useCallback(async (scanner: any) => {
    try {
      const capabilities = scanner.getRunningTrackCapabilities?.() as any;
      if (capabilities?.focusMode && Array.isArray(capabilities.focusMode)) {
        if (capabilities.focusMode.includes('continuous')) {
          await scanner.applyVideoConstraints({
            advanced: [{ focusMode: 'continuous' } as any],
          });
        }
      }
    } catch {
      const track = getActiveVideoTrack();
      if (track) {
        try {
          const caps = (track.getCapabilities?.() as any) || {};
          if (caps.focusMode?.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as any],
            });
          }
        } catch {
          // ignore on unsupported browsers
        }
      }
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch {
        // ignore cleanup errors
      }
      html5QrCodeRef.current = null;
    }
    candidateRef.current = null;
    setVerifyingText(null);
    setCameraActive(false);
    setTorchOn(false);
  }, []);

  // Start real camera scanner via Html5Qrcode
  useEffect(() => {
    let isMounted = true;

    async function initScanner() {
      if (!isScanning) {
        await stopScanner();
        return;
      }

      setCameraError(null);
      setTorchOn(false);
      candidateRef.current = null;
      setVerifyingText(null);

      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (!isMounted) return;

        await stopScanner();

        // Restrict to reliable warehouse 1D/2D formats (excludes noisy ITF/CODABAR/RSS that cause phantom jumps)
        const supportedFormats = [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.PDF_417,
        ];

        const scanner = new Html5Qrcode(scannerContainerId, {
          verbose: false,
          formatsToSupport: supportedFormats,
          // ZXing enforces quiet-zone & check digits reliably across mobile browsers and respects qrbox crop
          useBarCodeDetectorIfSupported: false,
        });
        html5QrCodeRef.current = scanner;

        // Clean HD video constraints for sharp 1D bar contrast
        const videoConstraints: MediaTrackConstraints = selectedCameraId
          ? {
              deviceId: { exact: selectedCameraId },
              width: { min: 640, ideal: 1280 },
              height: { min: 480, ideal: 720 },
            }
          : {
              facingMode: facingMode,
              width: { min: 640, ideal: 1280 },
              height: { min: 480, ideal: 720 },
            };

        const config = {
          fps: 10,
          disableFlip: facingMode !== 'user',
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const maxW = Math.max(120, viewfinderWidth - 20);
            const maxH = Math.max(90, viewfinderHeight - 20);
            const width = Math.min(maxW, Math.max(180, Math.floor(viewfinderWidth * 0.85)));
            const height = Math.min(maxH, Math.max(120, Math.floor(viewfinderHeight * 0.55)));
            return { width, height };
          },
          videoConstraints,
        };

        await scanner.start(
          selectedCameraId ? selectedCameraId : { facingMode },
          config,
          (decodedText: string, decodedResult?: any) => {
            if (isPausedRef.current) return;

            const clean = decodedText.trim();
            if (!clean || clean.length < 2) return;

            const now = Date.now();

            // 1. Global post-scan lock so camera doesn't jump to another label right after a read
            if (now < globalCooldownUntilRef.current) {
              return;
            }

            // 2. Suppress exact same code repeat within 2.5 seconds
            if (
              lastDecodedRef.current.code === clean &&
              now - lastDecodedRef.current.time < 2500
            ) {
              return;
            }

            // 3. Multi-frame consensus stabilizer: require consecutive identical reads before accepting
            const formatId = decodedResult?.result?.format?.format;
            const is2D =
              formatId === Html5QrcodeSupportedFormats.QR_CODE ||
              formatId === Html5QrcodeSupportedFormats.DATA_MATRIX ||
              formatId === Html5QrcodeSupportedFormats.PDF_417;
            const requiredMatches = is2D ? 2 : 3;

            const prevCandidate = candidateRef.current;
            if (
              prevCandidate &&
              prevCandidate.code === clean &&
              now - prevCandidate.lastTime <= 1000
            ) {
              const nextCount = prevCandidate.count + 1;
              candidateRef.current = { code: clean, count: nextCount, lastTime: now };

              if (nextCount < requiredMatches) {
                setVerifyingText(`${nextCount}/${requiredMatches}`);
                setTimeout(() => {
                  if (candidateRef.current && Date.now() - candidateRef.current.lastTime >= 1000) {
                    candidateRef.current = null;
                    setVerifyingText(null);
                  }
                }, 1050);
                return;
              }
            } else {
              candidateRef.current = { code: clean, count: 1, lastTime: now };
              setVerifyingText(`1/${requiredMatches}`);
              setTimeout(() => {
                if (candidateRef.current && Date.now() - candidateRef.current.lastTime >= 1000) {
                  candidateRef.current = null;
                  setVerifyingText(null);
                }
              }, 1050);
              return;
            }

            // Consensus reached! Accept and lock briefly to prevent jumping
            candidateRef.current = null;
            setVerifyingText(null);
            lastDecodedRef.current = { code: clean, time: now };
            globalCooldownUntilRef.current = now + 1800;

            soundService.playScanBeep();
            setLastScannedFlash(clean);
            setTimeout(() => {
              setLastScannedFlash((prev) => (prev === clean ? null : prev));
            }, 1700);

            onScanRef.current(clean);
          },
          () => {
            // frame scan miss is normal
          }
        );

        if (!isMounted) {
          await stopScanner();
          return;
        }

        setCameraActive(true);

        // Apply continuous autofocus right away if hardware supports it
        await applyContinuousAutofocus(scanner);

        // Read zoom & torch capabilities
        try {
          const camCaps = scanner.getRunningTrackCameraCapabilities?.();
          if (camCaps) {
            const torchCap = camCaps.torchFeature();
            setTorchSupported(Boolean(torchCap?.isSupported()));

            const zoomCap = camCaps.zoomFeature();
            if (zoomCap?.isSupported()) {
              const min = zoomCap.min() || 1;
              const max = Math.min(zoomCap.max() || 4, 4);
              const step = zoomCap.step() || 0.1;
              setZoomSupported(true);
              setZoomRange({ min, max, step });
              const initialZoom = Math.max(min, Math.min(zoomLevel, max));
              setZoomLevel(initialZoom);
              if (initialZoom > min) {
                await zoomCap.apply(initialZoom).catch(() => {});
              }
            } else {
              setZoomSupported(false);
            }
          }
        } catch {
          setTorchSupported(false);
          setZoomSupported(false);
        }

        // Populate camera list after permission is granted so labels are readable
        try {
          const cams = await Html5Qrcode.getCameras();
          if (isMounted && cams && cams.length > 0) {
            setAvailableCameras(cams.map((c) => ({ id: c.id, label: c.label })));
          }
        } catch {
          // ignore
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.warn('Camera start issue:', err);
        setCameraActive(false);
        const errString = String(err?.message || err || '');
        if (errString.includes('NotAllowedError') || errString.includes('Permission')) {
          setCameraError(
            'Izin kamera belum diberikan pada browser HP Anda. Klik ikon gembok / izin di bilah alamat browser lalu izinkan akses Kamera.'
          );
        } else if (errString.includes('NotFoundError') || errString.includes('OverconstrainedError')) {
          if (selectedCameraId) {
            setSelectedCameraId(null);
          } else {
            setCameraError('Kamera tidak terdeteksi atau lensa tidak kompatibel pada perangkat ini.');
          }
        } else {
          setCameraError(
            'Kamera tidak dapat diakses atau izin ditolak. Gunakan tombol Sampel Barcode atau ketik manual.'
          );
        }
      }
    }

    initScanner();

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [isScanning, facingMode, selectedCameraId, isExpanded, retrySeed, applyContinuousAutofocus, stopScanner]);

  const handleRequestCameraPermission = async () => {
    setCameraError(null);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
        });
        testStream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      // let initScanner display specific error message if still blocked
    }
    setRetrySeed((prev) => prev + 1);
  };

  const handleToggleTorch = async () => {
    const nextTorch = !torchOn;
    try {
      const scanner = html5QrCodeRef.current;
      const torchCap = scanner?.getRunningTrackCameraCapabilities?.()?.torchFeature?.();
      if (torchCap?.isSupported()) {
        await torchCap.apply(nextTorch);
        setTorchOn(nextTorch);
        return;
      }

      const track = getActiveVideoTrack();
      if (track) {
        await track.applyConstraints({
          advanced: [{ torch: nextTorch } as any],
        });
        setTorchOn(nextTorch);
      }
    } catch {
      setFocusStatus('Lampu senter tidak didukung pada lensa ini');
      setTimeout(() => setFocusStatus(null), 1800);
    }
  };

  const handleSetZoom = async (targetZoom: number) => {
    const clamped = Math.max(zoomRange.min, Math.min(targetZoom, zoomRange.max));
    setZoomLevel(clamped);
    try {
      const scanner = html5QrCodeRef.current;
      const zoomCap = scanner?.getRunningTrackCameraCapabilities?.()?.zoomFeature?.();
      if (zoomCap?.isSupported()) {
        await zoomCap.apply(clamped);
        return;
      }
      const track = getActiveVideoTrack();
      if (track) {
        await track.applyConstraints({
          advanced: [{ zoom: clamped } as any],
        });
      }
    } catch {
      // ignore zoom error
    }
  };

  const triggerManualRefocus = async (normX = 0.5, normY = 0.5) => {
    if (!cameraActive) return;
    setFocusStatus('Memfokuskan lensa...');

    const track = getActiveVideoTrack();
    const scanner = html5QrCodeRef.current;

    try {
      const caps = (track?.getCapabilities?.() as any) || scanner?.getRunningTrackCapabilities?.() || {};
      const focusModes: string[] = Array.isArray(caps.focusMode) ? caps.focusMode : [];

      if (track) {
        // Step 1: trigger single-shot or point-of-interest if available to force lens sweep
        if (focusModes.includes('single-shot')) {
          const singleConstraint: any = { focusMode: 'single-shot' };
          if (caps.pointsOfInterest) {
            singleConstraint.pointsOfInterest = [{ x: normX, y: normY }];
          }
          await track.applyConstraints({ advanced: [singleConstraint] }).catch(() => {});
        }

        // Step 2: lock back into continuous autofocus
        if (focusModes.includes('continuous')) {
          setTimeout(() => {
            track
              .applyConstraints({
                advanced: [{ focusMode: 'continuous' } as any],
              })
              .catch(() => {});
          }, 260);
        }
      }
    } catch {
      // ignore if browser blocks focusMode constraints
    }

    setTimeout(() => {
      setFocusStatus('Auto-fokus aktif (jaga jarak ±15-20 cm)');
      setTimeout(() => setFocusStatus(null), 1800);
    }, 350);
  };

  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cameraActive || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const normX = Math.max(0, Math.min(1, relX / rect.width));
    const normY = Math.max(0, Math.min(1, relY / rect.height));

    setTapFocusPoint({ x: relX, y: relY, key: Date.now() });
    setTimeout(() => setTapFocusPoint(null), 900);
    triggerManualRefocus(normX, normY);
  };

  const handleSwitchCamera = () => {
    // If multiple cameras detected (e.g., ultrawide vs main vs front), cycle through them
    if (availableCameras.length > 1) {
      const currentIdx = selectedCameraId
        ? availableCameras.findIndex((c) => c.id === selectedCameraId)
        : 0;
      const nextIdx = (currentIdx + 1) % availableCameras.length;
      const nextCam = availableCameras[nextIdx];
      setSelectedCameraId(nextCam.id);
      setFocusStatus(`Kamera: ${nextCam.label || `Lensa ${nextIdx + 1}`}`);
      setTimeout(() => setFocusStatus(null), 2000);
    } else {
      setSelectedCameraId(null);
      setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      soundService.playScanBeep();
      onScan(manualInput.trim());
      setManualInput('');
    }
  };

  const zoomPresets = [1, 1.5, 2, 2.5].filter(
    (z) => z >= zoomRange.min - 0.05 && z <= zoomRange.max + 0.05
  );

  return (
    <div
      className={
        isExpanded
          ? 'fixed inset-0 z-50 bg-zinc-950 flex flex-col justify-between'
          : 'relative w-full rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-2xl flex flex-col items-center'
      }
    >
      {/* Fullscreen Top Header Bar */}
      {isExpanded && (
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-950/95 border-b border-zinc-800 z-30">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#C6F232] animate-pulse" />
            <span className="text-xs font-black text-white uppercase tracking-wider font-mono">
              Scanner Layar Penuh
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 border border-zinc-700 cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5 text-[#C6F232]" />
              <span>Kecilkan</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={() => {
                  setIsExpanded(false);
                  onClose();
                }}
                className="p-1.5 bg-zinc-800 hover:bg-red-500/20 text-zinc-300 hover:text-red-300 rounded-xl border border-zinc-700 cursor-pointer"
                title="Tutup Kamera"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Scanner Viewport Window (Much Larger & Tap-to-Focus Enabled) */}
      <div
        ref={viewportRef}
        onClick={handleViewportTap}
        className={`relative w-full bg-black flex items-center justify-center overflow-hidden cursor-crosshair ${
          isExpanded
            ? 'flex-1 min-h-0'
            : 'min-h-[340px] sm:min-h-[420px] max-h-[65vh]'
        }`}
      >
        {/* Container for html5-qrcode video */}
        <div id={scannerContainerId} className="w-full h-full flex items-center justify-center" />

        {/* Laser Reticle & HUD Overlay */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
          {/* Bigger Target Reticle Box */}
          <div
            className={`relative transition-all duration-150 rounded-2xl flex items-center justify-center ${
              isExpanded
                ? 'w-[90%] max-w-[440px] h-[52%] min-h-[210px]'
                : 'w-[88%] max-w-[360px] h-[60%] min-h-[190px]'
            } ${
              lastScannedFlash
                ? 'border-2 border-[#C6F232] bg-[#C6F232]/10 shadow-[0_0_30px_rgba(198,242,50,0.45)]'
                : 'border-2 border-amber-400/75 shadow-[0_0_24px_rgba(245,158,11,0.2)]'
            }`}
          >
            {/* Corner Markers */}
            <div
              className={`absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 rounded-tl-lg ${
                lastScannedFlash ? 'border-[#C6F232]' : 'border-[#C6F232]'
              }`}
            />
            <div
              className={`absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 rounded-tr-lg ${
                lastScannedFlash ? 'border-[#C6F232]' : 'border-[#C6F232]'
              }`}
            />
            <div
              className={`absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 rounded-bl-lg ${
                lastScannedFlash ? 'border-[#C6F232]' : 'border-[#C6F232]'
              }`}
            />
            <div
              className={`absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 rounded-br-lg ${
                lastScannedFlash ? 'border-[#C6F232]' : 'border-[#C6F232]'
              }`}
            />

            {/* Animated Laser Beam */}
            <div className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444] animate-pulse" />

            {/* Scan Confirmed / Verifying / Paused Flash Badge */}
            {isPaused ? (
              <div className="bg-zinc-950/95 border border-amber-400 text-amber-300 px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-lg">
                <Pause className="w-4 h-4 shrink-0" />
                <span className="text-xs font-mono font-black tracking-wide">
                  SCAN DIJEDA · KLIK LANJUTKAN
                </span>
              </div>
            ) : lastScannedFlash ? (
              <div className="bg-zinc-950/95 border border-[#C6F232] text-[#C6F232] px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-lg animate-in fade-in zoom-in-95">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="text-xs font-mono font-black tracking-wide">
                  TERBACA: {lastScannedFlash}
                </span>
              </div>
            ) : verifyingText ? (
              <div className="bg-zinc-950/90 border border-amber-400/80 text-amber-300 px-3 py-1 rounded-xl flex items-center gap-1.5 shadow-md">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[11px] font-mono font-bold tracking-wide">
                  MEMVERIFIKASI ({verifyingText})...
                </span>
              </div>
            ) : (
              <span className="absolute -bottom-7 text-[11px] font-mono font-bold tracking-wider text-zinc-100 bg-zinc-950/85 px-2.5 py-0.5 rounded-lg border border-zinc-700/80 whitespace-nowrap">
                MASUKKAN BARCODE KE KOTAK · TAHAN SEJENAK
              </span>
            )}
          </div>
        </div>

        {/* Tap-to-focus Ring Feedback */}
        {tapFocusPoint && (
          <div
            key={tapFocusPoint.key}
            style={{ left: tapFocusPoint.x - 28, top: tapFocusPoint.y - 28 }}
            className="absolute w-14 h-14 rounded-full border-2 border-[#C6F232] shadow-[0_0_15px_rgba(198,242,50,0.8)] pointer-events-none animate-ping z-20"
          />
        )}

        {/* Status / Focus Toast */}
        {focusStatus && (
          <div className="absolute top-3 left-3 bg-zinc-950/90 border border-[#C6F232]/50 text-[#C6F232] text-[11px] font-mono font-semibold px-2.5 py-1 rounded-lg z-20 pointer-events-none shadow-md">
            {focusStatus}
          </div>
        )}

        {/* Camera error or simulator fallback notice */}
        {cameraError && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center p-5 text-center z-20 cursor-default"
          >
            <CameraOff className="w-10 h-10 text-amber-400 mb-2" />
            <p className="text-xs text-zinc-200 font-medium max-w-xs mb-1.5">{cameraError}</p>
            <p className="text-[11px] text-zinc-400 max-w-xs mb-3">
              Jika memakai APK Android, pastikan izin Kamera aktif di Setelan HP &gt; Aplikasi &gt; ScanGudang WMS &gt; Izin.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={handleRequestCameraPermission}
                className="px-3.5 py-1.5 bg-[#C6F232] hover:bg-[#d6f555] text-zinc-950 text-xs font-black rounded-lg flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Izinkan & Coba Lagi
              </button>
              {onOpenTestBarcodes && (
                <button
                  type="button"
                  onClick={onOpenTestBarcodes}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" /> Buka Sampel Barcode
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowManual(!showManual)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Keyboard className="w-3.5 h-3.5" /> Ketik Manual
              </button>
            </div>
          </div>
        )}

        {/* Top-Right HUD Controls: Pause/Resume, Focus, Switch Lens/Cam, Torch, Fullscreen */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20"
        >
          <button
            type="button"
            onClick={() => setIsPaused((prev) => !prev)}
            title={isPaused ? 'Lanjutkan Scan Kamera' : 'Jeda Scan (Kunci Hasil)'}
            className={`px-2.5 py-2 rounded-xl backdrop-blur border cursor-pointer active:scale-95 transition-all flex items-center gap-1 text-[11px] font-bold ${
              isPaused
                ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-md'
                : 'bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border-zinc-700/70'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isPaused ? 'Lanjut' : 'Jeda'}</span>
          </button>

          <button
            type="button"
            onClick={() => triggerManualRefocus(0.5, 0.5)}
            title="Fokus Ulang Kamera"
            className="px-2.5 py-2 bg-zinc-900/85 hover:bg-zinc-800 text-[#C6F232] rounded-xl backdrop-blur border border-zinc-700/70 cursor-pointer active:scale-95 transition-all flex items-center gap-1 text-[11px] font-bold"
          >
            <Focus className="w-4 h-4" />
            <span className="hidden sm:inline">Fokus</span>
          </button>

          <button
            type="button"
            onClick={handleSwitchCamera}
            title={
              availableCameras.length > 1
                ? 'Ganti Lensa / Kamera (Utama / Makro / Depan)'
                : 'Ganti Kamera Depan/Belakang'
            }
            className="p-2 bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 hover:text-white rounded-xl backdrop-blur border border-zinc-700/70 cursor-pointer active:scale-95 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleToggleTorch}
            title={torchSupported ? 'Lampu Senter' : 'Senter (jika didukung perangkat)'}
            className={`p-2 rounded-xl backdrop-blur border transition-all cursor-pointer active:scale-95 ${
              torchOn
                ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-md'
                : 'bg-zinc-900/85 text-zinc-200 hover:text-white border-zinc-700/70'
            }`}
          >
            {torchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
          </button>

          {!isExpanded && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              title="Perbesar Layar Kamera (Layar Penuh)"
              className="px-2.5 py-2 bg-[#C6F232] hover:bg-[#d6f555] text-zinc-950 rounded-xl font-black text-[11px] flex items-center gap-1 shadow-md cursor-pointer active:scale-95 transition-all"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Perbesar</span>
            </button>
          )}
        </div>

        {/* Bottom HUD Hardware Zoom Controls (shown automatically if phone lens supports zoom) */}
        {zoomSupported && cameraActive && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-zinc-950/85 backdrop-blur px-2.5 py-1.5 rounded-full border border-zinc-700/80 z-20 shadow-lg"
          >
            <ZoomIn className="w-3.5 h-3.5 text-[#C6F232] mr-0.5" />
            {zoomPresets.map((preset) => {
              const isSelected = Math.abs(zoomLevel - preset) < 0.15;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSetZoom(preset)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#C6F232] text-zinc-950 shadow-sm'
                      : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  {preset}x
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual barcode input / quick action bar */}
      <div className="w-full p-3 bg-zinc-900/95 border-t border-zinc-800 flex flex-col gap-2">
        <form onSubmit={handleManualSubmit} className="flex gap-2 w-full">
          <div className="relative flex-1">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Input barcode manual / serial..."
              className="w-full bg-zinc-950 border border-zinc-700 focus:border-amber-500 rounded-lg py-2 pl-3 pr-8 text-xs font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition-colors"
            />
            {manualInput && (
              <button
                type="button"
                onClick={() => setManualInput('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!manualInput.trim()}
            className="px-4 py-2 bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-lg transition-all active:scale-95 cursor-pointer disabled:cursor-not-allowed"
          >
            Input
          </button>
        </form>

        <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-zinc-300 font-mono">
              {cameraActive ? 'AUTO-FOCUS HD SCANNER' : '2D CMOS SENSOR READY'}
            </span>
          </div>

          {onOpenTestBarcodes && (
            <button
              type="button"
              onClick={onOpenTestBarcodes}
              className="text-amber-400 hover:text-amber-300 font-medium underline flex items-center gap-1 cursor-pointer"
            >
              <QrCode className="w-3 h-3" /> Lembar Barcode Sampel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
