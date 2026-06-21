"use client"

import * as React from "react"
import { Checkbox as HeroCheckbox } from "@heroui/react"

import { cn } from "@/lib/utils"

type CheckedState = boolean | "indeterminate"

export interface CheckboxProps
  extends Omit<
    React.ComponentProps<typeof HeroCheckbox>,
    "checked" | "defaultChecked" | "disabled" | "onChange" | "isSelected" | "defaultSelected"
  > {
  checked?: CheckedState
  defaultChecked?: CheckedState
  disabled?: boolean
  onCheckedChange?: (checked: CheckedState) => void
}

const Checkbox = React.forwardRef<HTMLLabelElement, CheckboxProps>(
  (
    {
      className,
      checked,
      defaultChecked,
      disabled,
      isDisabled,
      onCheckedChange,
      children,
      ...props
    },
    ref
  ) => (
    <HeroCheckbox
      ref={ref}
      isSelected={checked === "indeterminate" ? true : checked}
      defaultSelected={defaultChecked === "indeterminate" ? true : defaultChecked}
      isIndeterminate={checked === "indeterminate"}
      isDisabled={isDisabled ?? disabled}
      onChange={(selected) => onCheckedChange?.(selected)}
      className={cn(
        "inline-flex min-h-5 min-w-5 items-center gap-2 rounded-md text-sm text-on-surface data-[selected=true]:text-on-surface",
        className
      )}
      {...props}
    >
      {children}
    </HeroCheckbox>
  )
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
