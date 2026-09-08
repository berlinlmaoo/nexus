import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, HardDrive, Loader2, Lock, LogIn } from "lucide-react";
import { ApiError, nexusApi, type VaultPublicFile } from "@/lib/nexus-api";
import { Button } from "@/components/ui/button";

// Two routes, one component, one API. `/v/*` is claimed in the AASA and opens the iOS/Mac app when
// one is installed; `/s/*` is deliberately not claimed, so an external link handed to a client always
// stays in their browser. Which prefix a link uses is decided when it is made, from the same
// requireAuth flag the server enforces on every request.
export const Route = createFileRoute("/v/$slug")({ component: VaultSharePage });

export function VaultSharePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  const q = useQuery({
    queryKey: ["vault-public", slug],
    queryFn: () => nexusApi.vaultPublic(slug),
    retry: false,
  });

  if (q.isLoading) {
    return (
      <Shell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Shell>
    );
  }

  if (q.error) {
    const err = q.error as ApiError;
    const needsLogin = err.status === 401;
    return (
      <Shell>
        <Lock className="h-10 w-10 text-muted-foreground/40" />
        <h1 className="text-lg font-semibold mt-4">
          {needsLogin ? "Tautan internal" : "Tautan tidak bisa dibuka"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {err.message || "Tautan ini sudah tidak berlaku."}
        </p>
        {needsLogin && (
          <Button className="mt-5" asChild>
            <a href={`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`}>
              <LogIn className="h-4 w-4 mr-1.5" /> Masuk ke NEXUS
            </a>
          </Button>
        )}
      </Shell>
    );
  }

  const data = q.data as VaultPublicFile;
  const mime = data.file.mimeType || "";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 md:px-8 py-3 flex items-center gap-2">
        <HardDrive className="h-5 w-5 text-primary" />
        <span className="font-semibold">Z Vault</span>
        <span className="text-muted-foreground text-sm truncate ml-2">{data.file.name}</span>
        {data.allowDownload && data.downloadUrl && (
          <Button size="sm" className="ml-auto" asChild>
            <a href={data.downloadUrl}>
              <Download className="h-4 w-4 mr-1.5" /> Unduh
            </a>
          </Button>
        )}
      </header>

      <main className="flex-1 grid place-items-center p-4 md:p-8">
        <div className="w-full max-w-4xl">
          {mime.startsWith("image/") ? (
            <img src={data.previewUrl} alt={data.file.name} className="w-full h-auto rounded-xl border border-border" />
          ) : mime.startsWith("video/") ? (
            <video src={data.previewUrl} controls className="w-full rounded-xl border border-border" />
          ) : mime.startsWith("audio/") ? (
            <audio src={data.previewUrl} controls className="w-full" />
          ) : mime === "application/pdf" ? (
            <iframe src={data.previewUrl} title={data.file.name} className="w-full h-[75vh] rounded-xl border border-border" />
          ) : (
            <div className="rounded-xl border border-border p-12 text-center">
              <HardDrive className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Jenis berkas ini tidak bisa dipratinjau di browser.
                {data.allowDownload ? " Unduh untuk membukanya." : ""}
              </p>
            </div>
          )}
          {!data.allowDownload && (
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Tautan ini cuma untuk dilihat. Unduhan dimatikan oleh pengirimnya.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background grid place-items-center p-6">
      <div className="flex flex-col items-center text-center">{children}</div>
    </div>
  );
}
