"use client";

import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

interface CanvasStore {
  selectedShotId: string | null;
  chatMessagesByShotId: Record<string, ChatMessage[]>;
  chatOpen: boolean;
  chatLoading: boolean;

  selectShot: (id: string | null) => void;
  setChatOpen: (open: boolean) => void;
  addChatMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
  setChatLoading: (loading: boolean) => void;
  clearChat: () => void;
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  selectedShotId: null,
  chatMessagesByShotId: {},
  chatOpen: false,
  chatLoading: false,

  selectShot: (id) => set({ selectedShotId: id, chatLoading: false }),
  setChatOpen: (open) => set({ chatOpen: open }),
  addChatMessage: (msg) =>
    set((s) => {
      const sid = s.selectedShotId;
      if (!sid) return s;
      const existing = s.chatMessagesByShotId[sid] ?? [];
      return {
        chatMessagesByShotId: {
          ...s.chatMessagesByShotId,
          [sid]: [...existing, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }],
        },
      };
    }),
  setChatLoading: (loading) => set({ chatLoading: loading }),
  clearChat: () =>
    set((s) => {
      const sid = s.selectedShotId;
      if (!sid) return s;
      const { [sid]: _, ...rest } = s.chatMessagesByShotId;
      return { chatMessagesByShotId: rest };
    }),
}));
