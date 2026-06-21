"use client";

import { Badge } from "@/components/ui/badge";
import { useModelStore } from "@/stores/model-store";
import { getVideoPromptFamilyHint, getVideoPromptFamilyLabel, inferVideoPromptFamily } from "@/lib/ai/video-model-strategy";

export function VideoModelStrategyBadge({
  showLabel = true,
  showHint = false,
}: {
  showLabel?: boolean;
  showHint?: boolean;
}) {
  const providers = useModelStore((s) => s.providers);
  const defaultVideoModel = useModelStore((s) => s.defaultVideoModel);

  const provider = defaultVideoModel
    ? providers.find((p) => p.id === defaultVideoModel.providerId && p.capability === "video")
    : null;
  const modelExists = provider?.models.some((m) => m.id === defaultVideoModel?.modelId && m.checked);

  const family = inferVideoPromptFamily(modelExists && provider && defaultVideoModel ? {
    video: {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      secretKey: provider.secretKey,
      modelId: defaultVideoModel.modelId,
    },
  } : undefined);

  const label = getVideoPromptFamilyLabel(family);
  const hint = getVideoPromptFamilyHint(family);

  return (
    <>
      {showLabel && (
        <Badge variant="outline" className="max-w-56 truncate" title={label}>
          视频模型: {label}
        </Badge>
      )}
      {showHint && (
        <p className="mt-1 text-[11px] text-[--text-muted]">
          {hint}
        </p>
      )}
    </>
  );
}
