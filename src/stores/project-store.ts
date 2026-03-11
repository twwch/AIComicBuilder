import { create } from "zustand";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
}

interface Project {
  id: string;
  title: string;
  script: string;
  status: string;
  finalVideoUrl: string | null;
  characters: Character[];
  shots: Shot[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  fetchProject: (id: string) => Promise<void>;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: null,
  loading: false,

  fetchProject: async (id: string) => {
    set({ loading: true });
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json();
    set({ project: data, loading: false });
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project });
  },
}));
