"use client"

import * as React from "react"
import { Button as HeroButton } from "@heroui/react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline: "border border-on-surface-variant/10 bg-background hover:bg-surface-container-high hover:text-on-surface",
        secondary: "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
        ghost: "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
        link: "text-primary underline-offset-4 hover:underline font-bold",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isDisabled?: boolean
}

function mapHeroVariant(variant: ButtonProps["variant"]) {
  if (variant === "outline") return "outline" as const
  if (variant === "destructive") return "danger" as const
  if (variant === "secondary") return "secondary" as const
  if (variant === "ghost" || variant === "link") return "ghost" as const
  return "primary" as const
}

function mapHeroSize(size: ButtonProps["size"]) {
  if (size === "sm") return "sm" as const
  if (size === "lg") return "lg" as const
  return "md" as const
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, disabled, isDisabled, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        />
      )
    }

    return (
      <HeroButton
        ref={ref}
        variant={mapHeroVariant(variant)}
        size={mapHeroSize(size)}
        isDisabled={isDisabled ?? disabled}
        isIconOnly={size === "icon"}
        className={cn(
          buttonVariants({ variant, size }),
          "rounded-md data-[hovered=true]:opacity-95",
          className
        )}
        {...(props as React.ComponentProps<typeof HeroButton>)}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
