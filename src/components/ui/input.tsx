import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-[--border-subtle] bg-[--surface]/70 px-3.5 py-2 text-sm text-[--text-primary] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-200 outline-none placeholder:text-[--text-muted] hover:border-primary/45 focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
