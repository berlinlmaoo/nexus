import { useRef, useState, type ReactNode } from "react";
import { ProjectMarkFor, ProjectPageIcon } from "@/components/projects/ProjectIcon";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Link } from "@tanstack/react-router";
import { Bell, CalendarDays, CheckSquare, ExternalLink, FileText, FolderKanban, Globe, Image as ImageIcon, Link2, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { ctxOf, jakartaDate } from "./editor-context";
import { EmojiGrid } from "./EmojiPicker";

/** Size in KB / MB for a file card. */
function fmtSize(n: unknown): string {
  const b = typeof n === "number" ? n : Number(n);
  if (!b || Number.isNaN(b)) return "";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const SAFE_URL = /^(https?:\/\/|\/(?!\/))/i;

/** A known embeddable link → the URL to put in the iframe; null = show it as a bookmark card. */
export function embedUrlOf(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
  if (host.endsWith("youtube.com")) {
    const id = u.searchParams.get("v") ?? (/^\/(shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[2] ?? null);
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
  }
  if (host === "vimeo.com" && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video/${u.pathname.split("/")[1]}`;
  if (host.endsWith("loom.com") && u.pathname.startsWith("/share/")) return `https://www.loom.com/embed/${u.pathname.split("/")[2]}`;
  if (host.endsWith("figma.com")) return `https://www.figma.com/embed?embed_host=nexus&url=${encodeURIComponent(raw)}`;
  if (host === "docs.google.com" && /\/(document|spreadsheets|presentation|forms)\/d\//.test(u.pathname)) return raw.replace(/\/(edit|view)([?#].*)?$/, "/preview");
  if (host === "drive.google.com" && /\/file\/d\//.test(u.pathname)) return raw.replace(/\/(view|edit)([?#].*)?$/, "/preview");
  if (host === "open.spotify.com" && /^\/(track|album|playlist|episode|show)\//.test(u.pathname)) return `https://open.spotify.com/embed${u.pathname}`;
  if ((host === "google.com" || host === "maps.google.com") && u.pathname.startsWith("/maps/embed")) return raw;
  return null;
}

/** "Upload / paste a link" panel shown by an image or file block that has nothing yet. */
function MediaPlaceholder({ props, kind }: { props: NodeViewProps; kind: "image" | "file" }) {
  const { t } = useLang();
  const ctx = ctxOf(props.editor);
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = props.editor.isEditable;
  const upload = async (file: File) => {
    if (!ctx) return;
    setError(null);
    setBusy(0);
    try {
      const res = await ctx.upload(file, (p) => setBusy(p));
      if (kind === "image") props.updateAttributes({ src: res.url, alt: res.name });
      else props.updateAttributes({ url: res.url, name: res.name, size: res.size, mime: res.type });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Upload failed."));
    } finally {
      setBusy(null);
    }
  };
  const useLink = () => {
    const url = link.trim();
    if (!SAFE_URL.test(url)) { setError(t("Paste a link that starts with https://")); return; }
    if (kind === "image") props.updateAttributes({ src: url });
    else props.updateAttributes({ url, name: url.split("/").pop() || url });
  };
  const Icon = kind === "image" ? ImageIcon : Paperclip;
  return (
    <div className="nx-media-empty" contentEditable={false}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{kind === "image" ? t("Add an image") : t("Add a file")}</span>
      </div>
      {editable && (
        <div className="mt-2">
          <div className="mb-2 flex gap-1 text-xs">
            <button type="button" onClick={() => setTab("upload")} className={cn("rounded-md px-2 py-1", tab === "upload" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60")}>{t("Upload")}</button>
            <button type="button" onClick={() => setTab("link")} className={cn("rounded-md px-2 py-1", tab === "link" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60")}>{t("Embed link")}</button>
          </div>
          {tab === "upload" ? (
            <>
              <input ref={input} type="file" accept={kind === "image" ? "image/*" : undefined} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
              <button type="button" disabled={busy !== null || !ctx?.projectId} onClick={() => input.current?.click()} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60">
                {busy !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy !== null ? t("Uploading… {pct}%", { pct: Math.round(busy) }) : kind === "image" ? t("Upload image") : t("Upload file")}
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); useLink(); } }} placeholder={t("Paste the link…")} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring" />
              <button type="button" onClick={useLink} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">{t("Embed")}</button>
            </div>
          )}
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function ImageView(props: NodeViewProps) {
  const src = props.node.attrs.src as string | null;
  return (
    <NodeViewWrapper className={cn("nx-image", props.selected && "is-selected")} data-drag-handle="">
      {src && SAFE_URL.test(src) ? <img src={src} alt={(props.node.attrs.alt as string) ?? ""} loading="lazy" draggable={false} /> : <MediaPlaceholder props={props} kind="image" />}
    </NodeViewWrapper>
  );
}

export function FileBlockView(props: NodeViewProps) {
  const { t } = useLang();
  const { url, name, size } = props.node.attrs as { url: string | null; name: string | null; size: number | null };
  return (
    <NodeViewWrapper className={cn("nx-file", props.selected && "is-selected")}>
      {url && SAFE_URL.test(url) ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="nx-file-card" contentEditable={false}>
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">{name || t("File")}</span>
          {size ? <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(size)}</span> : null}
        </a>
      ) : <MediaPlaceholder props={props} kind="file" />}
    </NodeViewWrapper>
  );
}

export function BookmarkView(props: NodeViewProps) {
  const { t } = useLang();
  const { url, embed } = props.node.attrs as { url: string | null; title: string | null; embed: boolean };
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editable = props.editor.isEditable;
  if (!url) {
    const submit = () => {
      const v = value.trim();
      if (!/^https?:\/\//i.test(v)) { setError(t("Paste a link that starts with https://")); return; }
      props.updateAttributes({ url: v });
    };
    return (
      <NodeViewWrapper className="nx-bookmark">
        <div className="nx-media-empty" contentEditable={false}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {embed ? <Globe className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            <span>{embed ? t("Embed a link (YouTube, Figma, Google Docs, Loom, Spotify…)") : t("Add a web bookmark")}</span>
          </div>
          {editable && (
            <div className="mt-2 flex gap-2">
              <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} placeholder={t("Paste the link…")} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring" />
              <button type="button" onClick={submit} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">{embed ? t("Embed") : t("Create bookmark")}</button>
            </div>
          )}
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>
      </NodeViewWrapper>
    );
  }
  const frame = embed ? embedUrlOf(url) : null;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  return (
    <NodeViewWrapper className={cn("nx-bookmark", props.selected && "is-selected")}>
      {frame ? (
        <div className="nx-embed" contentEditable={false}>
          <iframe src={frame} title={host} loading="lazy" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="nx-bookmark-card" contentEditable={false}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{(props.node.attrs.title as string) || host}</span>
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Globe className="h-3 w-3 shrink-0" />{url}</span>
            {embed && <span className="mt-1 block text-xs text-muted-foreground">{t("This site can't be embedded; it opens in a new tab.")}</span>}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        </a>
      )}
    </NodeViewWrapper>
  );
}

export function CalloutView(props: NodeViewProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const editable = props.editor.isEditable;
  const emoji = (props.node.attrs.emoji as string) || "💡";
  return (
    <NodeViewWrapper className="nx-callout" data-color={props.node.attrs.blockColor ?? undefined}>
      <Popover open={open && editable} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" contentEditable={false} className="nx-callout-emoji" aria-label={t("Callout icon")} disabled={!editable}>{emoji}</button>
        </PopoverTrigger>
        <PopoverContent className="z-[120] w-72 p-2" align="start">
          <EmojiGrid onPick={(e) => { props.updateAttributes({ emoji: e }); setOpen(false); }} />
        </PopoverContent>
      </Popover>
      <NodeViewContent className="nx-callout-body" />
    </NodeViewWrapper>
  );
}

function fmtChip(date: string, time: string | null, lang: "id" | "en", t: (s: string) => string): string {
  const today = jakartaDate();
  const tomorrow = jakartaDate(1);
  const yesterday = jakartaDate(-1);
  let day: string;
  if (date === today) day = t("Today");
  else if (date === tomorrow) day = t("Tomorrow");
  else if (date === yesterday) day = t("Yesterday");
  else {
    const d = new Date(`${date}T00:00:00+07:00`);
    day = Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(d);
  }
  return time ? `${day} ${time}` : day;
}

export function DateChipView(props: NodeViewProps) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const { date, time, remind } = props.node.attrs as { date: string | null; time: string | null; remind: boolean };
  const editable = props.editor.isEditable;
  const me = ctxOf(props.editor)?.me;
  const label = date ? fmtChip(date, time, lang, t) : t("Pick a date");
  const overdue = !!remind && !!date && `${date}T${time ?? "09:00"}` < `${jakartaDate()}T${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  return (
    <NodeViewWrapper as="span" className="nx-date-wrap">
      <Popover open={open && editable} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" contentEditable={false} className={cn("nx-date", remind && "is-remind", overdue && "is-overdue", props.selected && "is-selected")}>
            {remind ? <Bell className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
            <span>@{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="z-[120] w-64 space-y-3 p-3" align="start">
          <label className="block text-xs font-medium text-muted-foreground">{t("Date")}
            <input type="date" value={date ?? ""} onChange={(e) => props.updateAttributes({ date: e.target.value || jakartaDate() })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">{t("Time (optional)")}
            <input type="time" value={time ?? ""} onChange={(e) => props.updateAttributes({ time: e.target.value || null })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" />{t("Remind me")}</span>
            <input type="checkbox" checked={!!remind} onChange={(e) => props.updateAttributes({ remind: e.target.checked, remindUserId: e.target.checked ? me?.id ?? null : null, time: e.target.checked && !time ? "09:00" : time })} className="h-4 w-4 accent-[var(--primary)]" />
          </label>
          {remind && <p className="text-xs text-muted-foreground">{t("You get a notification at that time (WIB).")}</p>}
          <button type="button" onClick={() => { setOpen(false); props.deleteNode(); }} className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive hover:underline"><Trash2 className="h-3.5 w-3.5" />{t("Remove")}</button>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

export function MentionView(props: NodeViewProps) {
  const { id, label, kind } = props.node.attrs as { id: string; label: string | null; kind: string | null };
  const ctx = ctxOf(props.editor);
  const text = label || id;
  const k = kind ?? "user";
  let inner: ReactNode;
  if (k === "user") inner = <span className="nx-mention is-user">@{text}</span>;
  else if (k === "task") {
    inner = (
      <Link to="/tasks/$taskId" params={{ taskId: id }} className="nx-mention is-task" onClick={(e) => { if (ctx?.openTask && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ctx.openTask(id); } }}>
        <CheckSquare className="h-3.5 w-3.5" />{text}
      </Link>
    );
  } else if (k === "doc") inner = <Link to="/docs/$docId" params={{ docId: id }} className="nx-mention is-doc"><FileText className="h-3.5 w-3.5" />{text}</Link>;
  else if (k === "project") inner = <Link to="/projects/$projectId" params={{ projectId: id }} className="nx-mention is-project"><ProjectMarkFor projectId={id} size={14} />{text}</Link>;
  else inner = <span className="nx-mention">{text}</span>;
  return <NodeViewWrapper as="span" className={cn("nx-mention-wrap", props.selected && "is-selected")} contentEditable={false}>{inner}</NodeViewWrapper>;
}
