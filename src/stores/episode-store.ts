import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";

export interface Episode {
  id: string;
  projectId: string;
  title: string;
  sequence: number;
  idea: string | null;
  script: string | null;
  description: string | null;
  keywords: string | null;
  status: string;
  generationMode: "keyframe" | "reference" | "4grid";
  finalVideoUrl: string | null;
  previewImages?: string[];
  createdAt: string | number;
  updatedAt: string | number;
}

interface EpisodeStore {
  episodes: Episode[];
  loading: boolean;
  fetchEpisodes: (projectId: string) => Promise<void>;
  createEpisode: (projectId: string, data: { title: string; description?: string; keywords?: string }) => Promise<Episode>;
  deleteEpisode: (projectId: string, episodeId: string) => Promise<void>;
  updateEpisode: (
    projectId: string,
    episodeId: string,
    patch: Partial<Pick<Episode, "title" | "idea" | "script" | "status" | "generationMode">>
  ) => Promise<void>;
  reorderEpisodes: (projectId: string, orderedIds: string[]) => Promise<void>;
}

export const useEpisodeStore = create<EpisodeStore>((set) => ({
  episodes: [],
  loading: false,

  fetchEpisodes: async (projectId: string) => {
    set({ loading: true });
    const res = await apiFetch(`/api/projects/${projectId}/episodes`);
    const data = await res.json();
    set({ episodes: data, loading: false });
  },

  createEpisode: async (projectId, data) => {
    const res = await apiFetch(`/api/projects/${projectId}/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const created: Episode = await res.json();
    set((state) => ({ episodes: [...state.episodes, created] }));
    return created;
  },

  deleteEpisode: async (projectId: string, episodeId: string) => {
    await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
      method: "DELETE",
    });
    set((state) => ({
      episodes: state.episodes.filter((e) => e.id !== episodeId),
    }));
  },

  updateEpisode: async (projectId, episodeId, patch) => {
    const res = await apiFetch(
      `/api/projects/${projectId}/episodes/${episodeId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    const updated: Episode = await res.json();
    set((state) => ({
      episodes: state.episodes.map((e) =>
        e.id === episodeId ? { ...e, ...updated } : e
      ),
    }));
  },

  reorderEpisodes: async (projectId, orderedIds) => {
    await apiFetch(`/api/projects/${projectId}/episodes/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    // Update sequences in local state based on the new order
    set((state) => ({
      episodes: state.episodes
        .map((e) => {
          const idx = orderedIds.indexOf(e.id);
          return idx >= 0 ? { ...e, sequence: idx + 1 } : e;
        })
        .sort((a, b) => a.sequence - b.sequence),
    }));
  },
}));
