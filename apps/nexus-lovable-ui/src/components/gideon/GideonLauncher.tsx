import { lazy, Suspense, useEffect, useState } from "react";
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
 * The GIDEON button and panel. Opened by the button, ⌘/Ctrl+O (a new chat, like Notion AI), or from anywhere
 * through openGideon() (the project header's "Ask GIDEON"). Two layouts: a floating window, or docked as a
 * full-height side panel; the full page is the /gideon route (where this launcher steps aside).
 */
export function GideonLauncher() {
  const { open, context, nonce, chatId, newChat } = useGideonLauncher();
  const layout = useGideonLayout();
  const name = useGideonName();
  const { t } = useLang();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const onFullPage = pathname === "/gideon" || pathname.startsWith("/gideon/");
  // Pages where the floating button would sit on the content people are working in: chat (the composer's send
  // button) and a public form. On phones the button is hidden everywhere; GIDEON is in the More sheet there.
  const hideButton = pathname === "/messages" || pathname.startsWith("/messages/") || pathname.startsWith("/f/");
  const prefs = useGideonPrefs();
  // What this person calls GIDEON, for the button's label before the panel was ever opened.
  useEffect(() => { if (!prefs) getGideonPrefs().then(setCachedGideonPrefs).catch(() => undefined); }, [prefs]);
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("gideon-wide") === "1"; } catch { return false; }
  });

  // ⌘/Ctrl+O anywhere = a new GIDEON chat (the open panel handles it itself).
  useEffect(() => {
    if (open || onFullPage) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openGideon(null, { newChat: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onFullPage]);

  if (onFullPage) return null;
  const panel = (
    <Suspense fallback={<div className="h-full w-full rounded-2xl border border-border bg-card" aria-busy />}>
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
      {!open && !hideButton && (
        <button
          type="button"
          onClick={() => openGideon(null)}
          onPointerEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          aria-label={t("Open {assistant}", { assistant: name })}
          title={t("Open {assistant} (⌘O for a new chat)", { assistant: name })}
          className="fixed bottom-6 right-6 z-50 hidden h-12 w-12 place-items-center rounded-2xl border border-border bg-card text-foreground shadow-pop transition-all hover:scale-105 active:scale-95 md:grid"
        >
          <GideonMark className="h-5 w-5" />
        </button>
      )}
      {open && layout === "side" && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[440px] shadow-pop md:w-[440px]">{panel}</div>
      )}
      {open && layout !== "side" && (
        <div className={cn("fixed bottom-4 right-4 z-50 h-[78vh] w-[calc(100vw-2rem)] md:bottom-6 md:right-6", wide ? "max-w-2xl" : "max-w-md")}>{panel}</div>
      )}
    </>
  );
}
