"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2 } from "lucide-react";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface AiOptimizeButtonProps {
  /** Current text content to optimize */
  value: string;
  /** Called with the optimized text */
  onOptimized: (newValue: string) => void;
  /** Field name for context, e.g. "场景描述" */
  fieldLabel?: string;
  /** Project ID for API context */
  projectId: string;
  /** Optional reference images to send to vision AI for visual analysis */
  images?: string[];
}

const DEFAULT_INSTRUCTIONS: Record<string, string> = {
  sceneDescription: `作为电影摄影指导优化此场景描述。要求：
1. 补充具体的光源类型与方向（如"左侧45°暖色钨丝灯主光，右侧冷蓝色补光"）
2. 明确色彩基调与主色（如"低饱和青灰调，点缀暗红"）
3. 增加空间纵深层次：前景遮挡物、中景主体、远景环境
4. 补充环境氛围细节：天气、温度感、声音暗示（如"空气中弥漫着潮湿的泥土气息"）
5. 如有建筑/道具，标注材质和年代感`,

  startFrame: `作为分镜画师优化此首帧描述。要求：
1. 明确镜头景别（大特写/特写/中景/全景/大全景）和机位角度（平视/仰拍/俯拍/荷兰角）
2. 用三分法或黄金比例标注角色在画面中的精确位置（如"角色位于画面右侧三分之一处"）
3. 描述角色当前的精确肢体姿态和面部表情
4. 标注景深：焦点在哪里，前景/背景的虚化程度
5. 光线在角色身上的具体表现（如"侧逆光勾出头发轮廓金边"）`,

  endFrame: `作为分镜画师优化此尾帧描述。要求：
1. 与首帧形成清晰的动态对比——明确标注哪些元素发生了变化（位置、姿态、表情、光线）
2. 角色的新姿态必须是稳定的终态，不能处于运动中间
3. 如有镜头运动（推/拉/摇），描述镜头运动后的最终构图
4. 表情和肢体语言应体现该镜头动作的情感结果
5. 构图需能自然衔接到下一个镜头`,

  motionScript: `作为动作导演优化此动作脚本。要求：
1. 严格按"0-2秒：… 2-4秒：…"格式分段，每段最多3秒
2. 每段同时编织四个层次：角色肢体（精确到关节）、环境反应（物理效果）、镜头运动（景别+速度）、氛围/物理细节
3. 动作描写使用力学语言：加速度、冲击力、惯性、重力
4. 避免空洞修饰词（"优雅地"、"缓缓"），改用精确的速度和力度描述
5. 确保首段对应首帧状态，末段对应尾帧状态`,

  videoPrompt: `作为Seedance视频提示词专家优化此提示词。要求：
1. 40-70字纯散文，不要任何标签（Scene:/Action:/Camera:）
2. 开头格式："角色名（2-4字视觉标识）"
3. 描述精确的物理运动：方向、速度、距离，不要抽象描述
4. 镜头运动自然嵌入句尾，不要单独一行
5. 最多一个氛围细节，且必须是动态的（飘动的、闪烁的、流淌的）
6. 如有对白，保持原文语言独立一行：【对白口型】角色名（标识）: "台词"`,
};

export function AiOptimizeButton({
  value,
  onOptimized,
  fieldLabel,
  projectId,
  images,
}: AiOptimizeButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const textGuard = useModelGuard("text");

  const defaultInstruction = fieldLabel
    ? DEFAULT_INSTRUCTIONS[fieldLabel] ?? "优化这段内容，使其更具体、更有画面感"
    : "优化这段内容，使其更具体、更有画面感";

  function handleOpen() {
    if (!value.trim()) {
      toast.error(t("shot.aiOptimizeEmpty"));
      return;
    }
    setInstruction(defaultInstruction);
    setOpen(true);
  }

  async function handleOptimize() {
    if (!textGuard()) return;
    setOptimizing(true);
    try {
      const resp = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_optimize_text",
          payload: {
            originalText: value,
            instruction,
            images: images && images.length > 0 ? images : undefined,
          },
          modelConfig: getModelConfig(),
        }),
      });
      const data = await resp.json();
      if (data.optimizedText) {
        onOptimized(data.optimizedText);
        setOpen(false);
        toast.success(t("shot.aiOptimizeSuccess"));
      } else {
        toast.error(t("common.generationFailed"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        title={t("shot.aiOptimize")}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-[--text-muted] transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <Sparkles className="h-3 w-3" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>{t("shot.aiOptimize")}</DialogTitle>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-[--text-secondary]">
                {t("shot.aiOptimizeInstruction")}
              </p>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                className="text-sm"
                placeholder={defaultInstruction}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-[--text-muted]">
                {t("shot.aiOptimizeOriginal")}
              </p>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-[--surface] px-3 py-2 text-xs text-[--text-secondary]">
                {value.slice(0, 300)}{value.length > 300 ? "…" : ""}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={handleOptimize} disabled={optimizing || !instruction.trim()}>
                {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {optimizing ? t("common.generating") : t("shot.aiOptimizeConfirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
