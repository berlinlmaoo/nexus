import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Loader2, ImagePlus, ArrowRight, ArrowLeft, Check, Sparkles, PartyPopper } from "lucide-react";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { thumbUrl } from "@/lib/thumb";

type Slide = { key: string; title: string; img: string; imgMobile: string; points: string[] };

// Screenshots live in /public/onboarding/. Missing images degrade gracefully.
const SLIDES: Slide[] = [
  { key: "dashboard", title: "Dashboard & navigation", img: "/onboarding/dashboard.png", imgMobile: "/onboarding/dashboard-mobile.png", points: ["The dashboard is your day at a glance: tasks, quests and notifications.", "Switch pages from the sidebar on the web, or the tabs at the bottom on your phone.", "Your photo and level are in the bottom corner."] },
  { key: "board", title: "Projects, boards and adding a task", img: "/onboarding/board.png", imgMobile: "/onboarding/board-mobile.png", points: ["Open a project, then the Board tab.", "Select “Add task” to make one: title, section, priority and due date.", "Fill in custom fields (Price, Status and so on) right in the form."] },
  { key: "attendance", title: "Attendance", img: "/onboarding/attendance.png", imgMobile: "/onboarding/attendance-mobile.png", points: ["Check in and check out every workday, with a selfie and your location.", "Request a day off or sick leave yourself (leave and permits come from the board).", "4 days off a month — a missed attendance takes one automatically."] },
  { key: "leaderboard", title: "Leaderboard & XP", img: "/onboarding/leaderboard.png", imgMobile: "/onboarding/leaderboard-mobile.png", points: ["Earn XP from quests; attendance penalties take it away.", "Your level is this period's: XP resets on the 28th.", "See where you stand on the Leaderboard."] },
];

function Shot({ src, alt, mobile }: { src: string; alt: string; mobile?: boolean }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <div className={cn("grid place-items-center rounded-xl border border-dashed border-border bg-muted/40 text-center text-[11px] font-semibold text-muted-foreground", mobile ? "h-full w-full p-2" : "h-44 w-full")}>
        <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> {alt}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setOk(false)}
      className={cn("block rounded-xl shadow-soft", mobile ? "w-full" : "max-h-64 w-full border border-border object-cover object-top")}
    />
  );
}

// Bump to bust browser/Cloudflare cache when screenshots are replaced.
const IMG_V = "?v=3";

function SlideShots({ slide }: { slide: Slide }) {
  const { t } = useLang();
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Web")}</div>
        <Shot src={slide.img + IMG_V} alt={t("{title} (web)", { title: t(slide.title) })} />
      </div>
      <div className="w-[92px] shrink-0">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Mobile")}</div>
        <div className="overflow-hidden rounded-2xl border-2 border-border bg-card shadow-soft">
          <Shot src={slide.imgMobile + IMG_V} alt={t("{title} (mobile)", { title: t(slide.title) })} mobile />
        </div>
      </div>
    </div>
  );
}

export function OnboardingWizard() {
  const { t } = useLang();
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 30_000 });
  const me = profileQ.data?.user;

  const [step, setStep] = useState(0); // 0=photo, 1=name, 2..=slides, last=done
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshProfile = () => qc.invalidateQueries({ queryKey: ["nexus", "profile"] });
  const upload = useMutation({ mutationFn: (file: File) => nexusApi.uploadAvatar(file), onSuccess: refreshProfile });
  const saveName = useMutation({ mutationFn: (n: string) => nexusApi.updateProfile({ name: n.trim() }), onSuccess: refreshProfile });
  const finish = useMutation({ mutationFn: () => nexusApi.updateProfile({ markOnboarded: true }), onSuccess: refreshProfile });

  // Only show for logged-in users who haven't completed onboarding.
  // Wizard wajib muncul kalau belum onboarding ATAU belum punya foto profil — semua
  // user harus punya profile picture (rule: foto profil wajib).
  if (profileQ.isLoading || !me || (me.onboardedAt && me.avatar)) return null;

  const TOTAL = 2 + SLIDES.length; // photo, name, slides
  const hasAvatar = Boolean(me.avatar);
  const nameValid = name.trim().split(/\s+/).filter(Boolean).length >= 2; // nama lengkap = min 2 kata
  const isSlide = step >= 2 && step < TOTAL;
  const slide = isSlide ? SLIDES[step - 2] : null;
  const isDone = step >= TOTAL;

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-[100] grid grid-cols-1 place-items-center bg-black/60 dark:bg-scrim p-4 backdrop-blur-sm">
      {/* Required (profile photo + full name): no Esc, no close. A modal for assistive tech and the app's
          own shortcuts all the same. */}
      <div role="dialog" aria-modal="true" aria-label={t("Welcome to NEXUS")} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
        {/* progress */}
        <div className="flex items-center gap-1.5 border-b border-border px-6 py-3">
          {Array.from({ length: TOTAL + 1 }).map((_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 0 — photo */}
          {step === 0 && (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-black tracking-tight">{t("Set up your profile")}</h2>
              <p className="text-sm text-muted-foreground">{t("First, add a profile photo.")}</p>
              <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-primary/10 ring-2 ring-border">
                {me.avatar ? <img src={thumbUrl(me.avatar, 40)} loading="lazy" decoding="async" alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-8 w-8 text-muted-foreground" />}
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold transition hover:bg-accent disabled:opacity-50">
                {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {hasAvatar ? t("Change photo") : t("Upload photo")}
              </button>
              {upload.isError && <p className="text-xs font-semibold text-destructive">{t("Upload failed. Try again.")}</p>}
              {!hasAvatar && <p className="text-[11px] text-muted-foreground">{t("A photo is required to continue.")}</p>}
            </div>
          )}

          {/* STEP 1 — name */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-xl font-black tracking-tight">{t("Your full name")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("Use your full name, not a nickname, so your team can find you.")}</p>
              </div>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={me.name || t("Full name…")} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base font-semibold outline-none focus:border-ring" />
              {!nameValid && name.length > 0 && <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{t("Enter your full name (at least 2 words).")}</p>}
              {saveName.isError && <p className="text-xs font-semibold text-destructive">{t("Couldn't save your name.")}</p>}
            </div>
          )}

          {/* STEP 2.. — tutorial slides */}
          {slide && (
            <div className="space-y-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-primary">{t("Tutorial · {n}/{total}", { n: step - 1, total: SLIDES.length })}</div>
              <h2 className="text-xl font-black tracking-tight">{t(slide.title)}</h2>
              <SlideShots slide={slide} />
              <ul className="space-y-1.5">
                {slide.points.map((p, i) => <li key={i} className="flex gap-2 text-sm text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t(p)}</li>)}
              </ul>
            </div>
          )}

          {/* DONE */}
          {isDone && (
            <div className="space-y-4 py-6 text-center">
              <PartyPopper className="mx-auto h-12 w-12 text-primary" />
              <h2 className="text-2xl font-black tracking-tight">{t("You're all set")}</h2>
              <p className="text-sm text-muted-foreground">{t("Your profile is done and you know your way around NEXUS.")}</p>
            </div>
          )}
        </div>

        {/* footer nav */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <button onClick={back} disabled={step === 0} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent disabled:opacity-0"><ArrowLeft className="h-4 w-4" /> {t("Back")}</button>
          <div className="flex items-center gap-2">
            {isSlide && <button onClick={() => setStep(TOTAL)} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent">{t("Skip tutorial")}</button>}
            {step === 0 && <button onClick={next} disabled={!hasAvatar} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{t("Next")} <ArrowRight className="h-4 w-4" /></button>}
            {step === 1 && <button onClick={() => saveName.mutate(name, { onSuccess: next })} disabled={!nameValid || saveName.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{saveName.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} {t("Save & continue")}</button>}
            {isSlide && <button onClick={next} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">{step === TOTAL - 1 ? t("Done") : t("Next")} <ArrowRight className="h-4 w-4" /></button>}
            {isDone && <button onClick={() => finish.mutate()} disabled={finish.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{finish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("Start using NEXUS")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
