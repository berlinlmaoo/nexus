import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Lock, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageBody, PageTabs } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { LegalMembers } from "@/components/legal/LegalMembers";
import { LegalTemplates } from "@/components/legal/LegalTemplates";
import { ApiError } from "@/lib/nexus-api";
import { legalApi } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";

/**
 * Legal (owner, 14 Oct 2026): documents made from templates with automatic numbering, reviewed and versioned,
 * and the archive of every legal document. Invitation only — the nav entry is hidden for everyone else and
 * the server refuses every /api/legal call, so a typed URL lands on the "by invitation" state below.
 */
type LegalTab = "templates" | "members";
type LegalSearch = { tab?: LegalTab };

const TABS: LegalTab[] = ["templates", "members"];

export const Route = createFileRoute("/_app/legal")({
  component: LegalPage,
  validateSearch: (s: Record<string, unknown>): LegalSearch => ({
    tab: typeof s.tab === "string" && (TABS as string[]).includes(s.tab) ? (s.tab as LegalTab) : undefined,
  }),
});

function LegalPage() {
  const { t, lang } = useLang();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/legal" });
  const tab: LegalTab = search.tab ?? "templates";
  const me = useQuery({ queryKey: ["legal", "me"], queryFn: legalApi.me, retry: false, staleTime: 60_000 });

  if (me.isLoading) {
    return (
      <div lang={lang} className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}
      </div>
    );
  }
  if (me.isError) {
    const notInvited = me.error instanceof ApiError && me.error.status === 403;
    return (
      <div lang={lang}>
        <PageHeader title={t("Legal")} />
        <PageBody>
          <EmptyState
            icon={Lock}
            title={notInvited ? t("Legal is by invitation only") : t("Couldn't open Legal")}
            message={notInvited ? t("Ask the owner or a BoD member with Legal access to invite you.") : (me.error as Error).message}
          />
        </PageBody>
      </div>
    );
  }

  return (
    <div lang={lang}>
      <PageHeader
        title={t("Legal")}
        subtitle={t("Contracts, letters and invoices of every company, numbered and archived.")}
        tabs={
          <PageTabs
            label={t("Legal sections")}
            value={tab}
            onChange={(k) => navigate({ search: { tab: k } })}
            tabs={[
              { key: "templates", label: t("Templates"), icon: FileText },
              { key: "members", label: t("Members"), icon: Users },
            ]}
          />
        }
      />
      <PageBody>
        {tab === "templates" && <LegalTemplates />}
        {tab === "members" && <LegalMembers />}
      </PageBody>
    </div>
  );
}
