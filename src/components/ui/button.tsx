"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-all duration-200 outline-none select-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-lg bg-gradient-to-r from-[#2F6BFF] via-[#376DFF] to-[#5E7CFF] text-white shadow-[0_0_0_1px_rgba(91,140,255,0.35),0_14px_28px_rgba(47,107,255,0.28)] hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(32,214,255,0.45),0_16px_36px_rgba(47,107,255,0.36)] active:scale-[0.98]",
        outline:
          "rounded-lg border border-[--border-subtle] bg-[--elevated]/60 text-[--text-secondary] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-primary/60 hover:bg-primary/10 hover:text-[--text-primary]",
        secondary:
          "rounded-lg bg-secondary text-secondary-foreground hover:bg-[--surface-hover]",
        ghost:
          "rounded-lg text-[--text-secondary] hover:bg-[--surface-hover] hover:text-[--text-primary]",
        destructive:
          "rounded-lg bg-destructive/12 text-destructive hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-2 px-4 text-sm rounded-lg",
        xs: "h-7 gap-1 px-2.5 text-xs rounded-lg [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] rounded-lg",
        lg: "h-11 gap-2 px-6 text-base rounded-lg",
        icon: "size-9 rounded-lg",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
