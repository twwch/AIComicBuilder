import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, shots } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { dispatchAction } from "@/lib/pipeline/handlers";

export const maxDuration = 120;

interface ChatContext {
  shotId: string;
  message: string;
  episodeId?: string;
}

const INTENT_MAP: Record<string, { action: string; needsPayload: boolean }> = {
  "generate frame": { action: "single_frame_generate", needsPayload: false },
  "generate keyframe": { action: "single_frame_generate", needsPayload: false },
  "make frame": { action: "single_frame_generate", needsPayload: false },
  "generate video": { action: "single_video_generate", needsPayload: false },
  "make video": { action: "single_video_generate", needsPayload: false },
  "generate reference video": { action: "single_reference_video", needsPayload: false },
  "generate ref image": { action: "single_ref_image_generate", needsPayload: false },
  "generate reference image": { action: "single_ref_image_generate", needsPayload: false },
  "generate scene frame": { action: "single_scene_frame", needsPayload: false },
  "rewrite": { action: "single_shot_rewrite", needsPayload: true },
  "rewrite shot": { action: "single_shot_rewrite", needsPayload: true },
  "optimize": { action: "ai_optimize_text", needsPayload: true },
};

// Pre-sorted: longest key first
const INTENT_MAP_SORTED = Object.entries(INTENT_MAP).sort((a, b) => b[0].length - a[0].length);

// Directional camera movements: parse "pan left" → "pan-left", "zoom in" → "zoom-in"
function parseCameraDirection(message: string): string | null {
  const lower = message.toLowerCase();

  // "pan left/right", "tilt up/down", "zoom in/out", "dolly in/out", etc.
  const dirRegex = /\b(pan|tilt|zoom|dolly|track|truck|roll|orbit)\s+(left|right|up|down|in|out|ccw|cw)\b/;
  const m = lower.match(dirRegex);
  if (m) {
    const move = m[1];
    const dir = m[2];
    const map: Record<string, string> = {
      "pan left": "pan-left", "pan right": "pan-right",
      "tilt up": "tilt-up", "tilt down": "tilt-down",
      "zoom in": "zoom-in", "zoom out": "zoom-out",
      "dolly in": "dolly-in", "dolly out": "dolly-out",
      "dolly left": "dolly-left", "dolly right": "dolly-right",
      "track left": "pan-left", "track right": "pan-right",
      "roll ccw": "roll-ccw", "roll cw": "roll-cw",
      "orbit ccw": "orbit-ccw", "orbit cw": "orbit-cw",
    };
    return map[`${move} ${dir}`] ?? null;
  }

  // Simple keywords
  if (lower.includes("wider") || lower.includes("wide")) return "wide shot";
  if (lower.includes("close up") || lower.includes("close-up")) return "close-up";
  if (lower.includes("camera motion")) return "add camera motion";
  if (lower.includes("static")) return "static";

  return null;
}

function matchIntent(message: string): { action: string; params: Record<string, unknown> } {
  const lower = message.toLowerCase().trim();

  // Parse camera direction (always valid, even with "generate" prefix)
  const cameraDir = parseCameraDirection(message);
  if (cameraDir) {
    return {
      action: "single_shot_rewrite",
      params: { cameraDirection: cameraDir, instruction: message },
    };
  }

  // Check mood/dramatic keywords
  if (lower.includes("dramatic") || lower.includes("mood") || lower.includes("atmosphere")) {
    return {
      action: "ai_optimize_text",
      params: { instruction: message, target: "prompt" },
    };
  }

  // Check intent map (longest match first — pre-sorted)
  for (const [key, intent] of INTENT_MAP_SORTED) {
    if (lower.includes(key)) {
      return { action: intent.action, params: intent.needsPayload ? { instruction: message } : {} };
    }
  }

  // Default: rewrite
  return { action: "single_shot_rewrite", params: { instruction: message } };
}

function buildReply(action: string, shotSequence: number): string {
  const replies: Record<string, string> = {
    single_frame_generate: `Triggered frame generation for Shot ${shotSequence}. This may take a moment.`,
    single_video_generate: `Starting video generation for Shot ${shotSequence}.`,
    single_reference_video: `Starting reference video generation for Shot ${shotSequence}.`,
    single_ref_image_generate: `Generating reference image for Shot ${shotSequence}.`,
    single_scene_frame: `Generating scene frame for Shot ${shotSequence}.`,
    single_shot_rewrite: `Rewriting Shot ${shotSequence} based on your instruction.`,
    ai_optimize_text: `Optimizing text for Shot ${shotSequence}.`,
  };
  return replies[action] || `Processing your request for Shot ${shotSequence}.`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [ownerCheck] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!ownerCheck) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body: ChatContext = await request.json();
  const { shotId, message, episodeId } = body;

  if (!shotId || !message) {
    return NextResponse.json({ error: "shotId and message required" }, { status: 400 });
  }

  const [shot] = await db
    .select({ sequence: shots.sequence, status: shots.status })
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));

  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const intent = matchIntent(message);

  try {
    const handlerPromise = dispatchAction(
      intent.action,
      projectId,
      userId,
      { shotId, ...intent.params },
      undefined,
      episodeId
    );

    if (!handlerPromise) {
      return NextResponse.json({
        reply: `Sorry, the action "${intent.action}" is not available right now.`,
      });
    }

    const response = await handlerPromise;
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        reply: `Error: ${data.error || "Unknown error"}`,
      });
    }

    return NextResponse.json({
      reply: buildReply(intent.action, shot.sequence),
      refetch: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ reply: `Error: ${msg}` }, { status: 500 });
  }
}
