import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2, LogIn } from "lucide-react";
import { ApiError, nexusApi } from "@/lib/nexus-api";
import { useDocumentLang, useLang } from "@/lib/lang";
import { FormRenderer } from "@/components/forms/FormRenderer";
import type { RichField } from "@/components/forms/form-model";
import { LegalRequestPage } from "@/components/legal/LegalRequestForm";
import { isLegalLinkId } from "@/lib/legal-requests-api";

export const Route = createFileRoute("/f/$formId")({ component: FormOrLegalRequest });

/** /f/legal-<token> is a Legal request link (owner, 14 Oct 2026); every other id or slug is a form. */
function FormOrLegalRequest() {
  const { formId } = useParams({ from: "/f/$formId" });
  if (isLegalLinkId(formId)) return <LegalRequestPage linkId={formId} fallback={<PublicForm />} />;
  return <PublicForm />;
}

/** The page people fill in. The body is FormRenderer, the same component as the builder's Preview. */
function PublicForm() {
  // No sign-in shell here: the page follows the language stored on this browser ("nexus-lang"), like the app.
  const { t, lang } = useLang();
  useDocumentLang(lang);
  const { formId } = useParams({ from: "/f/$formId" });

  const form = useQuery({ queryKey: ["public-form", formId], queryFn: () => nexusApi.publicForm(formId), retry: false });
  const f = form.data;

  // Who may send (owner, 25 Oct 2026): a public form without sign-in (isPublic, requireAuth false) takes anyone,
  // no account; any other form needs one. Signed out on such a form, the questions show read-only and the button
  // is "Sign in to send", which comes back here after signing in.
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const loggedIn = !!me.data?.user;
  const needsLogin = !me.isLoading && !loggedIn;
  const openToAll = !!f && f.isPublic === true && f.requireAuth === false;

  // Schedule, one-off window or response cap: the backend answers 403 with `accessSchedule` + a message.
  const err = form.error as ApiError | undefined;
  const scheduleMsg = err && typeof err.payload === "object" && err.payload && "accessSchedule" in err.payload ? err.message : null;
  const loginUrl = `/login?callbackUrl=${encodeURIComponent(`/f/${formId}`)}`;

  return (
    <div lang={lang} className="min-h-screen bg-background text-foreground">
      {(form.isLoading || (f && me.isLoading)) && <div className="flex justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      {form.isError && (
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          {scheduleMsg ? (
            <>
              <Clock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <div className="text-lg font-bold">{t("This form isn't open")}</div>
              <p className="mt-2 text-sm text-muted-foreground">{scheduleMsg}</p>
            </>
          ) : (
            <>
              <div className="text-lg font-bold">{t("Form unavailable")}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t("This form is private or no longer exists.")}</p>
              {needsLogin && <a href={loginUrl} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"><LogIn className="h-4 w-4" /> {t("Sign in")}</a>}
            </>
          )}
        </div>
      )}

      {f && !me.isLoading && (
        <FormRenderer
          form={{ name: f.name, description: f.description, fields: (f.fields ?? []) as RichField[], branding: f.branding, settings: f.settings }}
          formKey={formId}
          me={me.data?.user}
          signInUrl={needsLogin && !openToAll ? loginUrl : undefined}
        />
      )}
    </div>
  );
}
