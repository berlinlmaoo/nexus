"use client"

import { getCustomStatusToneClassName, type SupportedCustomFieldType } from "@/lib/custom-fields"
import { cn } from "@/lib/utils"

interface TaskCustomFieldChipProps {
  chip: {
    id: string
    fieldName: string
    fieldType: SupportedCustomFieldType
    label: string
  }
  className?: string
  showFieldName?: boolean
}

export function TaskCustomFieldChip({
  chip,
  className,
  showFieldName = false,
}: TaskCustomFieldChipProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
        chip.fieldType === "STATUS"
          ? getCustomStatusToneClassName(chip.label)
          : "border-transparent bg-muted/70 text-muted-foreground",
        className
      )}
      title={`${chip.fieldName}: ${chip.label}`}
    >
      {showFieldName && (
        <span className="truncate opacity-60">{chip.fieldName}</span>
      )}
      <span className="truncate">{chip.label}</span>
    </span>
  )
}
