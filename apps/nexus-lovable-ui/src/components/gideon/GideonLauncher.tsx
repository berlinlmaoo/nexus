import { useState } from "react";
import { GideonMark } from "./GideonMark";
import { GideonPanel } from "./GideonPanel";
import { clearGideonContext, closeGideon, openGideon, useGideonLauncher } from "@/lib/gideon";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * The floating GIDEON button and panel. Opened by the button, or from anywhere through openGideon()
 * (the project header's "Ask GIDEON" passes the project as context). Wide mode (desktop) gives answers
 * with tables and cards room, like Notion's side chat.
 */
export function GideonLauncher() {
  const { open, context, nonce } = useGideonLauncher();
  const { t } = useLang();
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("gideon-wide") === "1"; } catch { return false; }
  });
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => openGideon(null)}
          aria-label={t("Open GIDEON")}
          className="fixed bottom-32 right-4 z-50 grid h-12 w-12 place-items-center rounded-2xl border border-border bg-card text-foreground shadow-pop transition-all hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
        >
          <GideonMark className="h-5 w-5" />
        </button>
      )}
      {open && (
        <div className={cn("fixed bottom-4 right-4 z-50 h-[78vh] w-[calc(100vw-2rem)] md:bottom-6 md:right-6", wide ? "max-w-2xl" : "max-w-md")}>
          <GideonPanel
            key={nonce}
            onClose={closeGideon}
            context={context}
            onClearContext={clearGideonContext}
            wide={wide}
            onToggleWide={() => setWide((w) => { const n = !w; try { localStorage.setItem("gideon-wide", n ? "1" : "0"); } catch { /* private mode */ } return n; })}
          />
        </div>
      )}
    </>
  );
}
