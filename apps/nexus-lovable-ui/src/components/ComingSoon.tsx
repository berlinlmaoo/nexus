import { Rocket } from "lucide-react";
import { Reveal } from "@/components/motion";

/**
 * Full-page "Coming Soon" gate. Rendered in place of a feature whose access is
 * temporarily withheld for the viewer's role (e.g. Manager-and-below while a
 * feature has no release ETA). Lives inside the `_app` shell, so it only needs
 * to fill the content area. Dark-mode aware via semantic tokens; honors reduced
 * motion through <Reveal>.
 */
export function ComingSoon({ feature, note }: { feature: string; note?: string }) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <Reveal>
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary shadow-soft">
          <Rocket className="h-8 w-8" />
        </div>
        <span className="mb-3 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
          Coming Soon
        </span>
        <h1 className="text-2xl font-black text-foreground md:text-3xl">{feature} lagi disiapin</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          {note ??
            `Fitur ${feature} belum kebuka untuk role kamu. Masih dalam pengembangan dan bakal dibuka buat semua nanti — stay tuned! 🚀`}
        </p>
      </Reveal>
    </div>
  );
}
