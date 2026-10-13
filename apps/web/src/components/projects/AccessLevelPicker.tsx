import { SelectPicker } from "@/components/SelectPicker";
import { useLang } from "@/lib/lang";
import { toast } from "sonner";
import { ApiError, type ProjectAccessLevel } from "@/lib/nexus-api";
import { toastFailure } from "@/lib/failure";

/** The four Notion-style levels, strongest first, with what each allows (owner, 13 Oct 2026). */
export const ACCESS_LEVEL_OPTIONS: { value: ProjectAccessLevel; label: string; hint: string }[] = [
  { value: "FULL", label: "Full access", hint: "Edit, manage members and settings, delete the project" },
  { value: "EDIT", label: "Can edit", hint: "Create, edit and delete tasks, docs and comments" },
  { value: "COMMENT", label: "Can comment", hint: "Read and comment" },
  { value: "VIEW", label: "Can view", hint: "Read only" },
];

export function accessLevelLabel(level: ProjectAccessLevel, t: (s: string) => string) {
  return t(ACCESS_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? "Can edit");
}

/**
 * Notion's access dropdown: next to the Invite / Add button (the level for everyone being added in that
 * batch, default Can edit) and on each member row (change it, or Remove). `onRemove` adds the Remove item.
 */
export function AccessLevelPicker({ value, onChange, onRemove, removeName, disabled, ariaLabel, className }: {
  value: ProjectAccessLevel;
  /** The member's name for the Remove confirmation. */
  removeName?: string;
  onChange: (level: ProjectAccessLevel) => void;
  onRemove?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const { t } = useLang();
  const options = [
    ...ACCESS_LEVEL_OPTIONS.map((o) => ({ value: o.value, label: t(o.label), hint: t(o.hint) })),
    ...(onRemove ? [{ value: "__remove", label: t("Remove") }] : []),
  ];
  return (
    <SelectPicker
      variant="ghost"
      size="sm"
      align="end"
      value={value}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t("Access")}
      options={options}
      // Remove asks first (QA BoD R2 N01): it takes their access away at once.
      onChange={(v) => {
        if (v !== "__remove") { onChange(v as ProjectAccessLevel); return; }
        if (window.confirm(removeName ? t("Remove {name} from this project? They lose access right away.", { name: removeName }) : t("Remove them from this project? They lose access right away."))) onRemove?.();
      }}
      className={className ?? "h-8 shrink-0 px-2 text-xs font-medium text-muted-foreground"}
    />
  );
}

/** Toast for a failed level change / removal; 409 LAST_OWNER gets its own sentence. */
export function accessChangeFailed(e: unknown, t: (s: string) => string) {
  if (e instanceof ApiError && e.status === 409) toast.error(t("Couldn't change their access"), { description: t("A project keeps at least one Project Owner. Give someone else Full access first.") });
  else toastFailure(t("Couldn't change their access"), e);
}
