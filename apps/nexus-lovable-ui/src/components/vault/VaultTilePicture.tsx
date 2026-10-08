import { useEffect, useRef, useState } from "react";
import { Film, Image as ImageIcon, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VaultItem } from "@/lib/nexus-api";
import { fillsTile, formatDuration, mediaKind, thumbSrc } from "@/lib/vault-media";

/** A light checkerboard behind pictures shown whole, so a white logo on a transparent PNG shows. */
export const CHECKERBOARD = {
  backgroundImage: "repeating-conic-gradient(color-mix(in srgb, var(--muted-foreground) 13%, transparent) 0 25%, transparent 0 50%)",
  backgroundSize: "16px 16px",
};

/**
 * A gallery tile's picture: the server's thumbnail for a picture; for a film, its first frame
 * (`preload="metadata"`, only once the tile is near the screen, so a folder of films does not start
 * forty downloads) and its length. Whatever cannot be drawn keeps its type icon.
 *
 * Shared by /vault and a shared folder's page (/s/, /v/) since 9 Oct 2026.
 */
export function VaultTilePicture({ item }: { item: VaultItem }) {
  const kind = mediaKind(item);
  const src = kind === "image" ? thumbSrc(item, 320) : null;
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const Icon = kind === "video" ? Film : ImageIcon;

  useEffect(() => {
    if (kind !== "video" || near) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [kind, near]);

  return (
    <div ref={box} className="absolute inset-0 grid place-items-center">
      {kind === "image" && src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className={cn("h-full w-full", fillsTile(item) ? "object-cover" : "object-contain p-3")}
        />
      ) : kind === "video" && near && item.url && !failed ? (
        <video
          src={`${item.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover pointer-events-none bg-muted"
        />
      ) : (
        <Icon className="h-8 w-8 text-muted-foreground/60" aria-hidden />
      )}
      {kind === "video" && (
        <>
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <span className="h-10 w-10 grid place-items-center rounded-full bg-black/55 text-white">
              <Play className="h-4 w-4 translate-x-px fill-current" />
            </span>
          </span>
          {formatDuration(duration) && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
              {formatDuration(duration)}
            </span>
          )}
        </>
      )}
    </div>
  );
}
