import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest transition-all focus:outline-none focus:ring-2 focus:ring-primary/20",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary-new text-on-secondary",
        tertiary:
          "border-transparent bg-tertiary-new text-on-tertiary",
        outline: "text-on-surface-variant/40 border-on-surface-variant/10",
        destructive:
          "border-transparent bg-red-500 text-white",
        success:
          "border-transparent bg-green-500 text-white",
        warning:
          "border-transparent bg-amber-500 text-white",
        ghost:
          "border-transparent bg-surface-container text-on-surface-variant/60",
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

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
