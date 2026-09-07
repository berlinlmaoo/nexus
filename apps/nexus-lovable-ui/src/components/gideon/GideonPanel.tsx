import { useEffect, useRef, useState } from "react";
import { BarChart2, FileText, ImagePlus, Loader2, MoreHorizontal, Paperclip, Send, Trash2, Wrench, X } from "lucide-react";
import { GideonMark } from "./GideonMark";
import { clearGideonHistory, gideonAttachmentLink, loadGideonHistory, streamGideon, GIDEON_TIERS, GIDEON_DEFAULT_TIER, GIDEON_FILE_ACCEPT, GIDEON_MAX_FILE_BYTES, isAcceptedGideonFile, type GideonAttachment, type GideonFile, type GideonMessage, type GideonTier, type GideonTurn } from "@/lib/gideon";
import { cn } from "@/lib/utils";

type ChatTurn = GideonTurn & { streaming?: boolean };

export function GideonPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** A data URL, held only until the next message is sent. */
  const [image, setImage] = useState<string | null>(null);
  /** A picked document, held only until the next message is sent. Rides alongside an image, not instead of it. */
  const [doc, setDoc] = useState<GideonFile | null>(null);
  /** Why the last pick was refused before it was ever uploaded. Cleared by the next pick, or by sending. */
  const [attachError, setAttachError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Remembered per browser: somebody who picks Terra for quick questions should not have to pick it
  // again every time the panel opens.
  const [tier, setTier] = useState<GideonTier>(() => {
    try {
      const saved = localStorage.getItem("gideon-tier");
      return (GIDEON_TIERS.some((t) => t.id === saved) ? saved : GIDEON_DEFAULT_TIER) as GideonTier;
    } catch {
      return GIDEON_DEFAULT_TIER;
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Every blob: handle minted for a chip on a turn sent in this session, so all of them can go at once. */
  const localUrls = useRef<string[]>([]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  useEffect(() => () => {
    abortRef.current?.abort();
    // Released together with the chips that used them. The launcher unmounts this panel when it is
    // closed, so a session's blobs live exactly as long as the messages pointing at them — and the
    // stored copy takes over the moment the panel is opened again.
    for (const url of localUrls.current) URL.revokeObjectURL(url);
    localUrls.current = [];
  }, []);

  // Restore the saved conversation on open. If the user already started typing a turn before the
  // history landed, their turn wins — a late response must never wipe live messages.
  useEffect(() => {
    let cancelled = false;
    loadGideonHistory().then((rows) => {
      if (cancelled) return;
      if (rows.length) setTurns((cur) => (cur.length ? cur : rows));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const clearHistory = async () => {
    if (busy || (!turns.length && !loading)) return;
    if (!window.confirm("Hapus semua history chat Gideon? Ini permanen.")) return;
    setTurns([]);
    await clearGideonHistory();
  };

  // Both checks are the route's own, run again here: refusing at the picker costs nothing, while
  // discovering the same refusal after uploading ten megabytes costs the whole upload. The wording
  // matches what the route answers with, so the two paths do not read like two different problems.
  const attachDocument = (picked: File) => {
    if (!isAcceptedGideonFile(picked.name)) {
      setAttachError("Tipe file itu belum bisa dibaca Gideon.");
      return;
    }
    if (picked.size > GIDEON_MAX_FILE_BYTES) {
      setAttachError("File terlalu besar. Maksimal 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { setAttachError("File itu gagal dibaca."); return; }
      setAttachError(null);
      setDoc({ name: picked.name, type: picked.type || "", data: reader.result });
    };
    reader.onerror = () => setAttachError("File itu gagal dibaca.");
    reader.readAsDataURL(picked);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setAttachError(null);
    const history: GideonMessage[] = [...turns.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];

    // The chip on the turn being sent points at a copy of the bytes this tab is already holding.
    // The stream answers with text and a `done` and never says where the file was stored, so the
    // only way to a server url from here is to re-read the whole conversation from /history — a
    // round trip to redraw a picture the browser has in memory. Same shape either way: on the next
    // open this turn comes back from history and the chip is drawn from the stored file instead.
    //
    // Image first, then document, which is the order the composer lists them in and the order
    // storeGideonAttachments writes them in — so nothing reorders itself after a reload.
    const sent: GideonAttachment[] = [];
    if (image) {
      const held = holdLocalFile(image);
      if (held) sent.push({ kind: "image", url: held.url, name: "", mime: held.mime, size: held.size });
    }
    if (doc) {
      const held = holdLocalFile(doc.data);
      if (held) sent.push({ kind: "document", url: held.url, name: doc.name, mime: doc.type || held.mime, size: held.size });
    }
    localUrls.current.push(...sent.map((a) => a.url));

    setTurns((cur) => [...cur, { role: "user", content: text, attachments: sent }, { role: "assistant", content: "", streaming: true, tools: [] }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    const tools: string[] = [];

    await streamGideon(history, (ev) => {
      if (ev.type === "text") {
        acc += ev.content;
        setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, content: acc }; return next; });
      } else if (ev.type === "tool_result") {
        if (ev.name) tools.push(ev.name);
        setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, tools: [...tools] }; return next; });
      } else if (ev.type === "error") {
        acc += (acc ? "\n\n" : "") + `⚠️ ${ev.content ?? "Something went wrong."}`;
        setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, content: acc }; return next; });
      }
    }, { signal: controller.signal, model: tier, image, file: doc }).catch(() => {});
    // Cleared whatever happened: an attachment silently riding along on the NEXT question would be
    // baffling, and re-attaching is one click. That includes a refused one — the reason came back
    // in the bubble above, and the fix is a different file rather than the same one again.
    setImage(null);
    setDoc(null);

    setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, streaming: false }; return next; });
    setBusy(false);
  };

  return (
    <div className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
      <div className="flex items-center gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-muted text-foreground"><GideonMark className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><div className="text-sm font-bold">Gideon</div><div className="text-[11px] text-muted-foreground">AI assistant · acts on your workspace</div></div>
        <select
          value={tier}
          onChange={(e) => {
            const next = e.target.value as GideonTier;
            setTier(next);
            try { localStorage.setItem("gideon-tier", next); } catch { /* private mode */ }
          }}
          title={GIDEON_TIERS.find((t) => t.id === tier)?.blurb}
          aria-label="Pilih tingkatan GIDEON"
          className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground outline-none focus:border-primary"
        >
          {GIDEON_TIERS.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {turns.length > 0 && (
          <button onClick={clearHistory} title="Hapus history chat" aria-label="Hapus history chat" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Trash2 className="h-4 w-4" /></button>
        )}
        <button onClick={onClose} aria-label="Tutup Gideon" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading && turns.length === 0 && (
          <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        )}
        {!loading && turns.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <GideonMark className="mx-auto mb-3 h-8 w-8 text-foreground/70" />
              <p className="text-sm font-semibold">Ask Gideon anything</p>
              <p className="mt-1 text-xs text-muted-foreground">“Create a task to ship the landing page”, “What’s overdue?”, “Summarize project Atlas”.</p>
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", t.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {t.tools && t.tools.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {t.tools.map((name, j) => <span key={j} className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"><Wrench className="h-2.5 w-2.5" /> {name}</span>)}
                </div>
              )}
              {/* Above the question, the way it sat above the box while it was being written. Until
                  today a sent message showed nothing at all, so a conversation reopened tomorrow was
                  a question with no sign of what it was about. */}
              {t.attachments && t.attachments.length > 0 && (
                <div className="mb-1.5 flex flex-col gap-2">
                  {t.attachments.map((a, j) => (
                    <GideonAttachmentChip key={j} kind={a.kind} name={a.name} src={a.kind === "image" ? a.url : undefined} link={gideonAttachmentLink(a)} onBubble={t.role === "user"} />
                  ))}
                </div>
              )}
              {t.content ? <span className="whitespace-pre-wrap">{t.content}</span> : t.streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          </div>
        ))}
      </div>

      {/* creative-card composer (21st.dev ruixenui/creative-card) */}
      <div className="border-t border-border p-3">
        <div className="relative flex w-full flex-col overflow-hidden rounded-2xl p-[2px]">
          {/* glow */}
          <div aria-hidden className="pointer-events-none absolute -left-2 -top-2 h-8 w-8 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,255,255,0.15),transparent_70%)] blur-sm" />

          {/* chat box */}
          <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40 backdrop-blur">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message Gideon…✨"
              className="h-14 w-full resize-none bg-transparent p-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
            />
            {/* One chip per attachment, each removable on its own: a picture and a document can be
                attached to the same question, and dropping one must not drop the other. */}
            {(image || doc) && (
              <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2">
                {image && <GideonAttachmentChip kind="image" src={image} onRemove={() => setImage(null)} />}
                {/* The filename, not "Dokumen terlampir": with two files picked in a row it is the
                    only thing that says WHICH one is about to be sent. */}
                {doc && <GideonAttachmentChip kind="document" name={doc.name} onRemove={() => setDoc(null)} />}
              </div>
            )}
            {attachError && (
              <div className="border-t border-border/60 px-3 py-2 text-xs font-semibold text-destructive">{attachError}</div>
            )}
            <div className="flex items-end justify-between p-3">
              <div className="flex gap-3">
                <label title="Lampirkan gambar" className="flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground">
                  <ImagePlus className="h-4 w-4" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <label title="Lampirkan file (PDF, Word, Excel, teks…)" className="flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground">
                  <Paperclip className="h-4 w-4" />
                  <span className="sr-only">Lampirkan file</span>
                  <input
                    type="file"
                    // A hint to the picker only — a file chosen through "All files" still has to get
                    // past attachDocument, and then past the route.
                    accept={GIDEON_FILE_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files?.[0];
                      // Reset first, so picking the SAME file again still fires a change event.
                      e.target.value = "";
                      if (picked) attachDocument(picked);
                    }}
                  />
                </label>
                {ICON_ACTIONS.map(({ Icon, title, prompt }) => (
                  <button key={title} type="button" title={title} aria-label={title} onClick={() => setInput((cur) => (cur ? cur : prompt))} className="flex cursor-pointer border-none bg-transparent text-foreground/25 transition-all duration-300 hover:-translate-y-1 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"><Icon size={20} /></button>
                ))}
              </div>
              <button onClick={send} disabled={!input.trim() || busy} aria-label="Send" className="flex rounded-lg border-none bg-gradient-to-t from-gray-400 via-gray-300 to-gray-500 p-1 shadow-inner outline-none transition-all duration-150 active:scale-95 disabled:opacity-50 dark:from-gray-800 dark:via-gray-600 dark:to-gray-800">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 p-2 text-gray-600 backdrop-blur-sm dark:bg-black/10 dark:text-gray-300">
                  {busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} className="transition-all duration-300 hover:text-gray-900 hover:drop-shadow-[0_0_5px_#fff] dark:hover:text-white" />}
                </span>
              </button>
            </div>
          </div>

          {/* tags */}
          {!loading && turns.length === 0 && (
            <div className="flex flex-wrap gap-2 py-3 text-xs">
              {SUGGESTIONS.map((tag) => (
                <button key={tag} onClick={() => setInput(tag)} className="cursor-pointer select-none rounded-lg border border-gray-300 bg-white px-2 py-1 transition-colors hover:border-primary/50 hover:text-primary dark:border-gray-800 dark:bg-black">{tag}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One attachment, drawn the same way wherever it appears: a 40px thumbnail for a picture, a glyph
 * for a document, and the file's name beside it.
 *
 * Two callers, one shape. In the composer the chip carries a remove button, because the file has
 * not been sent and can still be dropped; on a message it is a link, because by then the only thing
 * left to do with the file is open it. Giving the second caller a look of its own would make the
 * same file read as two different things a few pixels apart.
 */
function GideonAttachmentChip({ kind, name, src, link, onRemove, onBubble }: {
  kind: "image" | "document";
  /** The file's own name. A photo picked on a phone has none, and gets a word instead. */
  name?: string;
  /** Thumbnail source: the stored file, the data url the composer holds, or this session's blob. */
  src?: string;
  /** Where clicking goes. Absent in the composer, where the file is not yet anywhere to go to. */
  link?: { href: string; download?: string };
  onRemove?: () => void;
  /** Sitting on the primary-coloured user bubble rather than on the card. */
  onBubble?: boolean;
}) {
  // A thumbnail whose file is gone draws the browser's broken-image glyph, which reads as breakage
  // rather than as a file. Fall back to the tile a document gets: still a chip, still openable.
  const [thumbFailed, setThumbFailed] = useState(false);
  const label = name || (kind === "image" ? "Gambar terlampir" : "File terlampir");
  const body = (
    <>
      {kind === "image" && src && !thumbFailed ? (
        <img src={src} alt="" loading="lazy" onError={() => setThumbFailed(true)} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", onBubble ? "bg-primary-foreground/15" : "bg-muted")}>
          {kind === "image" ? <ImagePlus className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
      )}
      <span className="flex-1 truncate text-xs" title={label}>{label}</span>
    </>
  );
  const tone = onBubble ? "text-primary-foreground/80" : "text-muted-foreground";

  // target=_blank for both: /api/files answers a picture or a PDF with `inline` and everything else
  // with `attachment`, so the same link either opens a tab or saves a file, and the one that saves
  // never leaves an empty tab behind. `download` is set only for the blob: handles, which have no
  // headers of their own to carry the name.
  if (link) {
    return (
      <a href={link.href} download={link.download} target="_blank" rel="noreferrer" className={cn("flex items-center gap-2 transition-opacity hover:opacity-80", tone)}>
        {body}
      </a>
    );
  }
  return (
    <div className={cn("flex items-center gap-2", tone)}>
      {body}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={kind === "image" ? "Buang gambar" : "Buang file"} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

/**
 * A handle the browser will open, for a file that has not been anywhere yet.
 *
 * The composer holds a data: url because that is the form the route reads, and a tab cannot
 * navigate to one — Chrome has refused top-level data: navigation for years, so a chip pointing at
 * one would look like a link and do nothing when clicked. The same bytes as a blob are something
 * both an <img> and a link accept. Returns null rather than throwing on anything that is not a data
 * url: a chip that fails to appear is a far smaller loss than a question that fails to send.
 */
function holdLocalFile(dataUrl: string): { url: string; mime: string; size: number } | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) return null;
    const meta = dataUrl.slice("data:".length, comma);
    const base64 = meta.endsWith(";base64");
    const mime = (base64 ? meta.slice(0, -";base64".length) : meta).split(";")[0] || "application/octet-stream";
    const body = dataUrl.slice(comma + 1);
    const bytes = base64
      ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    const blob = new Blob([bytes], { type: mime });
    return { url: URL.createObjectURL(blob), mime, size: blob.size };
  } catch {
    return null;
  }
}

// "Generate image" is gone until something implements it. GIDEON reaches ChatGPT through an OAuth
// session meant for conversation and tools, not image generation, so the button only ever produced a
// prompt nothing could answer. A control that does nothing teaches people the assistant is unreliable
// — and they stop trusting the buttons that DO work.
const ICON_ACTIONS = [
  { Icon: BarChart2, title: "Analyze data", prompt: "Analyze this data: " },
  { Icon: MoreHorizontal, title: "Explore more", prompt: "Explore more about " },
  { Icon: FileText, title: "Write a document", prompt: "Write a document about " },
];

const SUGGESTIONS = ["Analyze Data", "Write a Document", "Explore More"];
