import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

// Bridge for "Sign in with NEXUS" on the 3D agents office (status.znetworks.id/agents/3d).
// GET /api/sso/agents sends signed-out people to /login?callbackUrl=/sso/agents/<state>. After the
// login the SPA navigates here, but an /api path needs a real page load, so this route makes one.
// The state rides in the path, not a query string: callbackUrl goes through navigate({ to }).
export const Route = createFileRoute("/sso/agents/$state")({ component: SsoAgents });

function SsoAgents() {
  const { state } = useParams({ strict: false }) as { state?: string };
  useEffect(() => {
    window.location.replace(`/api/sso/agents?state=${encodeURIComponent(state || "")}`);
  }, [state]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
