"use client";

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Shot } from "@/stores/project-store";
import ShotNode from "./shot-node";

const nodeTypes: NodeTypes = {
  shot: ShotNode,
};

const NODE_WIDTH = 260;

const TRANSITION_COLORS: Record<string, string> = {
  cut: "#94a3b8",
  dissolve: "#3b82f6",
  fade_in: "#f59e0b",
  fade_out: "#f59e0b",
  wipeleft: "#8b5cf6",
  slideright: "#8b5cf6",
  circleopen: "#10b981",
};

const TRANSITION_LABELS: Record<string, string> = {
  cut: "cut",
  dissolve: "diss",
  fade_in: "fade+",
  fade_out: "fade-",
  wipeleft: "wipe←",
  slideright: "wipe→",
  circleopen: "○",
};

interface CanvasStoryboardProps {
  shots: Shot[];
}

export function CanvasStoryboard({ shots }: CanvasStoryboardProps) {
  const initialNodes = useMemo<Node[]>(
    () =>
      shots.map((shot, i) => ({
        id: shot.id,
        type: "shot",
        position: { x: i * NODE_WIDTH, y: 0 },
        data: { shot, sequence: shot.sequence },
      })),
    [shots]
  );

  const initialEdges = useMemo<Edge[]>(
    () =>
      shots.slice(0, -1).map((shot, i) => {
        const next = shots[i + 1];
        const trans = next.transitionIn || shot.transitionOut || "cut";
        const color = TRANSITION_COLORS[trans] || "#94a3b8";
        return {
          id: `${shot.id}-${next.id}`,
          source: shot.id,
          target: next.id,
          type: "smoothstep",
          animated: true,
          style: { stroke: color, strokeWidth: 2 },
          label: TRANSITION_LABELS[trans] || trans,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600, fontFamily: "monospace" },
          labelBgStyle: { fill: "#ffffffcc", rx: 4 },
          labelBgPadding: [6, 3] as [number, number],
        };
      }),
    [shots]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(
      shots.map((shot, i) => ({
        id: shot.id,
        type: "shot",
        position: { x: i * NODE_WIDTH, y: 0 },
        data: { shot, sequence: shot.sequence },
      }))
    );
    setEdges(
      shots.slice(0, -1).map((shot, i) => {
        const next = shots[i + 1];
        const trans = next.transitionIn || shot.transitionOut || "cut";
        const color = TRANSITION_COLORS[trans] || "#94a3b8";
        return {
          id: `${shot.id}-${next.id}`,
          source: shot.id,
          target: next.id,
          type: "smoothstep",
          animated: true,
          style: { stroke: color, strokeWidth: 2 },
          label: TRANSITION_LABELS[trans] || trans,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600, fontFamily: "monospace" },
          labelBgStyle: { fill: "#ffffffcc", rx: 4 },
          labelBgPadding: [6, 3] as [number, number],
        };
      })
    );
  }, [shots, setNodes, setEdges]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        panOnDrag={[1, 2]}
        selectNodesOnDrag={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#e2e8f0"
        />
        <Controls showInteractive={false} className="rounded-lg border shadow-sm" />
        <MiniMap
          nodeStrokeColor="#6b7280"
          nodeColor={(n) => (n.selected ? "#3b82f6" : "#f1f5f9")}
          maskColor="rgba(0,0,0,0.08)"
          className="rounded-lg border shadow-sm"
        />
      </ReactFlow>
    </div>
  );
}
