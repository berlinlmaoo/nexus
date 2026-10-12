import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { getRouter } from "./router";
import type { QueryClient } from "@tanstack/react-query";
import { isAuthError, nexusApi } from "./lib/nexus-api";
import "./styles.css";

const router = getRouter();

// The session check starts with the page, not after the app shell's code has loaded (perf pass, 12 Oct
// 2026): routes/_app.tsx reads the same query, so it finds it in flight or already answered.
if (!/^\/(login|register|forgot-password|f\/|s\/|v\/|oauth|sso|download|room-display|phaethon)/.test(window.location.pathname)) {
  // Same retry rule as the shell's own query: one retry on a 401, so a signed-out visitor still reaches
  // /login at once instead of after three back-offs.
  const qc = (router.options.context as { queryClient: QueryClient }).queryClient;
  void qc.prefetchQuery({
    queryKey: ["nexus", "profile"],
    queryFn: nexusApi.profile,
    retry: (n, e) => (isAuthError(e) ? n < 1 : n < 3),
    retryDelay: 800,
  });
}

// DEV environment marker (stripe + "[DEV]" title). Only builds made with VITE_NEXUS_ENV=dev include it.
if (import.meta.env.VITE_NEXUS_ENV === "dev") {
  void import("./lib/dev-marker").then((m) => m.installDevMarker());
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
