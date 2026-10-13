import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { docTypeLabel, statusLabel } from "@/components/legal/legal-labels";
import { LegalLinkPicker, type LegalLink } from "@/components/legal/LegalLinkPicker";
import { LEGAL_DOC_TYPES, LEGAL_STATUSES, legalTemplatesApi, legalUploadApi, type LegalStatus } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";

/** Put a document made elsewhere into the archive: a signed contract, an outside invoice, a scan. */
export function UploadDocumentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const companies = useQuery({ queryKey: ["legal", "companies"], queryFn: legalTemplatesApi.companies, enabled: open, staleTime: 60_000 });
  const empty = { companyId: "", docType: "", title: "", number: "", counterparty: "", docDate: "", status: "SIGNED" as LegalStatus };
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState(empty);
  const [link, setLink] = useState<LegalLink>(null);
  useEffect(() => { if (!open) { setFile(null); setF(empty); setLink(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = useMutation({
    mutationFn: () => legalUploadApi.upload({ file: file!, ...f, projectId: link?.kind === "project" ? link.id : null, dealId: link?.kind === "deal" ? link.id : null }),
    onSuccess: (res) => {
      toast.success(t("Added to the archive"));
      if (res.pdfError) toast.warning(t("The PDF couldn't be made yet: {reason}", { reason: res.pdfError }));
      void qc.invalidateQueries({ queryKey: ["legal", "documents"] });
      onOpenChange(false);
      onCreated(res.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={lang} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Upload document")}</DialogTitle>
          <DialogDescription>{t("A document made elsewhere — a signed contract, an outside invoice. It keeps its own number.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="legal-up-file">{t("File (PDF, Word or photo)")}</Label>
            <Input id="legal-up-file" type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title) setF((cur) => ({ ...cur, title: x.name.replace(/\.[^.]+$/, "") })); }} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Company")}</Label>
              <Select value={f.companyId || undefined} onValueChange={(v) => setF({ ...f, companyId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Pick a company")} /></SelectTrigger>
                <SelectContent>{(companies.data?.companies ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Document type")}</Label>
              <Select value={f.docType || undefined} onValueChange={(v) => setF({ ...f, docType: v })}>
                <SelectTrigger><SelectValue placeholder={t("Pick a type")} /></SelectTrigger>
                <SelectContent>{LEGAL_DOC_TYPES.map((d) => <SelectItem key={d} value={d}>{docTypeLabel(d)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal-up-title">{t("Title")}</Label>
            <Input id="legal-up-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="legal-up-number">{t("Number on the document")}</Label>
              <Input id="legal-up-number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="legal-up-cp">{t("Counterparty")}</Label>
              <Input id="legal-up-cp" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="legal-up-date">{t("Date")}</Label>
              <Input id="legal-up-date" type="date" value={f.docDate} onChange={(e) => setF({ ...f, docDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Status")}</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as LegalStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEGAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Belongs to")}</Label>
              <LegalLinkPicker value={link} onChange={setLink} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button disabled={!file || !f.companyId || !f.docType || !f.title.trim() || upload.isPending} onClick={() => upload.mutate()} className="gap-1.5">
            {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
