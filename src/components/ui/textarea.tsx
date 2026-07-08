import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-lg border border-[--border-subtle] bg-[--surface]/70 px-3.5 py-3 text-sm text-[--text-primary] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-200 outline-none placeholder:text-[--text-muted] hover:border-primary/45 focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
