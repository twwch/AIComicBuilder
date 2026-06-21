"use client";

import { Badge } from "@/components/ui/badge";
import { extractVisualStyleReference, extractVisualStyleValue } from "@/lib/style-presets";

export function VisualStyleBadge({
  idea,
  script,
}: {
  idea?: string | null;
  script?: string | null;
}) {
  const currentVisualStyle = extractVisualStyleReference(idea) || extractVisualStyleValue(script);

  if (!currentVisualStyle) return null;

  return (
    <Badge variant="outline" className="max-w-80 truncate" title={currentVisualStyle}>
      风格: {currentVisualStyle}
    </Badge>
  );
}
