"use client";

import { useState, useRef, useEffect } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import { apiFetch } from "@/lib/api-fetch";
import { useParams } from "next/navigation";
import { Send, X, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AgentChatProps {
  shot: Shot | null;
}

const SUGGESTIONS = [
  "Make this shot wider",
  "Change camera angle to close-up",
  "Make the scene more dramatic",
  "Add camera motion",
  "Generate frames for this shot",
];

export function AgentChat({ shot }: AgentChatProps) {
  const params = useParams<{ id: string; episodeId: string }>();
  const chatMessages = useCanvasStore(
    useShallow((s) =>
      s.selectedShotId ? s.chatMessagesByShotId[s.selectedShotId] ?? [] : []
    )
  );
  const chatOpen = useCanvasStore((s) => s.chatOpen);
  const chatLoading = useCanvasStore((s) => s.chatLoading);
  const addChatMessage = useCanvasStore((s) => s.addChatMessage);
  const setChatLoading = useCanvasStore((s) => s.setChatLoading);
  const clearChat = useCanvasStore((s) => s.clearChat);
  const setChatOpen = useCanvasStore((s) => s.setChatOpen);

  const fetchProject = useProjectStore((s) => s.fetchProject);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const shotIdRef = useRef(shot?.id ?? null);
  shotIdRef.current = shot?.id ?? null;

  function handleSend(message: string) {
    const currentShot = shot;
    if (!message.trim() || !currentShot || chatLoading) return;
    const msg = message.trim();
    addChatMessage({ role: "user", text: msg });
    setInput("");
    setChatLoading(true);

    const shotIdAtSend = currentShot.id;

    apiFetch(`/api/projects/${params.id}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shotId: currentShot.id,
        message: msg,
        episodeId: params.episodeId,
      }),
    })
      .then(async (res) => {
        if (shotIdAtSend !== shotIdRef.current) return;
        const data = await res.json();
        addChatMessage({ role: "agent", text: data.reply });
        if (data.refetch) {
          fetchProject(params.id, params.episodeId);
        }
      })
      .catch((err) => {
        if (shotIdAtSend !== shotIdRef.current) return;
        toast.error("Agent error: " + (err.message || "Unknown"));
        addChatMessage({
          role: "agent",
          text: "Sorry, I encountered an error. Please try again.",
        });
      })
      .finally(() => {
        if (shotIdAtSend === shotIdRef.current) {
          setChatLoading(false);
        }
      });
  }

  if (!chatOpen) return null;

  return (
    <div className="flex h-full flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-blue-500" />
          <span className="text-sm font-semibold text-gray-800">Agent</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="rounded p-1 text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
          <button
            onClick={() => setChatOpen(false)}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {chatMessages.length === 0 && (
          <div className="space-y-3">
            <p className="text-center text-xs text-gray-400">
              Tell me what to do with{" "}
              <span className="font-medium text-gray-600">
                Shot {shot?.sequence}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chatMessages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {chatLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-500">
              <Loader2 className="size-3.5 animate-spin" />
              Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            placeholder="Ask the agent..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
          <button
            onClick={() => handleSend(input)}
            disabled={!input.trim() || chatLoading}
            className="rounded-lg p-1 text-blue-500 transition-colors hover:bg-blue-50 disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
