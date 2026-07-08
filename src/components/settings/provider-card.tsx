"use client";

import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { Provider } from "@/stores/model-store";

interface ProviderCardProps {
  provider: Provider;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function ProviderCard({
  provider,
  selected,
  onSelect,
  onDelete,
}: ProviderCardProps) {
  const checkedCount = provider.models.filter((m) => m.checked).length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" || e.key === " " ? onSelect() : undefined}
      className={`group relative flex flex-shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-200 ${
        selected
          ? "border-primary/50 bg-primary/10 shadow-sm shadow-primary/10"
          : "border-[--border-subtle] bg-[--surface]/60 hover:border-primary/40 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
          selected
            ? "bg-primary text-white"
            : "bg-primary/8 text-primary"
        }`}
      >
        {provider.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[--text-primary] max-w-[120px]">
          {provider.name}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[--text-muted]">
            {provider.protocol}
          </span>
          {checkedCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
              {checkedCount}
            </Badge>
          )}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="ml-1 flex h-5 w-5 items-center justify-center rounded text-[--text-muted] opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
