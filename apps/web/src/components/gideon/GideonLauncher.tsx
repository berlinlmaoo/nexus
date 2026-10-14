import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
 * The GIDEON button and panel. Opened by the button, ⌘/Ctrl+O (a new chat, like Notion AI), or from anywhere
 * through openGideon() (the project header's "Ask GIDEON"). Two layouts: a floating window, or docked as a
 * full-height side panel; the full page is the /gideon route (where this launcher steps aside).
 */
/** What the floating button must not cover. */
const AVOID = 'button, a[href], input, select, textarea, [role="button"], [role="combobox"], [role="checkbox"], [role="switch"], [role="tab"], [data-gideon-avoid]';

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

  // The button never rests on a control (UI tour run 10, WD-3: it sat on Settings' "Change password" as the
  // page opened). After each scroll, resize or content change it checks what lies under it and, when that is a
  // button, link or field, rises to the first clear spot above (in button-sized steps), else stays put.
  const btnRef = useRef<HTMLButtonElement>(null);
  const liftRef = useRef(0);
  const [lift, setLift] = useState(0);
  const buttonShown = !open && !hideButton && !onFullPage;
  useEffect(() => {
    if (!buttonShown) return;
    let timer = 0;
    const check = () => {
      const b = btnRef.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      if (r.width === 0) return; // hidden on phones (display: none; a fixed element has no offsetParent either way)
      const baseTop = r.top + liftRef.current;
      const blocked = (offset: number) => {
        const top = baseTop - offset;
        const pts: [number, number][] = [[r.left + 4, top + 4], [r.right - 4, top + 4], [r.left + 4, top + r.height - 4], [r.right - 4, top + r.height - 4], [r.left + r.width / 2, top + r.height / 2]];
        return pts.some(([x, y]) => {
          const under = document.elementsFromPoint(x, y).find((el) => !b.contains(el));
          const hit = under?.closest(AVOID);
          // Row-wide buttons (a list row, a card) are not what the button hides: only controls under ~half a page.
          return !!hit && hit.getBoundingClientRect().width < Math.min(480, window.innerWidth / 2);
        });
      };
      const next = [0, 56, 112, 168].find((o) => !blocked(o)) ?? 0;
      if (next !== liftRef.current) { liftRef.current = next; setLift(next); }
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(check, 200); };
    schedule();
    // Content arriving (a query resolving) changes what is under the button without a scroll or a resize.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.clearTimeout(timer); mo.disconnect(); window.removeEventListener("scroll", schedule, { capture: true }); window.removeEventListener("resize", schedule); };
  }, [buttonShown, pathname]);

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
          // Sheet sidebars hide this while open (sheet-shell HideGideonButton): it sat on their Done button.
          data-gideon-launcher=""
          ref={btnRef}
          style={lift ? { translate: `0 -${lift}px` } : undefined}
          onClick={() => openGideon(null)}
          onPointerEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          aria-label={t("Open {assistant}", { assistant: name })}
          title={t("Open {assistant} ({keys} for a new chat)", { assistant: name, keys: modKey("O") })}
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
