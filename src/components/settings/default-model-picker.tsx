"use client";

import { Label } from "@/components/ui/label";
import {
  supportsModelCapability,
  useModelStore,
  supportsCapability,
  type ModelRef,
} from "@/stores/model-store";
import { useTranslations } from "next-intl";
import { Type, ImageIcon, VideoIcon } from "lucide-react";

interface PickerRowProps {
  label: string;
  icon: React.ReactNode;
  color: string;
  options: {
    providerId: string;
    providerName: string;
    modelId: string;
    modelName: string;
  }[];
  value: ModelRef | null;
  onChange: (ref: ModelRef | null) => void;
}

function PickerRow({
  label,
  icon,
  color,
  options,
  value,
  onChange,
}: PickerRowProps) {
  const currentValue = value ? `${value.providerId}:${value.modelId}` : "";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[--border-subtle] bg-[--surface]/50 px-3 py-2.5">
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${color}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <Label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[--text-muted]">
          {label}
        </Label>
        <select
          value={currentValue}
          onChange={(e) => {
            if (!e.target.value) {
              onChange(null);
              return;
            }
            const [providerId, ...rest] = e.target.value.split(":");
            const modelId = rest.join(":");
            onChange({ providerId, modelId });
          }}
          className="mt-0.5 block w-full rounded-lg border-0 bg-transparent py-0 text-sm font-medium text-[--text-primary] outline-none"
        >
          <option value="">--</option>
          {options.map((opt) => (
            <option
              key={`${opt.providerId}:${opt.modelId}`}
              value={`${opt.providerId}:${opt.modelId}`}
            >
              {opt.providerName} / {opt.modelName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function DefaultModelPicker() {
  const t = useTranslations("settings");
  const {
    providers,
    defaultTextModel,
    defaultImageModel,
    defaultVideoModel,
    setDefaultTextModel,
    setDefaultImageModel,
    setDefaultVideoModel,
  } = useModelStore();

  function getOptions(capability: string) {
    const result: {
      providerId: string;
      providerName: string;
      modelId: string;
      modelName: string;
    }[] = [];
    for (const p of providers) {
      if (!supportsCapability(p.protocol, capability as "text" | "image" | "video")) {
        continue;
      }
      if (
        !p.capabilities.includes(capability as "text" | "image" | "video")
      )
        continue;
      for (const m of p.models) {
        if (!m.checked) continue;
        if (
          !supportsModelCapability(
            p.protocol,
            m.id,
            capability as "text" | "image" | "video"
          )
        ) {
          continue;
        }
        result.push({
          providerId: p.id,
          providerName: p.name,
          modelId: m.id,
          modelName: m.name,
        });
      }
    }
    return result;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <PickerRow
        label={t("defaultTextModel")}
        icon={<Type className="h-4 w-4" />}
        color="bg-blue-500/10 text-blue-600"
        options={getOptions("text")}
        value={defaultTextModel}
        onChange={setDefaultTextModel}
      />
      <PickerRow
        label={t("defaultImageModel")}
        icon={<ImageIcon className="h-4 w-4" />}
        color="bg-emerald-500/10 text-emerald-600"
        options={getOptions("image")}
        value={defaultImageModel}
        onChange={setDefaultImageModel}
      />
      <PickerRow
        label={t("defaultVideoModel")}
        icon={<VideoIcon className="h-4 w-4" />}
        color="bg-purple-500/10 text-purple-600"
        options={getOptions("video")}
        value={defaultVideoModel}
        onChange={setDefaultVideoModel}
      />
    </div>
  );
}
