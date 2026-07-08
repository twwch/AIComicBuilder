"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Lightweight Select with an API that mirrors shadcn's Radix-based   */
/* Select, but renders a native <select> element under the hood.      */
/* ------------------------------------------------------------------ */

interface SelectContextValue {
  value?: string
  onValueChange?: (value: string) => void
  items: Array<{ value: string; label: string }>
  registerItem: (value: string, label: string) => void
}

const SelectCtx = React.createContext<SelectContextValue>({
  items: [],
  registerItem: () => {},
})

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
}

function Select({ value, onValueChange, children }: SelectProps) {
  const [items, setItems] = React.useState<Array<{ value: string; label: string }>>([])

  const registerItem = React.useCallback((val: string, label: string) => {
    setItems((prev) => {
      // Update label if already present, otherwise append
      const idx = prev.findIndex((i) => i.value === val)
      if (idx >= 0) {
        if (prev[idx].label === label) return prev
        const next = [...prev]
        next[idx] = { value: val, label }
        return next
      }
      return [...prev, { value: val, label }]
    })
  }, [])

  // Reset items when children change (e.g. versions list changes)
  const childrenKey = React.Children.count(children)
  React.useEffect(() => {
    setItems([])
  }, [childrenKey])

  return (
    <SelectCtx.Provider value={{ value, onValueChange, items, registerItem }}>
      {children}
    </SelectCtx.Provider>
  )
}

/* ------------------------------------------------------------------ */

interface SelectTriggerProps {
  size?: "sm" | "default"
  className?: string
  children?: React.ReactNode
}

function SelectTrigger({ size = "default", className }: SelectTriggerProps) {
  const { value, onValueChange, items } = React.useContext(SelectCtx)

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onValueChange?.(e.target.value)}
      className={cn(
        "rounded-lg border border-[--border-subtle] bg-[--surface]/70 text-[--text-secondary] outline-none transition-colors cursor-pointer",
        "hover:bg-[--surface-hover] hover:text-[--text-primary] hover:border-primary/45",
        "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-8 px-2 text-[13px]" : "h-9 px-3 text-sm",
        className,
      )}
    >
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  )
}

/* ------------------------------------------------------------------ */

/** Placeholder — native <select> shows the selected value already. */
function SelectValue() {
  return null
}

/* ------------------------------------------------------------------ */

/** Wrapper that renders children (SelectItem components) which self-register. */
function SelectContent({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

/* ------------------------------------------------------------------ */

function SelectItem({ value, children }: { value: string; children?: React.ReactNode }) {
  const { registerItem } = React.useContext(SelectCtx)
  const label = typeof children === "string" ? children : String(children ?? value)

  React.useEffect(() => {
    registerItem(value, label)
  }, [value, label, registerItem])

  return null
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
