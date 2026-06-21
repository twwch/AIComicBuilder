import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { TEMPERATURE_GENERAL } from "@/lib/config/defaults";
import type { ModelConfig } from "@/lib/generate-utils";

export async function handleAiOptimizeText(
  _projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const originalText = payload?.originalText as string;
  const instruction = payload?.instruction as string;
  const images = (payload?.images as string[] | undefined) || [];

  if (!originalText || !instruction) {
    return NextResponse.json({ error: "Missing originalText or instruction" }, { status: 400 });
  }
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const systemPrompt = images.length > 0
    ? `你是一位专业的AI动画内容优化专家。用户会给你一段原始文本、当前生成的图片以及优化指令。请仔细观察图片中的不合理之处（如比例失调、角色错位、风格不一致、细节缺失等），结合优化指令重写原始文本。
规则：
- 只输出优化后的文本，不要添加任何解释、前言或标记
- 保持原文的语言（中文输入→中文输出）
- 保持原文的整体结构和用途
- 必须分析图片中存在的问题，并在优化后的文本中明确修复这些问题
- 例如：如果图片中儿童被画得跟成人一样大，优化文本要强调"儿童身高约110cm，明显矮于成人"
- 例如：如果角色服装与原文不符，优化文本要更明确地描述服装细节`
    : `你是一位专业的AI动画内容优化专家。用户会给你一段原始文本和优化指令，请根据指令优化原始文本。
规则：
- 只输出优化后的文本，不要添加任何解释、前言或标记
- 保持原文的语言（中文输入→中文输出）
- 保持原文的整体结构和用途
- 根据优化指令做针对性改进`;

  if (images.length > 0) {
    const ai = resolveAIProvider(modelConfig);
    const result = await ai.generateText(
      `原始文本：\n${originalText}\n\n优化指令：\n${instruction}\n\n请观察上方图片中的问题，结合指令输出优化后的文本：`,
      {
        systemPrompt,
        images,
        temperature: TEMPERATURE_GENERAL,
      }
    );
    return NextResponse.json({ optimizedText: result.trim() });
  }

  const model = createLanguageModel(modelConfig.text);
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: `原始文本：
${originalText}

优化指令：
${instruction}

请输出优化后的文本：`,
  });

  return NextResponse.json({ optimizedText: text.trim() });
}
