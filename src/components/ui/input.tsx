"use client"

import * as React from "react"
import { Input as HeroInput } from "@heroui/react"

import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  isDisabled?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size: _size, disabled, isDisabled, ...props }, ref) => {
    return (
      <HeroInput
        ref={ref}
        type={type}
        disabled={isDisabled ?? disabled}
        variant="primary"
        className={cn(
          "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...(props as React.ComponentProps<typeof HeroInput>)}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
