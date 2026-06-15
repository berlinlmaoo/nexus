import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelfieCaptureHandle {
  open: () => void;
}

interface SelfieCaptureProps {
  file: File | null;
  onChange: (f: File | null) => void;
  /** Called right after a photo is captured (in addition to onChange). Use to auto-continue (e.g. grab GPS + check in). */
  onCapture?: (f: File) => void;
  disabled?: boolean;
  size?: number;
  /** Show the clickable selfie tile. Set false to drive it imperatively via ref.open(). */
  renderTile?: boolean;
}

/**
 * Selfie capture via live camera (getUserMedia) on BOTH desktop & mobile,
 * with a graceful fallback to the OS file picker if the camera isn't available/denied.
 * Can render a tile, or be triggered imperatively (ref.open()).
 */
export const SelfieCapture = forwardRef<SelfieCaptureHandle, SelfieCaptureProps>(function SelfieCapture(
  { file, onChange, onCapture, disabled, size = 112, renderTile = true },
  ref,
) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  const stop = useCallback(() => { setStream((s) => { s?.getTracks().forEach((t) => t.stop()); return null; }); }, []);
  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);

  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { fileRef.current?.click(); return; }
    setOpening(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      setStream(s);
    } catch {
      fileRef.current?.click(); // denied / no camera
    } finally {
      setOpening(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ open: openCamera }), [openCamera]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        stop();
        if (blob) {
          const f = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
          onChange(f);
          onCapture?.(f);
        }
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className={renderTile ? "flex flex-col items-center gap-1.5" : "contents"}>
      {renderTile && (
        <>
          <button
            type="button"
            disabled={disabled || opening}
            onClick={openCamera}
            className="group relative grid place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-primary/30 bg-muted/40 transition-colors hover:border-primary/60 disabled:opacity-50"
            style={{ width: size, height: size }}
          >
            {preview ? (
              <img src={preview} alt="Selfie" className="h-full w-full object-cover" />
            ) : opening ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary/70" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-primary/70"><Camera className="h-7 w-7" /><span className="text-[11px] font-semibold">Selfie</span></div>
            )}
          </button>
          {preview && <button type="button" onClick={openCamera} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary"><RefreshCw className="h-3 w-3" /> Retake</button>}
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={(e) => { const f = e.target.files?.[0] ?? null; onChange(f); if (f) onCapture?.(f); }} className="hidden" />

      {stream &&
        createPortal(
          <div className="fixed inset-0 z-[95] grid place-items-center bg-black/80 p-4">
            <div className="flex w-full max-w-md flex-col items-center gap-4">
              <div className="relative w-full overflow-hidden rounded-3xl bg-black shadow-pop">
                <video ref={videoRef} playsInline muted className="h-auto w-full -scale-x-100" />
                <button onClick={stop} aria-label="Tutup kamera" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"><X className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={stop} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:text-white">Batal</button>
                <button onClick={capture} className={cn("grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-pop ring-4 ring-white/30 transition-transform active:scale-90")} aria-label="Ambil foto">
                  <Camera className="h-7 w-7" />
                </button>
                <button onClick={openCamera} className="inline-flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:text-white" aria-label="Ganti kamera"><RefreshCw className="h-4 w-4" /></button>
              </div>
              <p className="text-xs text-white/60">Posisikan wajah, lalu tekan tombol foto.</p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});
