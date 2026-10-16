import { lazy, Suspense, useEffect, useState } from "react";
import { globalModShortcut, modKey } from "@/lib/keyboard";
import { useRouterState } from "@tanstack/react-router";
import { GideonMark } from "./GideonMark";
import { clearGideonContext, closeGideon, openGideon, useGideonLauncher } from "@/lib/gideon";
import { getGideonPrefs, setCachedGideonPrefs, useGideonLayout, useGideonName, useGideonPrefs } from "@/lib/gideon-ai";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

// The panel (chat, Markdown, history) loads the first time GIDEON opens, not with every page (perf pass,
// 12 Oct 2026). Hovering or focusing the button starts the download early.
const loadPanel = () => import("./GideonPanel");
const GideonPanel = lazy(() => loadPanel().then((m) => ({ default: m.GideonPanel })));

/**
 * The GIDEON panel. Opened by the "Ask GIDEON" button in the sidebar header (GideonAskButton), ⌘/Ctrl+O (a new
 * chat, like Notion AI), or from anywhere through openGideon() (the project header's "Ask GIDEON"). Two layouts:
 * a floating window, or docked as a full-height side panel; the full page is the /gideon route (where this
 * launcher steps aside).
 *
 * There is no floating button any more (UI tour run 11, WD-1). A button fixed bottom-right always ends up on
 * someone's content (Replace buttons, the calendar side panel, board chips) however it dodges; docked next to
 * Search in the sidebar, as Notion does with Notion AI, it sits where content never reaches.
 */
export function GideonLauncher() {
  const { open, context, nonce, chatId, newChat } = useGideonLauncher();
  const layout = useGideonLayout();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const onFullPage = pathname === "/gideon" || pathname.startsWith("/gideon/");
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("gideon-wide") === "1"; } catch { return false; }
  });

  // "Ask GIDEON" pins its project as context only while that project is on screen: leaving it (another
  // project, the dashboard) lets the chip follow the page again (bughunt G-BUG-1).
  useEffect(() => {
    if (context && !pathname.includes(context.projectId)) clearGideonContext();
  }, [pathname, context]);

  // ⌘/Ctrl+O anywhere = a new GIDEON chat (the open panel handles it itself).
  useEffect(() => {
    if (open || onFullPage) return;
    const onKey = (e: KeyboardEvent) => {
      // Not while typing in a field or an editor (QA B32): there the key stays the field's.
      if (globalModShortcut(e) && !e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openGideon(null, { newChat: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onFullPage]);

  if (onFullPage) return null;
  const panel = (
    <Suspense fallback={<div className="h-full w-full bg-background md:rounded-2xl md:border md:border-border" aria-busy />}>
    <GideonPanel
      key={nonce}
      onClose={closeGideon}
      context={context}
      onClearContext={clearGideonContext}
      wide={wide}
      onToggleWide={() => setWide((w) => { const n = !w; try { localStorage.setItem("gideon-wide", n ? "1" : "0"); } catch { /* private mode */ } return n; })}
      variant={layout === "side" ? "side" : "float"}
      initialChatId={chatId ?? null}
      startNew={Boolean(newChat)}
    />
    </Suspense>
  );
  return (
    <>
      {/* Notion AI: docked, a full-height column on the right; floating, a window bottom-right. On a phone
          both fill the screen, as Notion's mobile AI does (a 78vh card left the page peeking around it). */}
      {open && layout === "side" && (
        <div className="fixed inset-0 z-50 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] md:inset-y-0 md:left-auto md:right-0 md:w-[420px] md:pb-0 md:pt-0 md:shadow-[-8px_0_24px_-12px_rgba(15,15,15,0.12)]">{panel}</div>
      )}
      {open && layout !== "side" && (
        <div className={cn("fixed inset-0 z-50 bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] md:inset-auto md:bottom-5 md:right-5 md:h-[min(78vh,760px)] md:w-[calc(100vw-2.5rem)] md:bg-transparent md:pb-0 md:pt-0", wide ? "md:max-w-2xl" : "md:max-w-[420px]")}>{panel}</div>
      )}
    </>
  );
}

/**
 * "Ask GIDEON" in the sidebar header, beside Search: the one place on desktop to open the panel by pointer
 * (⌘/Ctrl+O and the project header's button are the others). Hidden while the rail is collapsed to icons,
 * where the GIDEON nav entry opens the full page.
 */
export function GideonAskButton({ className }: { className?: string }) {
  const name = useGideonName();
  const { t } = useLang();
  const prefs = useGideonPrefs();
  // What this person calls GIDEON, for the button's label before the panel was ever opened.
  useEffect(() => { if (!prefs) getGideonPrefs().then(setCachedGideonPrefs).catch(() => undefined); }, [prefs]);
  return (
    <button
      type="button"
      onClick={() => openGideon(null)}
      onPointerEnter={() => void loadPanel()}
      onFocus={() => void loadPanel()}
      aria-label={t("Open {assistant}", { assistant: name })}
      title={t("Open {assistant} ({keys} for a new chat)", { assistant: name, keys: modKey("O") })}
      className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-border bg-background/60 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", className)}
    >
      <GideonMark className="h-4 w-4" />
    </button>
  );
}
