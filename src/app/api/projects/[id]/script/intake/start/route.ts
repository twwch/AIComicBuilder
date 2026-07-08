import { NextResponse } from "next/server";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { registerPipelineHandlers } from "@/lib/pipeline";
import { startScriptIntakeJob } from "@/lib/script-intake/intake-job-runner";
import { startWorker } from "@/lib/task-queue";

export const maxDuration = 60;

function parseBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(0|false|no|off)$/i.test(value)) return false;
    if (/^(1|true|yes|on)$/i.test(value)) return true;
  }
  return fallback;
}

function parseJson<T>(value: FormDataEntryValue | null): T | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function ensureIntakeWorkerReady() {
  registerPipelineHandlers();
  startWorker();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  ensureIntakeWorkerReady();

  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const modelConfig = parseJson<{ text?: ProviderConfig | null }>(formData.get("modelConfig"));
      const allowAiOverwrite = parseBoolean(formData.get("allowAiOverwrite"), true);

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }

      const result = await startScriptIntakeJob({
        projectId,
        sourceFilename: file.name,
        sourceType: file.name.split(".").pop()?.toLowerCase() || "",
        sourceBuffer: Buffer.from(await file.arrayBuffer()),
        modelConfig,
        allowAiOverwrite,
      });
      return NextResponse.json(result, { status: 202 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      text?: unknown;
      sourceFilename?: unknown;
      sourceType?: unknown;
      modelConfig?: { text?: ProviderConfig | null } | null;
      allowAiOverwrite?: unknown;
    };
    const sourceText = String(body.text || "").trim();
    if (!sourceText) {
      return NextResponse.json({ error: "No script text provided" }, { status: 400 });
    }

    const result = await startScriptIntakeJob({
      projectId,
      sourceFilename: typeof body.sourceFilename === "string" ? body.sourceFilename : "pasted-script.txt",
      sourceType: typeof body.sourceType === "string" ? body.sourceType : "txt",
      sourceText,
      modelConfig: body.modelConfig ?? null,
      allowAiOverwrite: parseBoolean(body.allowAiOverwrite, true),
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start script intake";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
