import { create } from "zustand";
import { persist } from "zustand/middleware";
import { id as genId } from "@/lib/id";

export type Protocol = "openai" | "asxs" | "gemini" | "seedance" | "ucloud-seedance" | "kling" | "wan" | "dashscope" | "comfyui" | "sensenova" | "siliconflow" | "aivideo" | "nvidia" | "nvidia-nim" | "hidream" | "framepack" | "omnigen" | "agnes";
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
  templateKey?: string;
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

function migrateLegacySenseNovaProvider(input: Record<string, unknown>) {
  const protocol = input.protocol;
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.toLowerCase() : "";
  const models = Array.isArray(input.models) ? input.models : [];
  const hasSenseNovaU1 = models.some((m) => {
    if (!m || typeof m !== "object") return false;
    const id = (m as Record<string, unknown>).id;
    return typeof id === "string" && id.toLowerCase().includes("sensenova-u1-fast");
  });

  if (protocol === "openai" && baseUrl.includes("token.sensenova.cn") && hasSenseNovaU1) {
    return { ...input, protocol: "sensenova", capability: "image" };
  }

  return input;
}

interface ModelStore {
  providers: Provider[];
  defaultTextModel: ModelRef | null;
  defaultImageModel: ModelRef | null;
  defaultVideoModel: ModelRef | null;

  addProvider: (provider: Omit<Provider, "id" | "models">) => string;
  addProviderTemplate: (provider: Omit<Provider, "id" | "models"> & { models?: Model[] }) => string;
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

      addProviderTemplate: (provider) => {
        const id = genId();
        const models = provider.models ?? [];
        const firstCheckedModel = models.find((m) => m.checked) ?? models[0] ?? null;
        set((state) => ({
          providers: [
            ...state.providers,
            { ...provider, id, models },
          ],
          defaultTextModel:
            provider.capability === "text" && firstCheckedModel
              ? { providerId: id, modelId: firstCheckedModel.id }
              : state.defaultTextModel,
          defaultImageModel:
            provider.capability === "image" && firstCheckedModel
              ? { providerId: id, modelId: firstCheckedModel.id }
              : state.defaultImageModel,
          defaultVideoModel:
            provider.capability === "video" && firstCheckedModel
              ? { providerId: id, modelId: firstCheckedModel.id }
              : state.defaultVideoModel,
        }));
        return id;
      },

      updateProvider: (id, updates) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
      },

      removeProvider: (id) => {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
          defaultTextModel:
            state.defaultTextModel?.providerId === id ? null : state.defaultTextModel,
          defaultImageModel:
            state.defaultImageModel?.providerId === id ? null : state.defaultImageModel,
          defaultVideoModel:
            state.defaultVideoModel?.providerId === id ? null : state.defaultVideoModel,
        }));
      },

      setModels: (providerId, models) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId ? { ...p, models } : p
          ),
        }));
      },

      toggleModel: (providerId, modelId) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: p.models.map((m) =>
                    m.id === modelId ? { ...m, checked: !m.checked } : m
                  ),
                }
              : p
          ),
        }));
      },

      addManualModel: (providerId, modelId) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: [
                    ...p.models,
                    { id: modelId, name: modelId, checked: true },
                  ],
                }
              : p
          ),
        }));
      },

      removeModel: (providerId, modelId) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
              : p
          ),
        }));
      },

      setDefaultTextModel: (ref) => set({ defaultTextModel: ref }),
      setDefaultImageModel: (ref) => set({ defaultImageModel: ref }),
      setDefaultVideoModel: (ref) => set({ defaultVideoModel: ref }),

      getModelConfig: () => {
        const state = get();
        function resolve(ref: ModelRef | null, expectedCapability?: Capability) {
          if (!ref) return null;
          const provider = state.providers.find((p) => p.id === ref.providerId);
          if (!provider) return null;
          if (expectedCapability && provider.capability !== expectedCapability) return null;
          const modelExists = provider.models.some((m) => m.id === ref.modelId && m.checked);
          if (!modelExists) return null;
          return {
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            secretKey: provider.secretKey,
            modelId: ref.modelId,
          };
        }
        return {
          text: resolve(state.defaultTextModel, "text"),
          image: resolve(state.defaultImageModel, "image"),
          video: resolve(state.defaultVideoModel, "video"),
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
          return {
            ...state,
            providers: providers.map((p) => {
              const caps = (p.capabilities as string[]) ?? [];
              return migrateLegacySenseNovaProvider({ ...p, capability: caps[0] ?? "text" });
            }),
          };
        }
        return persistedState;
      },
      merge: (persistedState: unknown, currentState) => {
        // Handles legacy stored data that has no version field (Zustand skips migrate in that case).
        const ps = persistedState as Record<string, unknown>;
        const providers = (ps?.providers as Array<Record<string, unknown>>) ?? [];
        const migrated = providers.map((p) => {
          if (typeof p.capability === "string") {
            return migrateLegacySenseNovaProvider(p);
          }
          const caps = (p.capabilities as string[]) ?? [];
          return migrateLegacySenseNovaProvider({ ...p, capability: caps[0] ?? "text" });
        });
        return { ...currentState, ...ps, providers: migrated as unknown as Provider[] };
      },
    }
  )
);
