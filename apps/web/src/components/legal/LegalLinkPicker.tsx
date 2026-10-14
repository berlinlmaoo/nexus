import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, FolderKanban, Link2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { legalLinksApi, type LegalLinkResults } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";

export type LegalLink = { kind: "project"; id: string; label: string } | { kind: "deal"; id: string; label: string } | null;

/** Pick a project or a Pipeline deal you can open — what a legal document belongs to. `search`: another source
 *  with the same answer (the request form asks /api/legal-requests/links: the requester's own access). */
export function LegalLinkPicker({ value, onChange, placeholder, size = "sm", search = legalLinksApi.search }: { value: LegalLink; onChange: (v: LegalLink) => void; placeholder?: string; size?: "sm" | "default"; search?: (q: string) => Promise<LegalLinkResults> }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(h); }, [q]);
  const res = useQuery({ queryKey: ["legal", "links", search === legalLinksApi.search ? "legal" : "own", debounced], queryFn: () => search(debounced), enabled: open });

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size={size} className="max-w-full gap-1.5">
            {value?.kind === "deal" ? <Briefcase className="h-4 w-4 shrink-0" /> : value?.kind === "project" ? <FolderKanban className="h-4 w-4 shrink-0" /> : <Link2 className="h-4 w-4 shrink-0" />}
            <span className="truncate">{value?.label ?? placeholder ?? t("Link to a project or deal")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t("Search projects and deals…")} />
            <CommandList>
              {res.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
              ) : (
                <>
                  <CommandEmpty>{t("Nothing found")}</CommandEmpty>
                  {(res.data?.deals.length ?? 0) > 0 && (
                    <CommandGroup heading={t("Pipeline deals")}>
                      {res.data!.deals.map((d) => (
                        <CommandItem key={d.id} value={`deal-${d.id}`} onSelect={() => { onChange({ kind: "deal", id: d.id, label: `${d.code} · ${d.name}` }); setOpen(false); }}>
                          <Briefcase className="mr-2 h-4 w-4" /> <span className="truncate">{d.code} · {d.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {(res.data?.projects.length ?? 0) > 0 && (
                    <CommandGroup heading={t("Projects")}>
                      {res.data!.projects.map((p) => (
                        <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => { onChange({ kind: "project", id: p.id, label: p.name }); setOpen(false); }}>
                          <FolderKanban className="mr-2 h-4 w-4" /> <span className="truncate">{p.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t("Remove link")} onClick={() => onChange(null)}><X className="h-4 w-4" /></Button>
      )}
    </div>
  );
}
