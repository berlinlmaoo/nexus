import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Smile, Trash2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { ALL_EMOJIS, EmojiGrid } from "./EmojiPicker";

/** Cover presets, stored as "gradient:<name>" in Doc.coverImage (an uploaded cover is its URL). */
export const COVER_GRADIENTS: Record<string, string> = {
  dusk: "linear-gradient(120deg, #7b68ee 0%, #c86dd7 55%, #f3a683 100%)",
  sea: "linear-gradient(120deg, #2193b0 0%, #6dd5ed 100%)",
  forest: "linear-gradient(120deg, #134e5e 0%, #71b280 100%)",
  sand: "linear-gradient(120deg, #e6dada 0%, #c9b8a8 50%, #a38f7a 100%)",
  ember: "linear-gradient(120deg, #f12711 0%, #f5af19 100%)",
  ink: "linear-gradient(120deg, #232526 0%, #414345 100%)",
  mint: "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  night: "linear-gradient(120deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
};

export function coverStyle(cover: string | null | undefined): React.CSSProperties | null {
  if (!cover) return null;
  if (cover.startsWith("gradient:")) {
    const g = COVER_GRADIENTS[cover.slice(9)];
    return g ? { backgroundImage: g } : null;
  }
  if (/^(\/|https:\/\/)/.test(cover)) return { backgroundImage: `url("${cover.replace(/"/g, "%22")}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return null;
}

function CoverPicker({ onPick, onUpload, uploading }: { onPick: (v: string) => void; onUpload: (f: File) => void; uploading: boolean }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-muted-foreground">{t("Gradients")}</div>
      <div className="grid grid-cols-4 gap-1.5">
        {Object.entries(COVER_GRADIENTS).map(([k, g]) => (
          <button key={k} type="button" onClick={() => onPick(`gradient:${k}`)} className="h-10 rounded-md ring-offset-2 transition hover:ring-2 hover:ring-ring" style={{ backgroundImage: g }} aria-label={k} />
        ))}
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      <button type="button" disabled={uploading} onClick={() => input.current?.click()} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t("Upload an image")}
      </button>
      <p className="text-[11px] text-muted-foreground">{t("Wide images work best (1500 px or more).")}</p>
    </div>
  );
}

export type PageHeaderProps = {
  icon: string | null;
  cover: string | null;
  title: string;
  editable: boolean;
  fullWidth: boolean;
  onIcon: (icon: string | null) => void;
  onCover: (cover: string | null) => void;
  onTitle: (title: string) => void;
  onUploadCover: (file: File) => Promise<string>;
  /** Enter / ArrowDown in the title: go to the body. */
  onEnterBody: () => void;
};

/** Notion's page header: cover, icon, title; "Add icon" / "Add cover" appear on hover. */
export function DocPageHeader(p: PageHeaderProps) {
  const { t } = useLang();
  const [iconOpen, setIconOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const style = coverStyle(p.cover);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [p.title, p.fullWidth]);
  useEffect(() => {
    const onResize = () => { const el = titleRef.current; if (el) { el.style.height = "0px"; el.style.height = `${el.scrollHeight}px`; } };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const url = await p.onUploadCover(f);
      p.onCover(url);
      setCoverOpen(false);
    } finally {
      setUploading(false);
    }
  };

  const coverPopover = (trigger: React.ReactNode) => (
    <Popover open={coverOpen} onOpenChange={setCoverOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="z-[120] w-80 p-3" align="start">
        <CoverPicker onPick={(v) => { p.onCover(v); setCoverOpen(false); }} onUpload={(f) => void upload(f)} uploading={uploading} />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="group/header">
      {style && (
        <div className="group/cover relative h-[22vh] min-h-[120px] max-h-[280px] w-full bg-muted" style={style}>
          {p.editable && (
            <div className="absolute bottom-3 right-3 flex gap-1 opacity-0 pointer-coarse:opacity-100! transition-opacity focus-within:opacity-100 group-hover/cover:opacity-100">
              {coverPopover(<button type="button" className="rounded-md bg-background/85 px-2 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur hover:bg-background">{t("Change cover")}</button>)}
              <button type="button" onClick={() => p.onCover(null)} className="rounded-md bg-background/85 px-2 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur hover:bg-background">{t("Remove")}</button>
            </div>
          )}
        </div>
      )}
      <div className={cn("nx-page-col", p.fullWidth && "is-full")}>
        {p.icon && (
          <Popover open={iconOpen && p.editable} onOpenChange={setIconOpen}>
            <PopoverTrigger asChild>
              <button type="button" disabled={!p.editable} className={cn("relative block rounded-lg text-[64px] leading-none transition-colors md:text-[72px]", p.editable && "hover:bg-muted/70", style ? "-mt-[42px]" : "mt-10")} aria-label={t("Change icon")}>
                {p.icon}
              </button>
            </PopoverTrigger>
            <PopoverContent className="z-[120] w-80 p-2" align="start">
              <EmojiGrid onPick={(e) => { p.onIcon(e); setIconOpen(false); }} />
              <button type="button" onClick={() => { p.onIcon(null); setIconOpen(false); }} className="mt-2 inline-flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" />{t("Remove icon")}</button>
            </PopoverContent>
          </Popover>
        )}
        {p.editable && (!p.icon || !p.cover) && (
          <div className={cn("flex h-7 items-center gap-1 text-sm text-muted-foreground opacity-0 pointer-coarse:opacity-100! transition-opacity focus-within:opacity-100 group-hover/header:opacity-100 max-md:opacity-100", !p.icon && !style ? "mt-12" : "mt-2")}>
            {!p.icon && (
              <button type="button" onClick={() => p.onIcon(ALL_EMOJIS[Math.floor(Math.random() * 30)])} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted"><Smile className="h-4 w-4" />{t("Add icon")}</button>
            )}
            {!p.cover && coverPopover(<button type="button" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted"><ImagePlus className="h-4 w-4" />{t("Add cover")}</button>)}
          </div>
        )}
        {!p.editable && !p.icon && <div className={style ? "mt-6" : "mt-12"} />}
        <textarea
          ref={titleRef}
          rows={1}
          value={p.title}
          readOnly={!p.editable}
          onChange={(e) => p.onTitle(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
              e.preventDefault();
              p.onEnterBody();
            }
          }}
          placeholder={t("Untitled")}
          aria-label={t("Page title")}
          // Above 16 px already: keeps its size on a phone (styles.css shrank every field to 16 px, so the page
          // title read smaller than the headings under it, visual QA 24 Oct 2026).
          data-keep-font
          className="mt-2 block w-full resize-none overflow-hidden bg-transparent font-display text-[2rem] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40 md:text-[2.5rem]"
        />
      </div>
    </div>
  );
}
