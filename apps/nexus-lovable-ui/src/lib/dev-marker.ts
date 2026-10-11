// Visual marker for the DEV environment (dev server built with VITE_NEXUS_ENV=dev).
// Never runs in production: main.tsx only imports this when the build-time flag is "dev",
// and a production build has no such flag, so the import is dropped entirely.

const PREFIX = "[DEV] ";

export function installDevMarker() {
  // Title: keep "[DEV]" in it whatever the app later sets (route titles, unread counts).
  const ensureTitle = () => {
    if (!document.title.includes(PREFIX.trim())) document.title = PREFIX + document.title;
  };
  ensureTitle();
  const titleEl = document.querySelector("title");
  if (titleEl) new MutationObserver(ensureTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });

  // A thin stripe across the top and a small label; neither takes clicks.
  const stripe = document.createElement("div");
  stripe.setAttribute("aria-hidden", "true");
  Object.assign(stripe.style, {
    position: "fixed", top: "0", left: "0", right: "0", height: "3px", zIndex: "2147483647",
    background: "repeating-linear-gradient(45deg,#f59e0b 0 12px,#111827 12px 24px)", pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement("div");
  label.textContent = "DEV · not production";
  label.setAttribute("role", "note");
  Object.assign(label.style, {
    position: "fixed", bottom: "8px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647",
    padding: "2px 10px", borderRadius: "999px", background: "#f59e0b", color: "#111827",
    font: "600 11px/18px system-ui, sans-serif", letterSpacing: "0.04em", opacity: "0.9", pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  document.body.append(stripe, label);
}
