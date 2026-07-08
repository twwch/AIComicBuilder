import { registerHandlers } from "@/lib/task-queue";
import { handleScriptOutline } from "./script-outline";
import { handleScriptParse } from "./script-parse";
import { handleCharacterExtract } from "./character-extract";
import { handleCharacterImage } from "./character-image";
import { handleShotSplit } from "./shot-split";
import { handleFrameGenerate } from "./frame-generate";
import { handleVideoGenerate } from "./video-generate";
import { handleVideoAssemble } from "./video-assemble";
import { handleScriptVisualEnrichment } from "./script-visual-enrichment";
import { handleScriptIntake } from "./script-intake";

export function registerPipelineHandlers() {
  registerHandlers({
    script_outline: handleScriptOutline,
    script_parse: handleScriptParse,
    character_extract: handleCharacterExtract,
    character_image: handleCharacterImage,
    shot_split: handleShotSplit,
    frame_generate: handleFrameGenerate,
    video_generate: handleVideoGenerate,
    video_assemble: handleVideoAssemble,
    script_visual_enrichment: handleScriptVisualEnrichment,
    script_intake: handleScriptIntake,
  });
}
