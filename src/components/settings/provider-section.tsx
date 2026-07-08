"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useModelStore, type Capability, type Protocol } from "@/stores/model-store";
import { ProviderCard } from "@/components/settings/provider-card";
import { ProviderForm } from "@/components/settings/provider-form";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface ProviderSectionProps {
  capability: Capability;
  label: string;
  icon: React.ReactNode;
  defaultProtocol: Protocol;
  defaultBaseUrl: string;
}

export function ProviderSection({
  capability,
  label,
  icon,
  defaultProtocol,
  defaultBaseUrl,
}: ProviderSectionProps) {
  const t = useTranslations("settings");
  const { providers, addProvider, removeProvider } = useModelStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sectionProviders = providers.filter((p) => p.capability === capability);
  const selectedProvider = sectionProviders.find((p) => p.id === selectedId) || null;

  function handleAdd() {
    const id = addProvider({
      name: "New Provider",
      protocol: defaultProtocol,
      capability,
      baseUrl: defaultBaseUrl,
      apiKey: "",
    });
    setSelectedId(id);
  }

  function handleDelete(id: string) {
    removeProvider(id);
    if (selectedId === id) {
      const remaining = sectionProviders.filter((p) => p.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  return (
    <div className="frame-panel rounded-lg p-5 space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
          {icon}
          {label}
        </h3>
        <Button size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5" />
          {t("addProvider")}
        </Button>
      </div>

      {sectionProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[--border-subtle] bg-[--surface]/50 py-10">
          <div className="h-6 w-6 text-[--text-muted]">{icon}</div>
          <p className="mt-2 text-sm text-[--text-muted]">{t("noProviders")}</p>
          <Button size="sm" className="mt-3" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("addProvider")}
          </Button>
        </div>
      ) : (
        <>
          {/* Provider cards */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sectionProviders.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>

          {/* Provider form */}
          {selectedProvider ? (
            <ProviderForm key={selectedProvider.id} provider={selectedProvider} />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-[--border-subtle] bg-[--surface]/50 py-8">
              <p className="text-sm text-[--text-muted]">{t("selectProvider")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
