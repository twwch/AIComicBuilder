"use client";

import { DefaultModelPicker } from "@/components/settings/default-model-picker";
import { ProviderSection } from "@/components/settings/provider-section";
import { AgentSection } from "@/components/settings/agent-section";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, Zap, Type, ImageIcon, VideoIcon, Wand2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import Link from "next/link";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings className="h-3.5 w-3.5" />
            </div>
            <span className="font-display text-sm font-semibold text-[--text-primary]">
              {t("title")}
            </span>
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="flex-1 bg-[--surface] p-4 lg:p-6">
        <div className="mx-auto max-w-4xl animate-page-in space-y-5">
          {/* Default model selection */}
          <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              <Zap className="h-3.5 w-3.5" />
              {t("defaultModels")}
            </h3>
            <DefaultModelPicker />
          </div>

          {/* Prompt Templates link */}
          <Link
            href="/settings/prompts"
            className="flex items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white p-5 transition-all duration-200 hover:border-[--border-hover] hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <div className="font-display text-sm font-semibold">{t("promptTemplates")}</div>
              <div className="text-xs text-[--text-muted]">{t("promptTemplatesDesc")}</div>
            </div>
          </Link>

          {/* Agent Management */}
          <AgentSection />

          {/* Language Models section */}
          <ProviderSection
            capability="text"
            label={t("languageModels")}
            icon={<Type className="h-3.5 w-3.5" />}
            defaultProtocol="openai"
            defaultBaseUrl="https://api.openai.com"
            templates={[
              {
                key: "text-sensenova",
                label: "SenseNova",
                name: "SenseNova Text",
                protocol: "openai",
                baseUrl: "https://token.sensenova.cn/v1",
                models: [
                  { id: "deepseek-v4-flash", name: "deepseek-v4-flash", checked: true },
                  { id: "sensenova-6.7-flash-lite", name: "sensenova-6.7-flash-lite", checked: true },
                ],
              },
              {
                key: "text-openai",
                label: "OpenAI",
                name: "OpenAI Text",
                protocol: "openai",
                baseUrl: "https://api.openai.com",
                models: [
                  { id: "gpt-4o", name: "gpt-4o", checked: true },
                  { id: "gpt-4.1", name: "gpt-4.1", checked: true },
                ],
              },
              {
                key: "text-gemini",
                label: "Gemini",
                name: "Gemini Text",
                protocol: "gemini",
                baseUrl: "https://generativelanguage.googleapis.com",
                models: [
                  { id: "gemini-2.5-flash", name: "gemini-2.5-flash", checked: true },
                  { id: "gemini-2.5-pro", name: "gemini-2.5-pro", checked: true },
                ],
              },
              {
                key: "text-nvidia",
                label: "NVIDIA",
                name: "NVIDIA Text",
                protocol: "nvidia",
                baseUrl: "https://integrate.api.nvidia.com/v1",
                models: [
                  { id: "moonshotai/kimi-k2.6", name: "moonshotai/kimi-k2.6", checked: true },
                ],
              },
            ]}
          />

          {/* Image Models section */}
          <ProviderSection
            capability="image"
            label={t("imageModels")}
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            defaultProtocol="dashscope"
            defaultBaseUrl="https://dashscope.aliyuncs.com/api/v1"
            templates={[
              {
                key: "image-sensenova",
                label: "SenseNova",
                name: "SenseNova Image",
                protocol: "sensenova",
                baseUrl: "https://token.sensenova.cn/v1",
                models: [
                  { id: "sensenova-u1-fast", name: "sensenova-u1-fast", checked: true },
                ],
              },
              {
                key: "image-openai",
                label: "OpenAI",
                name: "OpenAI Image",
                protocol: "openai",
                baseUrl: "https://api.openai.com",
                models: [
                  { id: "gpt-image-1", name: "gpt-image-1", checked: true },
                  { id: "dall-e-3", name: "dall-e-3", checked: true },
                ],
              },
              {
                key: "image-asxs",
                label: "ASXS",
                name: "ASXS Image",
                protocol: "asxs",
                baseUrl: "https://api.asxs.top/v1",
                models: [
                  { id: "gpt-image-2", name: "GPT Image 2", checked: true },
                ],
              },
              {
                key: "image-comfyui",
                label: "ComfyUI",
                name: "ComfyUI Image",
                protocol: "comfyui",
                baseUrl: "https://47jy7y6u49-8188.cnb.run",
                models: [
                  { id: "z-image-turbo-comfyui", name: "z-image-turbo-comfyui", checked: true },
                  { id: "qwen-edit-dual", name: "qwen-edit-dual", checked: true },
                ],
              },
              {
                key: "image-dashscope",
                label: "百炼图片",
                name: "DashScope Image",
                protocol: "dashscope",
                baseUrl: "https://dashscope.aliyuncs.com/api/v1",
                models: [
                  { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro (4K)", checked: true },
                  { id: "wan2.7-image", name: "Wan 2.7 Image", checked: true },
                  { id: "qwen-image-2.0-pro", name: "Qwen Image 2.0 Pro", checked: true },
                  { id: "qwen-image-2.0", name: "Qwen Image 2.0", checked: true },
                  { id: "qwen-image-max", name: "Qwen Image Max", checked: true },
                  { id: "qwen-image-plus", name: "Qwen Image Plus", checked: true },
                  { id: "z-image-turbo", name: "Z-Image Turbo", checked: true },
                ],
              },
              {
                key: "image-hidream",
                label: "HiDream (本地)",
                name: "HiDream Image",
                protocol: "hidream",
                baseUrl: "http://localhost:7860",
                models: [
                  { id: "HiDream-O1-Image-Dev", name: "HiDream-O1-Image-Dev", checked: true },
                ],
              },
            ]}
          />

          {/* Video Models section */}
          <ProviderSection
            capability="video"
            label={t("videoModels")}
            icon={<VideoIcon className="h-3.5 w-3.5" />}
            defaultProtocol="ucloud-seedance"
            defaultBaseUrl="https://api.modelverse.cn"
            templates={[
              {
                key: "video-ucloud-seedance",
                label: "Seedance UCloud",
                name: "Seedance Video (UCloud)",
                protocol: "ucloud-seedance",
                baseUrl: "https://api.modelverse.cn",
                models: [
                  { id: "doubao-seedance-1-5-pro-251215", name: "Seedance 1.5 Pro (UCloud)", checked: true },
                  { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0 (UCloud)", checked: true },
                ],
              },
              {
                key: "video-comfyui",
                label: "ComfyUI",
                name: "ComfyUI Video",
                protocol: "comfyui",
                baseUrl: "https://47jy7y6u49-8188.cnb.run",
                models: [
                  { id: "wan2.2-i2v-comfyui", name: "Wan 2.2 图生视频 (ComfyUI)", checked: true },
                  { id: "wan-firstlast", name: "Wan 首尾帧视频 (ComfyUI)", checked: true },
                  { id: "wan-i2v", name: "Wan 图生视频 (ComfyUI)", checked: true },
                  { id: "ltx-i2v", name: "LTX Video 2.3 图生视频", checked: false },
                  { id: "ltx-i2v-pro", name: "LTX Video 2.3 图生视频 Pro (3LoRA双采样)", checked: false },
                  { id: "ltx-t2v", name: "LTX Video 2.3 文生视频", checked: false },
                  { id: "ltx-flf2v", name: "LTX Video 2.3 首尾帧视频", checked: false },
                  { id: "ltx-4grid", name: "LTX Video 2.3 四宫格分镜 (4图+PromptRelay)", checked: false },
                ],
              },
              {
                key: "video-wan",
                label: "百炼视频",
                name: "Wan Video",
                protocol: "wan",
                baseUrl: "https://dashscope.aliyuncs.com/api/v1",
                models: [
                  { id: "wan2.7-t2v", name: "Wan 2.7 文生视频", checked: true },
                  { id: "wan2.7-r2v", name: "Wan 2.7 参考生视频", checked: true },
                  { id: "wan2.6-t2v", name: "Wan 2.6 文生视频", checked: true },
                  { id: "wan2.6-i2v-flash", name: "Wan 2.6 图生视频 Flash", checked: true },
                  { id: "wan2.6-i2v", name: "Wan 2.6 图生视频", checked: true },
                  { id: "wan2.6-r2v", name: "Wan 2.6 参考生视频", checked: true },
                  { id: "wan2.6-r2v-flash", name: "Wan 2.6 参考生视频 Flash", checked: true },
                ],
              },
              {
                key: "video-kling",
                label: "Kling",
                name: "Kling Video",
                protocol: "kling",
                baseUrl: "https://api.klingai.com",
                models: [
                  { id: "kling-v1", name: "kling-v1", checked: true },
                ],
              },
            ]}
          />
        </div>
      </main>
    </div>
  );
}
