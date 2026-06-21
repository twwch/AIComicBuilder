"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  getFirstFrameUrl,
  getLastFrameUrl,
  type Shot,
} from "@/stores/project-store";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  ImageIcon,
  VideoIcon,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export type ShotNodeData = Record<string, unknown> & {
  shot: Shot;
  sequence: number;
};

function ShotNode({ data }: NodeProps) {
  const { shot, sequence } = data as unknown as ShotNodeData;
  const selectShot = useCanvasStore((s) => s.selectShot);
  const setChatOpen = useCanvasStore((s) => s.setChatOpen);
  const selectedShotId = useCanvasStore((s) => s.selectedShotId);
  const isSelected = selectedShotId === shot.id;

  const [imgErr1, setImgErr1] = useState(false);
  const [imgErr2, setImgErr2] = useState(false);

  const firstFrame = getFirstFrameUrl(shot);
  const lastFrame = getLastFrameUrl(shot);
  const hasVideo = !!(shot.assets?.some(
    (a) =>
      (a.type === "keyframe_video" || a.type === "reference_video") &&
      a.status === "completed"
  ));

  const statusIcon = () => {
    switch (shot.status) {
      case "completed":
        return <CheckCircle2 className="size-3.5 text-green-500" />;
      case "generating":
        return <Loader2 className="size-3.5 text-blue-500 animate-spin" />;
      case "failed":
        return <XCircle className="size-3.5 text-red-500" />;
      default:
        return null;
    }
  };

  function handleClick() {
    selectShot(shot.id);
    setChatOpen(true);
  }

  return (
    <div
      onClick={handleClick}
      className={`group cursor-pointer rounded-xl border-2 bg-white shadow-md transition-all hover:shadow-lg ${
        isSelected
          ? "border-blue-500 ring-2 ring-blue-200"
          : "border-transparent hover:border-gray-200"
      }`}
      style={{ width: 220 }}
    >
      <div className="flex h-24 gap-0.5 overflow-hidden rounded-t-xl bg-gray-100">
        {firstFrame && !imgErr1 ? (
          <img
            src={firstFrame}
            alt=""
            onError={() => setImgErr1(true)}
            className="h-full w-1/2 object-cover"
          />
        ) : (
          <div className="flex h-full w-1/2 items-center justify-center text-gray-300">
            <ImageIcon className="size-6" />
          </div>
        )}
        {lastFrame && !imgErr2 ? (
          <img
            src={lastFrame}
            alt=""
            onError={() => setImgErr2(true)}
            className="h-full w-1/2 object-cover"
          />
        ) : (
          <div className="flex h-full w-1/2 items-center justify-center text-gray-300">
            <ImageIcon className="size-6" />
          </div>
        )}
      </div>

      <div className="space-y-1 p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          {statusIcon()}
          <span>Shot {sequence}</span>
        </div>
        <p className="line-clamp-2 text-[11px] leading-snug text-gray-500">
          {shot.prompt || shot.videoScript || "No prompt"}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <span>{shot.duration || 0}s</span>
          {hasVideo && (
            <span className="flex items-center gap-0.5 text-purple-500">
              <VideoIcon className="size-3" /> Video
            </span>
          )}
        </div>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(ShotNode);
