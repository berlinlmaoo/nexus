import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // NEXUS is an always-online web app. React Query's default networkMode "online" PAUSES a query
        // (fetchStatus "paused", status stuck "pending") whenever its onlineManager thinks the browser
        // is offline — and that detection misfires in real environments (VPNs, captive portals, some
        // mobile webviews, CDP-driven browsers) even while navigator.onLine is true. A paused profile
        // query never reaches an error state, so the /_app auth guard could never fire and a signed-out
        // visitor got stuck on a blank app shell instead of /login. "always" = never pause; fetch, fail,
        // surface the 401, let the guard redirect.
        networkMode: "always",
      },
      mutations: { networkMode: "always" },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
