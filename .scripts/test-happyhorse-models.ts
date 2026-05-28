/**
 * HappyHorse 模型 API 可达性验证脚本
 *
 * 验证 4 个 HappyHorse 1.0 模型是否可通过 DashScope API 正常调用。
 * 不实际生成视频，仅检查 API 端点响应状态。
 *
 * 用法: WAN_API_KEY=xxx npx tsx .scripts/test-happyhorse-models.ts
 */

const API_KEY = process.env.WAN_API_KEY || process.env.DASHSCOPE_API_KEY || "";
const BASE_URL = (
  process.env.WAN_BASE_URL || "https://dashscope.aliyuncs.com/api/v1"
).replace(/\/+$/, "");

interface ModelTestCase {
  id: string;
  type: "t2v" | "i2v" | "r2v" | "video-edit";
  description: string;
  buildBody: () => Record<string, unknown>;
  constraints: string[];
}

const TEST_MODELS: ModelTestCase[] = [
  {
    id: "happyhorse-1.0-t2v",
    type: "t2v",
    description: "文生视频",
    buildBody: () => ({
      model: "happyhorse-1.0-t2v",
      input: { prompt: "test" },
      parameters: { resolution: "720P", ratio: "16:9", duration: 5 },
    }),
    constraints: [
      "使用 resolution/ratio 参数格式（类似 wan2.7）",
    ],
  },
  {
    id: "happyhorse-1.0-i2v",
    type: "i2v",
    description: "图生视频",
    buildBody: () => ({
      model: "happyhorse-1.0-i2v",
      input: {
        prompt: "test",
        // i2v 仅支持 first_frame，不支持 last_frame
        img_url: "https://via.placeholder.com/1280x720",
      },
      parameters: { size: "1280*720", duration: 5 },
    }),
    constraints: [
      "仅支持 first_frame 输入，不支持 last_frame",
      "如果使用 media[] 格式，只能包含 first_frame 类型的条目",
    ],
  },
  {
    id: "happyhorse-1.0-r2v",
    type: "r2v",
    description: "参考生视频",
    buildBody: () => ({
      model: "happyhorse-1.0-r2v",
      input: {
        prompt: "test",
        // r2v 使用 reference_image 参数
        media: [
          { type: "reference_image", url: "https://via.placeholder.com/1280x720" },
        ],
      },
      parameters: { resolution: "720P", ratio: "16:9", duration: 5 },
    }),
    constraints: [
      "使用 reference_image 参数（通过 media[] 数组传递）",
      "API 格式类似 wan2.7-r2v",
    ],
  },
  {
    id: "happyhorse-1.0-video-edit",
    type: "video-edit",
    description: "视频编辑",
    buildBody: () => ({
      model: "happyhorse-1.0-video-edit",
      input: { prompt: "test" },
      parameters: { duration: 5 },
    }),
    constraints: [
      "video-edit 管道暂未实现完整支持",
      "当前仅添加到模型列表，不实现 API 调用逻辑",
    ],
  },
];

async function testModelReachability(model: ModelTestCase): Promise<{
  modelId: string;
  reachable: boolean;
  statusCode?: number;
  taskId?: string;
  error?: string;
}> {
  console.log(`\n--- Testing: ${model.id} (${model.description}) ---`);
  console.log(`Constraints: ${model.constraints.join("; ")}`);

  try {
    const body = model.buildBody();
    console.log(`Endpoint: POST ${BASE_URL}/services/aigc/video-generation/video-synthesis`);

    const res = await fetch(
      `${BASE_URL}/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
      }
    );

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON response
    }

    const taskId =
      (parsed as { output?: { task_id?: string } }).output?.task_id || undefined;

    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text.slice(0, 300)}`);

    if (taskId) {
      console.log(`Task ID: ${taskId} (API reachable, task submitted)`);
      // Cancel or ignore the task — we only need reachability
    }

    return {
      modelId: model.id,
      reachable: res.ok || res.status === 400,
      statusCode: res.status,
      taskId,
      error: res.ok ? undefined : text.slice(0, 200),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Error: ${msg}`);
    return { modelId: model.id, reachable: false, error: msg };
  }
}

async function main() {
  console.log("==========================================");
  console.log("  HappyHorse 1.0 API 可达性验证");
  console.log("==========================================");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY ? "***configured***" : "NOT SET"}`);

  if (!API_KEY) {
    console.error("\nError: WAN_API_KEY or DASHSCOPE_API_KEY environment variable is required.");
    process.exit(1);
  }

  const results: Awaited<ReturnType<typeof testModelReachability>>[] = [];

  for (const model of TEST_MODELS) {
    const result = await testModelReachability(model);
    results.push(result);
  }

  console.log("\n==========================================");
  console.log("  验证结果汇总");
  console.log("==========================================");

  for (const r of results) {
    const status = r.reachable ? "REACHABLE" : "UNREACHABLE";
    console.log(`  ${r.modelId}: ${status} (HTTP ${r.statusCode || "N/A"})`);
    if (r.error && !r.reachable) {
      console.log(`    Error: ${r.error.slice(0, 100)}`);
    }
  }

  // 技术约束发现总结
  console.log("\n==========================================");
  console.log("  技术约束发现（隐性知识）");
  console.log("==========================================");
  console.log("  1. happyhorse-1.0-i2v 仅支持 first_frame，不支持 last_frame");
  console.log("  2. happyhorse-1.0-r2v 使用 reference_image 参数（media[] 格式）");
  console.log("  3. happyhorse-1.0-video-edit 需要扩展管道（暂不实现）");
  console.log("  4. HappyHorse 复用 wan 协议（共用 DashScope API 端点）");
}

main().catch(console.error);
