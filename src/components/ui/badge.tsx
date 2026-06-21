"use client"

import * as React from "react"
import { Chip } from "@heroui/react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest transition-all focus:outline-none focus:ring-2 focus:ring-primary/20",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary-new text-on-secondary",
        tertiary: "border-transparent bg-tertiary-new text-on-tertiary",
        outline: "text-on-surface-variant/60 border-on-surface-variant/10",
        destructive: "border-transparent bg-red-500 text-white",
        success: "border-transparent bg-green-500 text-white",
        warning: "border-transparent bg-amber-500 text-white",
        ghost: "border-transparent bg-surface-container text-on-surface-variant/60",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function mapChipColor(variant: BadgeProps["variant"]) {
  if (variant === "destructive") return "danger" as const
  if (variant === "success") return "success" as const
  if (variant === "warning") return "warning" as const
  return "default" as const
}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <Chip
      variant={variant === "outline" || variant === "ghost" ? "secondary" : "primary"}
      color={mapChipColor(variant)}
      size="sm"
      className={cn(badgeVariants({ variant }), className)}
      {...(props as React.ComponentProps<typeof Chip>)}
    />
  )
}

export { Badge, badgeVariants }
