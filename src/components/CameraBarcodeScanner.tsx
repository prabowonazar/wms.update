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
import {
  prepareZXingModule,
  readBarcodes,
  type ReadInputBarcodeFormat,
  type ReadResult,
} from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { soundService } from '../utils/audio';

// Configure ZXing-C++ WASM to load from bundled local asset (works offline & in mobile WebView)
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => {
      if (path.endsWith('.wasm')) {
        return zxingReaderWasmUrl;
      }
      return prefix + path;
    },
  },
});

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

const SUPPORTED_BARCODE_FORMATS: ReadInputBarcodeFormat[] = [
  'QRCode',
  'Code128',
  'Code39',
  'Code93',
  'EAN13',
  'EAN8',
  'UPCA',
  'DataMatrix',
  'PDF417',
];

const MATRIX_FORMATS = new Set(['QRCode', 'DataMatrix', 'PDF417']);

function isRearCameraLabel(label: string): boolean {
  const l = label.toLowerCase();
  if (!l) return true;
  if (l.includes('front') || l.includes('user') || l.includes('depan') || l.includes('selfie')) {
    return false;
  }
  return true;
}

function scoreRearCameraLabel(label: string): number {
  const l = label.toLowerCase();
  let score = 0;
  if (l.includes('back') || l.includes('rear') || l.includes('belakang') || l.includes('environment')) {
    score += 10;
  }
  if (l.includes('camera 0') || l.includes('camera2 0') || l.includes('main') || l.includes('1x')) {
    score += 20;
  }
  // Penalize ultrawide / macro / depth / tele lenses that often have fixed focus or wrong focal length
  if (
    l.includes('wide') ||
    l.includes('ultra') ||
    l.includes('0.5') ||
    l.includes('0.6') ||
    l.includes('macro') ||
    l.includes('depth') ||
    l.includes('bokeh') ||
    l.includes('tele') ||
    l.includes('mono')
  ) {
    score -= 25;
  }
  return score;
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
  const [lastScannedFlash, setLastScannedFlash] = useState<{ code: string; format: string } | null>(
    null
  );

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
  const [retrySeed, setRetrySeed] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);

  const onScanRef = useRef(onScan);
  const isPausedRef = useRef(false);
  const isDecodingRef = useRef(false);
  const lastDecodedRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const globalCooldownUntilRef = useRef<number>(0);
  const candidateRef = useRef<{ code: string; count: number; lastTime: number } | null>(null);
  const autoLensCheckedRef = useRef<boolean>(false);

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
    return streamRef.current?.getVideoTracks?.()[0] || null;
  };

  const applyContinuousAutofocus = useCallback(async (track: MediaStreamTrack | null) => {
    if (!track) return;
    try {
      const caps = (track.getCapabilities?.() as any) || {};
      const advanced: any[] = [];
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
      }
      if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' });
      }
      if (advanced.length > 0) {
        await track.applyConstraints({ advanced });
      }
    } catch {
      // ignore unsupported camera constraints
    }
  }, []);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    candidateRef.current = null;
    setVerifyingText(null);
    setCameraActive(false);
    setTorchOn(false);
  }, []);

  // Start direct WebRTC HD camera + smart autofocus lens selection
  useEffect(() => {
    let isMounted = true;

    async function startCamera() {
      if (!isScanning) {
        stopCameraStream();
        return;
      }

      setCameraError(null);
      setTorchOn(false);
      candidateRef.current = null;
      setVerifyingText(null);

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Browser tidak mendukung akses kamera WebRTC.');
        }

        stopCameraStream();

        const videoConstraints: MediaTrackConstraints = selectedCameraId
          ? {
              deviceId: { exact: selectedCameraId },
              width: { min: 640, ideal: 1920 },
              height: { min: 480, ideal: 1080 },
              frameRate: { ideal: 30 },
            }
          : {
              facingMode: { ideal: facingMode },
              width: { min: 640, ideal: 1920 },
              height: { min: 480, ideal: 1080 },
              frameRate: { ideal: 30 },
            };

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const track = stream.getVideoTracks()[0];

        // Smart Main Rear Lens Auto-Switch:
        // If browser accidentally picked a fixed-focus ultrawide/macro rear lens, switch to main autofocus rear lens
        if (!selectedCameraId && facingMode === 'environment' && !autoLensCheckedRef.current) {
          autoLensCheckedRef.current = true;
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === 'videoinput');
            if (isMounted && videoInputs.length > 0) {
              setAvailableCameras(
                videoInputs.map((d, idx) => ({
                  id: d.deviceId,
                  label: d.label || `Kamera ${idx + 1}`,
                }))
              );
            }

            const currentSettings = track?.getSettings?.();
            const currentCaps = (track?.getCapabilities?.() as any) || {};
            const currentLabel =
              videoInputs.find((d) => d.deviceId === currentSettings?.deviceId)?.label || '';
            const hasFocusControl =
              Array.isArray(currentCaps.focusMode) && currentCaps.focusMode.length > 0;

            const rearCandidates = videoInputs
              .filter((d) => isRearCameraLabel(d.label || ''))
              .sort((a, b) => scoreRearCameraLabel(b.label || '') - scoreRearCameraLabel(a.label || ''));

            const bestRear = rearCandidates[0];
            if (
              bestRear &&
              bestRear.deviceId !== currentSettings?.deviceId &&
              (!hasFocusControl || scoreRearCameraLabel(currentLabel) < scoreRearCameraLabel(bestRear.label || ''))
            ) {
              stream.getTracks().forEach((t) => t.stop());
              setSelectedCameraId(bestRear.deviceId);
              return;
            }
          } catch {
            // ignore enumerateDevices fallback
          }
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        setCameraActive(true);
        await applyContinuousAutofocus(track);

        // Read torch & hardware zoom capabilities
        try {
          const caps = (track?.getCapabilities?.() as any) || {};
          setTorchSupported(Boolean(caps.torch));

          if (caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number') {
            const min = caps.zoom.min || 1;
            const max = Math.min(caps.zoom.max || 4, 4);
            const step = caps.zoom.step || 0.1;
            setZoomSupported(max > min);
            setZoomRange({ min, max, step });
            const targetZoom = Math.max(min, Math.min(zoomLevel, max));
            setZoomLevel(targetZoom);
            if (targetZoom > min) {
              await track.applyConstraints({ advanced: [{ zoom: targetZoom } as any] }).catch(() => {});
            }
          } else {
            setZoomSupported(false);
          }
        } catch {
          setTorchSupported(false);
          setZoomSupported(false);
        }

        // Refresh camera list with readable labels
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          if (isMounted && videoInputs.length > 0) {
            setAvailableCameras(
              videoInputs.map((d, idx) => ({
                id: d.deviceId,
                label: d.label || `Kamera ${idx + 1}`,
              }))
            );
          }
        } catch {
          // ignore
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.warn('Camera start issue:', err);
        setCameraActive(false);
        const errString = String(err?.name || err?.message || err || '');
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

    startCamera();

    return () => {
      isMounted = false;
      stopCameraStream();
    };
  }, [isScanning, facingMode, selectedCameraId, retrySeed, applyContinuousAutofocus, stopCameraStream]);

  // High-precision ZXing-C++ WASM 1:1 native-resolution decode loop inside reticle ROI
  useEffect(() => {
    if (!isScanning || !cameraActive) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    let cancelled = false;

    const processFrame = async () => {
      if (cancelled || isPausedRef.current || isDecodingRef.current) return;

      const video = videoRef.current;
      const viewport = viewportRef.current;
      const reticle = reticleRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      const now = Date.now();
      if (now < globalCooldownUntilRef.current) {
        return;
      }

      isDecodingRef.current = true;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // Calculate 1:1 native video crop matching the visible reticle box under object-cover
        let sx = Math.floor(vw * 0.08);
        let sy = Math.floor(vh * 0.22);
        let sw = Math.floor(vw * 0.84);
        let sh = Math.floor(vh * 0.56);

        if (viewport && reticle) {
          const vpRect = viewport.getBoundingClientRect();
          const rtRect = reticle.getBoundingClientRect();
          if (vpRect.width > 0 && vpRect.height > 0 && rtRect.width > 0 && rtRect.height > 0) {
            // object-cover scaling factor from native video to viewport CSS pixels
            const scale = Math.max(vpRect.width / vw, vpRect.height / vh);
            const displayedW = vw * scale;
            const displayedH = vh * scale;
            const offsetX = (displayedW - vpRect.width) / 2;
            const offsetY = (displayedH - vpRect.height) / 2;

            const relLeft = rtRect.left - vpRect.left + offsetX;
            const relTop = rtRect.top - vpRect.top + offsetY;

            // Add 6% safety margin around reticle edges so bars near border still decode cleanly
            const padX = rtRect.width * 0.06;
            const padY = rtRect.height * 0.06;

            sx = Math.max(0, Math.floor((relLeft - padX) / scale));
            sy = Math.max(0, Math.floor((relTop - padY) / scale));
            sw = Math.min(vw - sx, Math.ceil((rtRect.width + padX * 2) / scale));
            sh = Math.min(vh - sy, Math.ceil((rtRect.height + padY * 2) / scale));
          }
        }

        if (sw < 80 || sh < 60) return;

        // Keep full 1:1 sharpness up to 1100px wide (never blurry 300px downscale)
        const maxDim = 1100;
        const downRatio = Math.max(sw / maxDim, sh / maxDim, 1);
        const cw = Math.max(1, Math.round(sw / downRatio));
        const ch = Math.max(1, Math.round(sh / downRatio));

        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
        const imageData = ctx.getImageData(0, 0, cw, ch);

        const results: ReadResult[] = await readBarcodes(imageData, {
          formats: SUPPORTED_BARCODE_FORMATS,
          tryHarder: true,
          tryRotate: true,
          tryInvert: false,
          tryDownscale: true,
          binarizer: 'LocalAverage',
          minLineCount: 4, // Require 4 matching scanlines in C++ per frame for 1D accuracy
          maxNumberOfSymbols: 2,
          returnErrors: false,
        });

        if (cancelled || isPausedRef.current) return;

        const validResults = results.filter(
          (r) => r.isValid !== false && r.text && r.text.trim().length >= 2
        );

        if (validResults.length === 0) {
          if (candidateRef.current && Date.now() - candidateRef.current.lastTime > 950) {
            candidateRef.current = null;
            setVerifyingText(null);
          }
          return;
        }

        // Pick barcode closest to center of the reticle
        const centerX = cw / 2;
        const centerY = ch / 2;
        validResults.sort((a, b) => {
          const ax =
            (a.position.topLeft.x +
              a.position.topRight.x +
              a.position.bottomLeft.x +
              a.position.bottomRight.x) /
            4;
          const ay =
            (a.position.topLeft.y +
              a.position.topRight.y +
              a.position.bottomLeft.y +
              a.position.bottomRight.y) /
            4;
          const bx =
            (b.position.topLeft.x +
              b.position.topRight.x +
              b.position.bottomLeft.x +
              b.position.bottomRight.x) /
            4;
          const by =
            (b.position.topLeft.y +
              b.position.topRight.y +
              b.position.bottomLeft.y +
              b.position.bottomRight.y) /
            4;
          const distA = (ax - centerX) ** 2 + (ay - centerY) ** 2;
          const distB = (bx - centerX) ** 2 + (by - centerY) ** 2;
          return distA - distB;
        });

        const best = validResults[0];
        const clean = best.text.trim();
        const ts = Date.now();

        if (ts < globalCooldownUntilRef.current) return;

        // Suppress exact same code repeat within 2.5s
        if (lastDecodedRef.current.code === clean && ts - lastDecodedRef.current.time < 2500) {
          return;
        }

        // Require multi-frame consensus: Code39 lacks mandatory check digit so require 3, others 2
        const requiredMatches = best.format === 'Code39' ? 3 : 2;
        const prev = candidateRef.current;

        if (prev && prev.code === clean && ts - prev.lastTime <= 900) {
          const nextCount = prev.count + 1;
          candidateRef.current = { code: clean, count: nextCount, lastTime: ts };
          if (nextCount < requiredMatches) {
            setVerifyingText(`${nextCount}/${requiredMatches}`);
            return;
          }
        } else {
          candidateRef.current = { code: clean, count: 1, lastTime: ts };
          setVerifyingText(`1/${requiredMatches}`);
          return;
        }

        // Consensus locked!
        candidateRef.current = null;
        setVerifyingText(null);
        lastDecodedRef.current = { code: clean, time: ts };
        globalCooldownUntilRef.current = ts + 1800;

        soundService.playScanBeep();
        setLastScannedFlash({ code: clean, format: best.format });
        setTimeout(() => {
          setLastScannedFlash((curr) => (curr?.code === clean ? null : curr));
        }, 1700);

        onScanRef.current(clean);
      } catch {
        // ignore transient frame decode errors
      } finally {
        isDecodingRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void processFrame();
    }, 85);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isScanning, cameraActive]);

  const handleRequestCameraPermission = async () => {
    setCameraError(null);
    autoLensCheckedRef.current = false;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
        });
        testStream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      // handled by startCamera
    }
    setRetrySeed((prev) => prev + 1);
  };

  const handleToggleTorch = async () => {
    const nextTorch = !torchOn;
    const track = getActiveVideoTrack();
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as any],
      });
      setTorchOn(nextTorch);
    } catch {
      setFocusStatus('Lampu senter tidak didukung pada lensa ini');
      setTimeout(() => setFocusStatus(null), 1800);
    }
  };

  const handleSetZoom = async (targetZoom: number) => {
    const clamped = Math.max(zoomRange.min, Math.min(targetZoom, zoomRange.max));
    setZoomLevel(clamped);
    const track = getActiveVideoTrack();
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ zoom: clamped } as any],
      });
    } catch {
      // ignore zoom error
    }
  };

  const triggerManualRefocus = async (normX = 0.5, normY = 0.5) => {
    if (!cameraActive) return;
    setFocusStatus('Memfokuskan lensa...');

    const track = getActiveVideoTrack();
    try {
      const caps = (track?.getCapabilities?.() as any) || {};
      const focusModes: string[] = Array.isArray(caps.focusMode) ? caps.focusMode : [];

      if (track) {
        if (focusModes.includes('single-shot')) {
          const singleConstraint: any = { focusMode: 'single-shot' };
          if (caps.pointsOfInterest) {
            singleConstraint.pointsOfInterest = [{ x: normX, y: normY }];
          }
          await track.applyConstraints({ advanced: [singleConstraint] }).catch(() => {});
        } else if (focusModes.includes('manual') && caps.focusDistance) {
          // Nudge focus distance slightly then restore continuous if single-shot unavailable
          const minDist = caps.focusDistance.min ?? 0.1;
          await track
            .applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: minDist } as any] })
            .catch(() => {});
        }

        if (focusModes.includes('continuous')) {
          setTimeout(() => {
            track
              .applyConstraints({
                advanced: [{ focusMode: 'continuous' } as any],
              })
              .catch(() => {});
          }, 300);
        }
      }
    } catch {
      // ignore unsupported focusMode constraints
    }

    setTimeout(() => {
      setFocusStatus('Fokus aktif (jarak ideal 15-25 cm)');
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
              ZXing HD Scanner
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

      {/* Scanner Viewport Window (Direct Full-HD Video + Tap-to-Focus) */}
      <div
        ref={viewportRef}
        onClick={handleViewportTap}
        className={`relative w-full bg-black flex items-center justify-center overflow-hidden cursor-crosshair ${
          isExpanded ? 'flex-1 min-h-0' : 'h-[340px] sm:h-[400px]'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
        />

        {/* Laser Reticle & HUD Overlay */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
          <div
            ref={reticleRef}
            className={`relative transition-all duration-150 rounded-2xl flex items-center justify-center ${
              isExpanded
                ? 'w-[90%] max-w-[440px] h-[48%] min-h-[190px]'
                : 'w-[88%] max-w-[360px] h-[54%] min-h-[175px]'
            } ${
              lastScannedFlash
                ? 'border-2 border-[#C6F232] bg-[#C6F232]/10 shadow-[0_0_30px_rgba(198,242,50,0.45)]'
                : 'border-2 border-amber-400/75 shadow-[0_0_24px_rgba(245,158,11,0.2)]'
            }`}
          >
            {/* Corner Markers */}
            <div className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 rounded-tl-lg border-[#C6F232]" />
            <div className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 rounded-tr-lg border-[#C6F232]" />
            <div className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 rounded-bl-lg border-[#C6F232]" />
            <div className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 rounded-br-lg border-[#C6F232]" />

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
                  {lastScannedFlash.code}
                </span>
                <span className="text-[10px] font-mono bg-[#C6F232]/20 px-1.5 py-0.5 rounded text-[#C6F232]">
                  {lastScannedFlash.format}
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
                MASUKKAN BARCODE KE KOTAK · KETUK UNTUK FOKUS
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

        {/* Camera error fallback */}
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

        {/* Top-Right HUD Controls */}
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

        {/* Bottom HUD Hardware Zoom Controls */}
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
              {cameraActive ? 'ZXING-C++ WASM HD SCANNER' : '2D/1D WASM SENSOR READY'}
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
