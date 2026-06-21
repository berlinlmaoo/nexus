"use client"

import * as React from "react"
import { Switch as HeroSwitch } from "@heroui/react"

import { cn } from "@/lib/utils"

export interface SwitchProps
  extends Omit<
    React.ComponentProps<typeof HeroSwitch>,
    "checked" | "defaultChecked" | "disabled" | "onChange" | "isSelected" | "defaultSelected"
  > {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLLabelElement, SwitchProps>(
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
    <HeroSwitch
      ref={ref}
      isSelected={checked}
      defaultSelected={defaultChecked}
      isDisabled={isDisabled ?? disabled}
      onChange={(selected) => onCheckedChange?.(selected)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full text-sm text-on-surface",
        className
      )}
      {...props}
    >
      {children}
    </HeroSwitch>
  )
)
Switch.displayName = "Switch"

export { Switch }
