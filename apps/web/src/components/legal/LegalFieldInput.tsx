import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TemplateField } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

export type FieldValues = Record<string, unknown>;

/** "25000000" → "25.000.000" while typing; the value sent stays the digits. */
function groupDigits(v: string): string {
  const [int, dec] = v.replace(/[^\d,]/g, "").split(",");
  const grouped = (int ?? "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec !== undefined ? `${grouped},${dec.slice(0, 2)}` : grouped;
}
const ungroup = (v: string) => v.replace(/\./g, "").replace(",", ".");

/** One form field of a template, by its type. `errors` is keyed like the server's ("ROWS.0.CELL"). */
export function LegalFieldInput({ field, value, onChange, errors, path, hideName = false }: {
  field: TemplateField;
  value: unknown;
  onChange: (v: unknown) => void;
  errors: Record<string, string>;
  path: string;
  /** The request form: people outside Legal see the label only, not the placeholder's name. */
  hideName?: boolean;
}) {
  const { t } = useLang();
  const error = errors[path];
  const id = `legal-f-${path.replace(/\W/g, "-")}`;
  const label = (
    <Label htmlFor={id} className="flex items-baseline gap-1">
      {field.label}
      {field.required && field.type !== "boolean" && <span className="text-destructive">*</span>}
      {!hideName && <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{field.name}</span>}
    </Label>
  );
  const hint = (field.help || error) && (
    <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ? t(error) : t(field.help!)}</p>
  );
  const str = value == null ? "" : String(value);

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Switch id={id} checked={value === true} onCheckedChange={(v) => onChange(v)} /> {field.label}
      </label>
    );
  }
  if (field.type === "list") {
    const rows = Array.isArray(value) ? (value as FieldValues[]) : [];
    const cols = field.columns ?? [];
    return (
      <div className="space-y-2">
        {label}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border border-border p-2.5">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("Row {n}", { n: i + 1 })}</span>
                <button type="button" className="rounded p-1 hover:bg-accent hover:text-destructive" aria-label={t("Remove row")}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {cols.map((c) => (
                  <LegalFieldInput key={c.name} field={c} value={row[c.name]} errors={errors} path={`${path}.${i}.${c.name}`} hideName={hideName}
                    onChange={(v) => onChange(rows.map((r, j) => (j === i ? { ...r, [c.name]: v } : r)))} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onChange([...rows, {}])}>
          <Plus className="h-4 w-4" /> {t("Add row")}
        </Button>
        {hint}
      </div>
    );
  }

  let control;
  switch (field.type) {
    case "longtext":
      control = <Textarea id={id} rows={3} value={str} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
      break;
    case "date":
      control = <Input id={id} type="date" value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
      break;
    case "money":
      control = (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
          <Input id={id} inputMode="decimal" className="pl-9" value={groupDigits(str.replace(".", ","))} onChange={(e) => onChange(ungroup(groupDigits(e.target.value)))} aria-invalid={!!error} />
        </div>
      );
      break;
    case "number":
      control = <Input id={id} inputMode="decimal" value={str} onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ""))} aria-invalid={!!error} />;
      break;
    case "select":
      control = (
        <Select value={str || undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={id} aria-invalid={!!error}><SelectValue placeholder={t("Pick one")} /></SelectTrigger>
          <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
      break;
    default:
      control = <Input id={id} value={str} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
  }
  return (
    <div className="space-y-1.5">
      {label}
      {control}
      {hint}
    </div>
  );
}
