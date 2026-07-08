import { create } from "zustand";
import { persist } from "zustand/middleware";
import { id as genId } from "@/lib/id";

export type Protocol = "openai" | "gemini" | "seedance" | "ucloud-seedance" | "kling" | "wan" | "dashscope" | "jimapi-video";
export type Capability = "text" | "image" | "video";

export interface Model {
  id: string;
  name: string;
  checked: boolean;
}

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  capability: Capability;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  models: Model[];
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ModelConfig {
  text: { protocol: Protocol; baseUrl: string; apiKey: string; secretKey?: string; modelId: string } | null;
  image: { protocol: Protocol; baseUrl: string; apiKey: string; secretKey?: string; modelId: string } | null;
  video: { protocol: Protocol; baseUrl: string; apiKey: string; secretKey?: string; modelId: string } | null;
}

function normalizeModelId(modelId: string) {
  return modelId.trim();
}

function dedupeModels(models: Model[]) {
  const byId = new Map<string, Model>();
  for (const model of models) {
    const id = normalizeModelId(model.id);
    if (!id) continue;

    const existing = byId.get(id);
    byId.set(id, {
      id,
      name: model.name?.trim() || existing?.name || id,
      checked: Boolean(existing?.checked || model.checked),
    });
  }
  return Array.from(byId.values());
}

function normalizeProvider(provider: Provider) {
  return { ...provider, models: dedupeModels(provider.models ?? []) };
}

function hasCheckedModel(provider: Provider, modelId: string) {
  return provider.models.some((model) => model.id === modelId && model.checked);
}

function firstCheckedModelRef(providers: Provider[], capability: Capability): ModelRef | null {
  for (const provider of providers) {
    if (provider.capability !== capability) continue;
    const model = provider.models.find((item) => item.checked);
    if (model) return { providerId: provider.id, modelId: model.id };
  }
  return null;
}

function reconcileDefaultModel(
  providers: Provider[],
  capability: Capability,
  currentRef: ModelRef | null,
) {
  if (currentRef) {
    const provider = providers.find(
      (item) => item.id === currentRef.providerId && item.capability === capability,
    );
    if (provider && hasCheckedModel(provider, currentRef.modelId)) {
      return currentRef;
    }
  }
  return firstCheckedModelRef(providers, capability);
}

function reconcileDefaults(state: Pick<ModelStore, "providers" | "defaultTextModel" | "defaultImageModel" | "defaultVideoModel">) {
  return {
    defaultTextModel: reconcileDefaultModel(state.providers, "text", state.defaultTextModel),
    defaultImageModel: reconcileDefaultModel(state.providers, "image", state.defaultImageModel),
    defaultVideoModel: reconcileDefaultModel(state.providers, "video", state.defaultVideoModel),
  };
}

interface ModelStore {
  providers: Provider[];
  defaultTextModel: ModelRef | null;
  defaultImageModel: ModelRef | null;
  defaultVideoModel: ModelRef | null;

  addProvider: (provider: Omit<Provider, "id" | "models">) => string;
  updateProvider: (id: string, updates: Partial<Omit<Provider, "id">>) => void;
  removeProvider: (id: string) => void;
  setModels: (providerId: string, models: Model[]) => void;
  toggleModel: (providerId: string, modelId: string) => void;
  addManualModel: (providerId: string, modelId: string) => void;
  removeModel: (providerId: string, modelId: string) => void;
  setDefaultTextModel: (ref: ModelRef | null) => void;
  setDefaultImageModel: (ref: ModelRef | null) => void;
  setDefaultVideoModel: (ref: ModelRef | null) => void;
  getModelConfig: () => ModelConfig;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
      providers: [],
      defaultTextModel: null,
      defaultImageModel: null,
      defaultVideoModel: null,

      addProvider: (provider) => {
        const id = genId();
        set((state) => ({
          providers: [...state.providers, { ...provider, id, models: [] }],
        }));
        return id;
      },

      updateProvider: (id, updates) => {
        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === id ? normalizeProvider({ ...p, ...updates }) : p
          );
          return { providers, ...reconcileDefaults({ ...state, providers }) };
        });
      },

      removeProvider: (id) => {
        set((state) => {
          const providers = state.providers.filter((p) => p.id !== id);
          return { providers, ...reconcileDefaults({ ...state, providers }) };
        });
      },

      setModels: (providerId, models) => {
        set((state) => {
          const providers = state.providers.map((p) => {
            if (p.id !== providerId) return p;
            const previousChecked = new Set(
              p.models.filter((model) => model.checked).map((model) => model.id),
            );
            const nextModels = dedupeModels(models).map((model) => ({
              ...model,
              checked: model.checked || previousChecked.has(model.id),
            }));
            return { ...p, models: nextModels };
          });
          return { providers, ...reconcileDefaults({ ...state, providers }) };
        });
      },

      toggleModel: (providerId, modelId) => {
        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: dedupeModels(
                    p.models.map((m) =>
                      m.id === modelId ? { ...m, checked: !m.checked } : m
                    ),
                  ),
                }
              : p
          );
          return { providers, ...reconcileDefaults({ ...state, providers }) };
        });
      },

      addManualModel: (providerId, modelId) => {
        const id = normalizeModelId(modelId);
        if (!id) return;

        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: dedupeModels([
                    ...p.models,
                    { id, name: id, checked: true },
                  ]),
                }
              : p
          );
          return { providers, ...reconcileDefaults({ ...state, providers }) };
        });
      },

      removeModel: (providerId, modelId) => {
        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === providerId
              ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
              : p
          );
          return { providers, ...reconcileDefaults({ ...state, providers }) };
        });
      },

      setDefaultTextModel: (ref) => set({ defaultTextModel: ref }),
      setDefaultImageModel: (ref) => set({ defaultImageModel: ref }),
      setDefaultVideoModel: (ref) => set({ defaultVideoModel: ref }),

      getModelConfig: () => {
        const state = get();
        function resolve(ref: ModelRef | null) {
          if (!ref) return null;
          const provider = state.providers.find((p) => p.id === ref.providerId);
          if (!provider) return null;
          return {
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            secretKey: provider.secretKey,
            modelId: ref.modelId,
          };
        }
        const defaults = reconcileDefaults(state);
        return {
          text: resolve(defaults.defaultTextModel),
          image: resolve(defaults.defaultImageModel),
          video: resolve(defaults.defaultVideoModel),
        };
      },
    }),
    {
      name: "model-store",
      version: 2,
      migrate: (persistedState: unknown, fromVersion: number) => {
        // Called only when stored data has an explicit version number that differs from 2.
        // For data with no version field (legacy), the merge function below handles migration.
        if (fromVersion < 2) {
          const state = persistedState as Record<string, unknown>;
          const providers = (state.providers as Array<Record<string, unknown>>) ?? [];
          const migratedProviders = providers.map((p) => {
            const caps = (p.capabilities as string[]) ?? [];
            return normalizeProvider({ ...p, capability: caps[0] ?? "text" } as Provider);
          });
          const nextState = {
            ...state,
            providers: migratedProviders,
          };
          return { ...nextState, ...reconcileDefaults(nextState as ModelStore) };
        }
        return persistedState;
      },
      merge: (persistedState: unknown, currentState) => {
        // Handles legacy stored data that has no version field (Zustand skips migrate in that case).
        const ps = persistedState as Record<string, unknown>;
        const providers = (ps?.providers as Array<Record<string, unknown>>) ?? [];
        const migrated = providers.map((p) => {
          if (typeof p.capability === "string") return normalizeProvider(p as unknown as Provider); // already migrated
          const caps = (p.capabilities as string[]) ?? [];
          return normalizeProvider({ ...p, capability: caps[0] ?? "text" } as Provider);
        });
        const merged = { ...currentState, ...ps, providers: migrated as unknown as Provider[] };
        return { ...merged, ...reconcileDefaults(merged) };
      },
    }
  )
);
