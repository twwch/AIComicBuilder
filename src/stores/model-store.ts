import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ulid } from "ulid";

export type Protocol = "openai" | "gemini" | "seedance";
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
  capabilities: Capability[];
  baseUrl: string;
  apiKey: string;
  models: Model[];
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ModelConfig {
  text: { protocol: Protocol; baseUrl: string; apiKey: string; modelId: string } | null;
  image: { protocol: Protocol; baseUrl: string; apiKey: string; modelId: string } | null;
  video: { protocol: Protocol; baseUrl: string; apiKey: string; modelId: string } | null;
}

const PROTOCOL_CAPABILITIES: Record<Protocol, Capability[]> = {
  openai: ["text", "image"],
  gemini: ["text", "image"],
  seedance: ["image", "video"],
};

type PersistedModelState = Pick<
  ModelStore,
  "providers" | "defaultTextModel" | "defaultImageModel" | "defaultVideoModel"
>;

export function supportsCapability(
  protocol: Protocol,
  capability: Capability
): boolean {
  return PROTOCOL_CAPABILITIES[protocol].includes(capability);
}

export function supportsModelCapability(
  protocol: Protocol,
  modelId: string,
  capability: Capability
): boolean {
  if (!supportsCapability(protocol, capability)) {
    return false;
  }

  if (protocol !== "seedance") {
    return true;
  }

  const normalized = modelId.toLowerCase();
  if (normalized.includes("seedream")) {
    return capability === "image";
  }
  if (normalized.includes("seedance")) {
    return capability === "video";
  }

  return true;
}

function sanitizeCapabilities(
  protocol: Protocol,
  capabilities: Capability[]
): Capability[] {
  const allowed = PROTOCOL_CAPABILITIES[protocol];
  const filtered = Array.from(new Set(capabilities)).filter((cap) =>
    allowed.includes(cap)
  );

  return filtered.length > 0 ? filtered : [...allowed];
}

function sanitizeProvider(provider: Provider): Provider {
  return {
    ...provider,
    capabilities: sanitizeCapabilities(provider.protocol, provider.capabilities),
  };
}

function sanitizeDefaultRef(
  providers: Provider[],
  ref: ModelRef | null,
  capability: Capability
): ModelRef | null {
  if (!ref) return null;

  const provider = providers.find((item) => item.id === ref.providerId);
  if (!provider) return null;
  if (!supportsCapability(provider.protocol, capability)) return null;
  if (!provider.capabilities.includes(capability)) return null;
  if (
    !provider.models.some(
      (model) =>
        model.id === ref.modelId &&
        model.checked &&
        supportsModelCapability(provider.protocol, model.id, capability)
    )
  ) {
    return null;
  }

  return ref;
}

function sanitizeModelState(state: PersistedModelState): PersistedModelState {
  const providers = state.providers.map((provider) => sanitizeProvider(provider));

  return {
    providers,
    defaultTextModel: sanitizeDefaultRef(
      providers,
      state.defaultTextModel,
      "text"
    ),
    defaultImageModel: sanitizeDefaultRef(
      providers,
      state.defaultImageModel,
      "image"
    ),
    defaultVideoModel: sanitizeDefaultRef(
      providers,
      state.defaultVideoModel,
      "video"
    ),
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
        const id = ulid();
        set((state) => ({
          ...sanitizeModelState({
            providers: [...state.providers, sanitizeProvider({ ...provider, id, models: [] })],
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          }),
        }));
        return id;
      },

      updateProvider: (id, updates) => {
        set((state) => {
          const providers = state.providers.map((provider) => {
            if (provider.id !== id) return sanitizeProvider(provider);

            const protocol = (updates.protocol || provider.protocol) as Protocol;
            const protocolChanged = updates.protocol && updates.protocol !== provider.protocol;

            return sanitizeProvider({
              ...provider,
              ...updates,
              protocol,
              capabilities: sanitizeCapabilities(
                protocol,
                updates.capabilities || provider.capabilities
              ),
              models: protocolChanged ? [] : provider.models,
            });
          });

          return sanitizeModelState({
            providers,
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          });
        });
      },

      removeProvider: (id) => {
        set((state) =>
          sanitizeModelState({
            providers: state.providers.filter((p) => p.id !== id),
            defaultTextModel:
              state.defaultTextModel?.providerId === id
                ? null
                : state.defaultTextModel,
            defaultImageModel:
              state.defaultImageModel?.providerId === id
                ? null
                : state.defaultImageModel,
            defaultVideoModel:
              state.defaultVideoModel?.providerId === id
                ? null
                : state.defaultVideoModel,
          })
        );
      },

      setModels: (providerId, models) => {
        set((state) =>
          sanitizeModelState({
            providers: state.providers.map((p) =>
              p.id === providerId ? { ...p, models } : p
            ),
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          })
        );
      },

      toggleModel: (providerId, modelId) => {
        set((state) =>
          sanitizeModelState({
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
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          })
        );
      },

      addManualModel: (providerId, modelId) => {
        set((state) =>
          sanitizeModelState({
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
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          })
        );
      },

      removeModel: (providerId, modelId) => {
        set((state) =>
          sanitizeModelState({
            providers: state.providers.map((p) =>
              p.id === providerId
                ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
                : p
            ),
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          })
        );
      },

      setDefaultTextModel: (ref) =>
        set((state) =>
          sanitizeModelState({
            providers: state.providers,
            defaultTextModel: ref,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: state.defaultVideoModel,
          })
        ),
      setDefaultImageModel: (ref) =>
        set((state) =>
          sanitizeModelState({
            providers: state.providers,
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: ref,
            defaultVideoModel: state.defaultVideoModel,
          })
        ),
      setDefaultVideoModel: (ref) =>
        set((state) =>
          sanitizeModelState({
            providers: state.providers,
            defaultTextModel: state.defaultTextModel,
            defaultImageModel: state.defaultImageModel,
            defaultVideoModel: ref,
          })
        ),

      getModelConfig: () => {
        const state = get();
        function resolve(ref: ModelRef | null, capability: Capability) {
          if (!ref) return null;
          const provider = state.providers.find((p) => p.id === ref.providerId);
          if (!provider) return null;
          if (!supportsCapability(provider.protocol, capability)) return null;
          if (!provider.capabilities.includes(capability)) return null;
          if (
            !provider.models.some(
              (model) =>
                model.id === ref.modelId &&
                model.checked &&
                supportsModelCapability(provider.protocol, model.id, capability)
            )
          ) {
            return null;
          }
          return {
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
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
      version: 3,
      migrate: (persistedState) => {
        const state = persistedState as Partial<PersistedModelState> | undefined;
        return sanitizeModelState({
          providers: state?.providers || [],
          defaultTextModel: state?.defaultTextModel || null,
          defaultImageModel: state?.defaultImageModel || null,
          defaultVideoModel: state?.defaultVideoModel || null,
        }) as unknown as ModelStore;
      },
    }
  )
);
