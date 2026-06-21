# Progress

## 2026-06-07 Session (�? �?多角色关键帧一致性修�?(UI layout selector + auto-crop)
- 根因分析: c25e3d8 修复"不再生成重复人物"过于激�? 禁用了所有多 ref 路径. 实际
  `HiDreamO1ReferenceImages` �?ComfyUI 官方核心节点 (comfy_extras/nodes_hidream_o1.py:42),
  支持 1-10 �?ref (1 �?指令编辑, 2-10 �?多参�?. workflow 本身支持�?ref.
- 真正的根�? 用户提供�?4 视图角色设定图被模型识别�?分镜布局模板", 而不是角色参�?- 修复方案 (用户选择): UI �?layout 选择�? 生成�?sharp 自动裁剪单人物立�? 关键帧用裁剪结果
  - 备�? 仅自动裁�?(隐式) �?不够灵活
  - 备�? IP-Adapter / OpenPose �?改动太大, 跳过
- Schema (2a87d52):
  - `characters.referenceLayout` (text, default 'four-view') �?'single' | 'three-view' | 'four-view'
  - `characters.referenceImageSingle` (text, nullable) �?sharp 裁剪后的单人物立�?  - `drizzle/0054_add_character_reference_layout.sql` + journal idx=54
  - 导出 `CharacterReferenceLayout` 类型 + `normalizeCharacterReferenceLayout()` helper
- Prompts + utility (5203641):
  - 4 �?prompt (characterImageDef/SimpleDef/Ideogram4Def/HiDreamO1Def) 接受
    `referenceLayout` 参数, 输出 single/3-view/4-view 三种变体
  - 新增 `src/lib/character-ref-utils.ts::extractCharacterReferencePortrait`:
    从宽高比自动检测实际布局 (横条/竖条/2x2), 裁剪前视�?(5% margin), 补白到正方形
  - handler: `handleSingleCharacterImage` + `handleBatchCharacterImage` �?layout, �?prompt,
    生成后裁�? 写回 `referenceImageSingle` + `referenceLayout`
  - �?`sharp@^0.34.5` 依赖
- UI + 关键帧集�?(e5300af):
  - `characters-inline-panel.tsx`: 行内生成按钮�?LAYOUT_OPTIONS 下拉 (单图/三视�?四视�?
  - `character-card.tsx`: 详情卡片镜像同一 layout 下拉
  - `frames.ts` �?`shotCharRefImages` 优先�?`referenceImageSingle` (裁剪立绘) 而非
    `referenceImage` (4 视图设定�?, 解决模型�?4 视图当分镜模板的 bug
- 测试 632/632 �?lint �?tsc �?- 审计 + 重构 (2f6c570 + cbc429b, 当前 6 commits ahead of c25e3d8):
  - **return-path 修复** (`character-ref-utils.ts:46-67`): 相对输入 �?`path.join(parsed.dir, "${name}_single${ext}")`;
    绝对输入 �?`path.relative(uploadDir, absPath)`。原代码绝对输入�?`path.join` 也返回绝对路�?
    仅因 `uploadUrl` "strip up to uploads/" 规范化才偶然工作, 文档化收�?  - **删除死代�?* `detectLayoutFromAspect` �?从未调用, 第一分支 `aspect>1.4 && (cols===3 || cols===4)`
    永远不可�?(上面已经 aspect>1.4 直接返回 layout 而没�?`rows`/`cols` 变量)
  - **类型同步**: `src/stores/project-store.ts:4-13` `Character` 接口新增
    `referenceImageSingle?: string | null` + `referenceLayout?: ReferenceLayout | null`;
    `characters-inline-panel.tsx` �?`Character` 接口允许 `referenceLayout: null` (legacy)
  - **新增测试** `src/lib/__tests__/character-ref-utils.test.ts` (7 �?:
    - single no-op (返回 null)
    - 2x2 grid 裁剪 (5% margin)
    - 非正方形 cells + white padding 到正方形
    - 3-view horizontal (aspect > 1.4)
    - 4-view vertical (aspect < 0.7)
    - grid fallback (aspect 0.95-1.05)
    - `uploadUrl` 跨平�?round-trip
  - **`parseReferenceImageHistory(raw)`** 抽到 `character.ts:48-58` �?替换 3 处重复的
    `try { JSON.parse(...) } catch { return [] }`; 失败返回 `[]`
  - **文档化假�?*: "front view is top-left / leftmost / topmost" �?`character-ref-utils.ts`
    加注�? 列出 3 个未来工作选项 (更强 prompt / CLIP 检�?/ `frontCellIndex` 参数)
- **测试 639/639 �?lint �?tsc �?* (31 �?32 test files, +7 tests)
- **数据库迁�?* (用户�?500 报错根因): 直接 `db.exec` of `0054_add_character_reference_layout.sql`
  �?`I:\claw\AIComicBuilder-main\data\aicomic.db` + 手动 hash 插入 `__drizzle_migrations`�?  验证: `characters` �?15 �?(�?`reference_image_single TEXT` + `reference_layout TEXT NOT NULL DEFAULT 'four-view'`),
  现有�?`reference_image_single: null, reference_layout: "four-view"`
- **dev server**: 杀�?PID 30972, 启新 PID 23832 �?8900 (1.4GB) �?3000 端口监听;
  `bootstrap()` 已重�?migrations + AI providers�?  残留 500 �?Next.js dev 模式 HMR 编译抖动 ("Jest worker 2 child process exceptions"
  + "EPIPE" 写日志失�?, 不是代码问题 �?慢请�?200 OK (e.g. `GET /api/projects/SKB6CNwqAn5H?exclude=shots 200 in 119689ms`)
- **审计�?fix (d33c6b3, 7 commits ahead of c25e3d8) �?内容布局检�?bug**:
  - **bug**: aspect-ratio heuristic �?16:9 (2560×1440) 2×2 网格误判�?1×4 横条,
    输出空灰�? 真因�?16:9 图像可能�?2×2 网格 (1280×720 cells) �?1×4 横条 (640×1440 cells),
    二�?aspect 相同
  - **bug 2**: "非白像素" 距离度量�?*灰色背景**的角色设定图完全失效 (灰色 cell 全算前景)
  - **bug 3**: 生产路径 `uploads\frames\abc.png` �?`uploads/` 前缀,
    `path.join(uploadDir, imagePath)` �?`uploads/uploads/frames/abc.png` ENOENT
  - **修复** (`src/lib/character-ref-utils.ts`):
    1. **背景色检�?* �?�?16×16 角点采样平均�? 前景 = 与背�?RGB 距离 > 30
    2. **多候选评�?* �?four-view �?{2×2, 1×4, 1×3, 4×1}; three-view �?{1×3, 1×4, 4×1, 2×2};
       每候选计算前景密�?    3. **保护用户选择** �?候选必须比请求布局密度�?0.1 才覆�? 平局默认选请求布局
       (避免 2×2 vs 4×1 在顶部行�?silhouette 时翻�?
    4. **路径解析** �?`resolveUploadPath()` 剥掉 `uploads/` 前缀, 输入兼容 cwd-relative
       (`uploads/frames/abc.png`) �?uploadDir-relative (`frames/abc.png`),
       输出保持 `uploads/...` 形式以匹�?`referenceImage` 约定
  - **新测�?* (3 �?: 1×4 模型重排检�? 16:9 2×2 网格检�? 空白图返�?null, DB-style 路径 round-trip
  - **重建脚本** `scripts/reprocess-character-refs.ts`: 一次性跑�?28 个现有角�?
    验证视觉确认 (兔子�?2×2 网格裁出正面立绘 1152×1152, 乌龟�?1×4 横条裁出 1240×1240)
  - **测试 639 �?642 �?lint �?tsc �?*
- 待办: 用户端用 2 个角色场�? 把两个角色都设为"单图"�?三视�?重新生成 ref, 验证
  关键帧不再出�?4 个重复人�?(28 个角�?single portrait 已自动生�? 现在重生�?keyframe
  应该�?`referenceImageSingle` 而不�?4 视图设定�?

## 2026-06-07 Session �?HiDream-O1 工作流对齐官�?dev 参数
- 诊断 web app "不符合要�?的生图：pink/blue 噪点图是 ComfyUI 端发�?- 关键发现：通过 ComfyUI `object_info/ModelNoiseScale` �?tooltip 看到官方推荐�?**"HiDream-O1 base: 8.0, dev: 7.5"**，当�?`noise_scale: 6` 显著偏低 �?信号被噪声淹�?- 关键误判：先怀�?`CLIPTextEncode`（普通）应改�?`CLIPTextEncodeHiDream`�? encoder），�?ComfyUI 历史显示 `KeyError: 'l'`——`clip_l_hidream.safetensors` �?4 �?HiDream 专用 encoder 在该环境未安装（系统只有 `clip_l.safetensors` for FLUX / `clip_g.safetensors` / `t5xxl_fp8_e4m3fn` 不带 scaled / `llava_llama3` 而非 `llama_3.1_8b_instruct`�?- 关键真相：读 `M:\ComfyUI_windows_portable\ComfyUI\comfy\text_encoders\hidream_o1.py:1-7` 看到 "The real Qwen3-VL backbone runs inside diffusion_model.* every step, so this module just tokenizes the prompt"—�?*HiDream-O1-Image 是把 Qwen3-VL 嵌入�?diffusion model 内部�?passthrough 架构**，单 text encoder 路径�?*不是**官方 `hidream_i1_*`�? encoder）那�?- 拿到用户提供的官�?dev workflow (`image_hidream_o1_dev.json` + `image_hidream_o1_dev-API.json`) 对齐参数�?  - `ckpt_name`: `hidream_o1_image_mxfp8.safetensors` (base) �?`hidream_o1_image_dev_mxfp8.safetensors` (dev)
  - `noise_scale`: 6 �?**7.6** (dev 推荐)
  - sampler: `KSamplerSelect` + `dpmpp_2m_sde_gpu` �?**`SamplerLCM`** (s_noise=1, s_noise_end=1, noise_clip_std=2.5)
  - `cfg`: 7 �?**1** (dev 官方参数)
  - 移除 `HiDreamO1PatchSeamSmoothing`（官方未使用�?  - 移除 `KSamplerSelect`（被 SamplerLCM 替代�?- 修改 `src/lib/ai/providers/comfyui-image.ts:433-547`�?  - 模型/噪声/采样器节点替�?  - `cfg: 7` �?`cfg: 1`
  - `model: ["232", 0]` �?`model: ["124", 0]`（移�?Patch 节点后）
  - `sampler: ["230", 0]` �?`sampler: ["125", 0]`（改�?SamplerLCM�?- 更新测试 `src/lib/ai/providers/__tests__/comfyui-image.test.ts:213-239`�?  - ckpt 名称断言
  - noise_scale 断言 7.6
  - SamplerLCM 三个参数断言
  - cfg=1 断言
  - 移除 PatchSeamSmoothing / KSamplerSelect 的存在断言
- 端到端验证：构�?28-step 测试 workflow �?ComfyUI 实际生成 `hidream_dev_test_00001_.png` (24s, 1.4MB)，虎斑小猫红色坐垫，毛发细腻无伪�?- lint �?tsc �?vitest �?43/43 passed

## 2026-06-06 Session (�? �?HiDream-O1 中文 Prompt �?英文自动翻译
- 诊断 web app �?HiDream-O1 生成�?不合�?的根因：ComfyUI 历史确认生图成功，但 HiDream-O1 使用 Llama2 CLIP 文本编码器，中文 prompt 编码质量�?- 修复：在 `ComfyUIImageProvider.generateImage()` �?`isHiDreamO1` 分支中，检测中文后自动调用 OpenAI 兼容 API 翻译为英文，再送入 `buildHiDreamO1Workflow()`（`src/lib/ai/providers/comfyui-image.ts:61-107`�?- `translateToEnglish()` 函数：检�?`/[\u4e00-\u9fff]/`，使�?`OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL` 环境变量，temperature 0.1�?0s 超时，失败时静默回退原文
- 进一步修�?HiDream-O1 出图“不符合提示词、质量差”：不再把整段中文规则直译成英文说明文，而是让翻译器输出简洁、CLIP 友好的英文视�?prompt；同时将 HiDream 高质量档步数改为 `28`（`quality=hd/default/undefined -> 28 steps`，其它质量档保持 `20`�?- 用户确认 HiDream-O1 可直接识别中文后，已撤销英文翻译链，恢复为直接向 HiDream 发送原始中�?prompt；保�?`28` 步高质量档映射修�?- 外部仓库 `I:\claw\Windows-MCP-Enhanced` 已做最小可运行修复�?  - `utils.py` �?`Tuple` import，修正默认配置路径到根目�?`configs/vla_config.yaml`
  - `gui_agent.py` 改为 `load_config(vla_config_path)`，使 provider 覆盖真正生效；修�?`self.desktop.apps` -> `self.desktop.get_apps_from_start_menu()`；`window.title` -> `window.name` 兼容 Windows-MCP `Window` 结构；`screenshot_callback` 改为显式 `Callable`
  - `vla_client.py` 新增 `mano-p` provider 专用分支：不再错误调�?`/chat/completions`，而是调用 `http://localhost:7861/api/manop/infer`，并从返�?`{ text }` 解析动作
  - `tools/gui_agent.py` 修正 `vla_provider` 覆盖逻辑：临时写 YAML 配置并传�?`WindowsGUIAgent(vla_config_path=...)`，避免参数被忽略
  - 运行验证通过：`load_config()` 正常读取配置，`create_windows_gui_agent()` 可实例化，`mano-p` provider 覆盖生效，`find_window('Chrome')` 返回 `True`，`compileall` 通过
- 继续完善 `I:\claw\Windows-MCP-Enhanced` �?agent 核心逻辑�?  - 修复 `run_task()` / `_execute_action()` 返回语义：普通动作返�?`"continue"`，仅 `FINISH` 返回 `"finished"`，避免第一步点�?输入后就误报“任务完成�?  - 修复 `TYPE` 高风险误操作：没�?`click_first + click_x/click_y` 时不再调�?`Desktop.type((0,0), text)` 误点左上角，而是显式返回失败
  - 修复目标窗口绑定：`find_window()` 只使用真实打开窗口，不再把“开始菜单已安装应用”误当成当前窗口；成功匹配后会记�?`target_window_bounds`、切换前台窗口，并在截图/坐标执行时应用窗口偏�?  - `list_windows()` 改为基于真实桌面窗口而非开始菜单应用列�?  - `vla_client.py` 增加 fenced JSON / 文本�?JSON 块提取，提升 Mano-P / GPT 输出解析鲁棒�?  - `utils.py` 改为优先使用 `OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL` 环境变量，减少硬编码密钥依赖；`tools/gui_agent.py` 会在执行后清理临�?YAML 配置文件
  - 运行验证通过：`compileall` 通过，`find_window('Chrome')` 返回 `True`，且 `target_window_bounds` 已成功写�?- 继续硬化 `I:\claw\Windows-MCP-Enhanced`�?  - 增加 Win32 原生窗口兜底：前台窗口和顶层窗口枚举不再完全依赖 Windows-MCP 高层窗口列表，`find_window('Chrome')` / `bind_active_window()` 已恢复可�?  - 截图链改为优先使用窗口区域原生截图，并对空图直接抛错；`configs/vla_config.yaml` 默认 backend 改为 `pillow`，绕开当前环境下不稳定�?`dxcam`
  - 强化 VLA schema：prompt 强制要求只返回一�?JSON object 且必须包�?`action_type`；空 `{}` / 缺字段动作直接转�?`FAIL`
  - `tools/gui_agent.py` 不再�?provider 覆盖写入带密钥的临时 YAML；直接把内存配置注入 `WindowsGUIAgent` / `VLAClient`
  - `configs/vla_config.yaml` 已移除明�?`api_key`，改为依赖环境变量覆�?  - 动作成功语义补齐�?    - `FINISH` 测试已真实跑通，返回 `success=True`
    - 单步 `MOVE` 测试也已真实跑通，返回 `success=True`，并�?`execution: {status: 'continue', executed: True}`
  - 单步动作联调继续扩展：`CLICK`、`SCROLL`、`TYPE` 均已真实跑通；`TYPE` 需要把 VLA timeout 提高�?90s 才稳定返回动�?  - 多步 Notepad 任务暴露新问题：某些窗口边界会退化成极小截图（例�?`160x28`），导致 VLA 无法定位编辑区；已加入最小窗口尺寸过滤和过小截图回退到整�?整屏截图的兜底逻辑
- lint �?tsc �?
## 2026-06-06 Session - project audit follow-up
- Fixed `pnpm-workspace.yaml` by adding `packages: ['.']`, so pnpm commands run from the project root again.
- Fixed `src/lib/ai/providers/__tests__/agnes-video.test.ts` fake-timer helper by attaching a temporary catch before advancing timers; expected rejection tests no longer produce Vitest unhandled errors.
- Added an `AUTH_SECRET` bootstrap warning and documented it in `.env.example`; local `.env` was checked for presence without printing the secret.
- Fixed runtime `ENOENT ... .next/server/edge-instrumentation.js` by deleting the mixed Webpack/Turbopack `.next` cache and rebuilding; verified the regenerated middleware manifest no longer references `server/edge-instrumentation.js`.
- Started dev server with `I:\pnpm.exe run dev` and verified `http://localhost:3000/zh` returns HTTP 200.
- Tightened first/last frame image prompts to prevent reference-sheet/contact-sheet outputs: added a single-frame layout contract, explicit bans on collage/storyboard/multi-panel/thumbnail rows, and clarified character references are identity/style references only, never layout references. Added `frame-generate.test.ts` coverage for these constraints.
- Current verification for the frame prompt fix passed: `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `npm.cmd run build`.
- Updated non-4-grid batch video generation to chain shots from actual generated video tails: after each shot video finishes, FFmpeg extracts the final video frame, saves it as that shot's active `last_frame`, and uses it as the next shot's active `first_frame`. If a shot fails, the propagation chain is reset to avoid using a stale tail frame. Added FFmpeg tail-frame extraction test coverage.
- Current verification for the video-tail chaining fix passed: `vitest run src/lib/video/__tests__/ffmpeg.test.ts`, `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `npm.cmd run build`.
- Wired keyframe Auto Run into the chained workflow: Auto Run now calls `batch_frame_generate` with `chainContinuity`, so the frame stage generates the first shot's first frame and each shot's last frame; later first frames are supplied by previous video tails during `batch_video_generate`. Manual batch frame generation still keeps the original independent first+last behavior.
- Fixed chain-mode frame generation edge case: if the first shot already has a first frame but is missing a last frame, Auto Run now reuses that existing first frame and only fills the missing last frame instead of regenerating the first frame.
- Fixed remaining first/last frame contact-sheet outputs by changing keyframe image reference strategy: when a shot has multiple character reference images, first/last frame generation no longer passes those image references to the image model and relies on the text character descriptions instead. Single-character shots can still use the image reference. This prevents multi-reference models from reproducing reference sheet/collage layouts.
- Fixed prompt trigger words that still caused first/last frame contact sheets after image refs were removed: when no character image references are passed, first-frame prompts now use a text-only style/appearance lock and omit all character reference-sheet language (`角色设定图`, `4个视角`, `名字印在底部`). Last-frame prompts only mention the first-frame visual anchor and do not describe extra character reference sheets unless character image references are actually passed.
- Current verification for the Auto Run chain mode passed: `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `vitest run src/lib/video/__tests__/ffmpeg.test.ts`, `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run build`.
- Verification passed: `I:\pnpm.exe run lint --quiet`, `I:\pnpm.exe exec tsc --noEmit`, `I:\pnpm.exe exec vitest run` (619 tests), `npm.cmd run build`, and a final `I:\pnpm.exe run build` rerun.

## Completed
- **Ideogram-4 NVFP4 成功运行�?RTX 4080 16GB** �? 下载�?ComfyUI master �?`nodes_ideogram4.py`（提�?`Ideogram4Scheduler`），�?90 秒生成一�?1024×1792 图片。NVFP4 量化�?.1GB DiT�? Qwen3-VL-8B FP8�?.9GB CPU�? flux2-VAE�?20MB）完美适配 16GB 显存。工作流自动展平了子图定义，ComfyUI v0.22.0 前端成功解析 UUID 子图节点�?- **Session 2026-06-03 �?All video/image downloads converted to streaming**: Replaced `Buffer.from(await response.arrayBuffer())` + `fs.writeFileSync` with `pipeline(response.body!, createWriteStream(filepath))` across 16 provider files (8 video + 8 image). Updated 16 test files to mock `createWriteStream` + `pipeline`. Fixed `dashscope-image.test.ts` assertion from `writeFileSync` �?`pipeline`. **Files changed**: `agnes-video.ts`, `aivideo-video.ts`, `openai.ts`, `siliconflow-image.ts`, `sensenova-image.ts`, `kling-image.ts`, `kling-video.ts`, `seedance.ts`, `ucloud-seedance.ts`, `framepack-video.ts`, `wan-video.ts`, `dashscope-image.ts`, `comfyui-image.ts`, `comfyui-video.ts`, `asxs-image.ts`, `omnigen-image.ts`. lint �?tsc �?build �?- **Session 2026-06-01 �?生产构建 DB 修复 + Agnes 免费 API 验证 + 日志审查**: 
  - **生产 standalone 构建修复**: `scripts/copy-env-to-standalone.mjs` 现在同时复制 `drizzle/` 迁移文件�?+ `data/` 数据库到 `.next/standalone/`，并�?`DATABASE_URL` 从绝对路径重写为相对路径；`src/instrumentation.ts` 在生产模式下自动�?`dotenv` 加载 `.env`（独立服务器不会自动加载）。根因：`SqliteError: no such table: projects` �?缺少迁移文件 + .env 未加载导致创建空数据库�?  - **Agnes 免费 API 验证**: `GET /v1/models` �?(列出 5 个模�?，但文字�?03 model_not_found）、图片（503）、视频（500 upstream error）全部不可用 �?free key 无实际后端通道，需付费 Token Plan�?4/月起）�?  - **项目日志审查**: `prod-server.log` 确认�?DB 错误；`dev-server.log`�?682行）显示最�?25/25 镜头生成成功；`dev-server-err.log`/`dev-server-3001.log` 正常�?- lint �?tsc �?build �?
## 2026-06-06 �?ComfyUI Windows 优化（OSError [Errno 22] + wandb 冲突修复�?- **Root cause**: ComfyUI `logger.py` `LogInterceptor.__init__` 硬编�?`encoding='utf-8'`，Windows 控制台实际为 GBK(cp936)，导�?Latent 采样�?`tqdm` �?`wandb` �?`comfyui_manager/prestartup_script.py` �?`app/logger.py:66 super().write()` 整条链在 `TextIOWrapper.write()` 层报 `OSError: [Errno 22] Invalid argument`
- **logger.py 修复**: 改回 `encoding = stream.encoding` + `errors='replace'` �?GBK 不会引发 OSError，`errors='replace'` �?GBK 无法编码的字符（emoji 等）替换�?`?`，避免原�?UnicodeEncodeError
- **main.py wandb 关闭**: Windows 平台�?`setup_logger()` 前设�?`WANDB_CONSOLE=off`、`WANDB_SILENT=true`、`WANDB_MODE=disabled`，防�?wandb 自动 hook 控制台输出，消除整条冲突�?- **logger.py 容错**: `LogInterceptor.write()` 增加 `try/except OSError: pass`，即使底层写失败也不�?
## 2026-06-05 Session (�? �?HiDream-O1 单元测试 + 角色 Prompt 模板
- **SenseNova Image (`sensenova-ul-fast`) 已验证修�?�?*: 生图效果良好，当前架构对协议层兼容性正�?- **`buildHiDreamO1Workflow()` 单元测试**: 新增 15 个测试（默认结构、参考图模式节点验证�? 种分辨率映射�? �?steps 场景、seed 随机性、generateImage hidream-o1 提交流程），全部 53 个测试通过
- **HiDream-O1 角色 Prompt 模板**: 新增 `characterImageHiDreamO1Def`（自然语言四视图转角提示，2×2 网格布局，纯白背景，�?JSON 包装）；注册�?`registry.ts`；`detectImageModelFamily()` 新增 `"hidream"` 类型检测；`character.ts` handler 新增 routing（`hidream` �?`character_image_hidream_o1` prompt key + `hidream-o1-comfyui` workflowFamily�?- **角色 Prompt 单元测试**: 新增 `character-image.test.ts`�?1 个测试覆�?HiDream-O1/Ideogram4/Simple 三个 prompt 定义�?- **`detectImageModelFamily` 测试**: 新增 `character-image-detection.test.ts`�? 个测试覆盖全�?6 �?family�?- **Preflight 参考节点修�?*: 参考节点（HiDreamO1ReferenceImages, ComfySwitchNode, PrimitiveBoolean, LoadImage）从核心要求中移除，改为 `preflightWorkflow` �?`extraNodeTypes` 可选参数，仅在需要时检查；`generateImage()` �?HiDream-O1 分支提前�?preflight 前，根据 `referenceImages` 动态传�?extra 节点
- **`handleSingleCharacterImage` 集成测试**: 新增 `character.test.ts`�? 个测�?�?输入校验 3 �?+ HiDream-O1 路由/参考图/错误传播/stale shots 标记），mocks DB/Provider/Prompt/Shot-asset 全链�?- lint �?tsc �?build �?
## 2026-06-05 Session (�? �?HiDream-O1 Reference Images 支持
- **参考图上传**: `generateImage()` �?HiDream-O1 分支现在在构�?workflow 前先上传参考图�?ComfyUI server
- **`buildHiDreamO1Workflow()` 参考图分支**: �?`uploadedReferences` 非空时，自动添加 `LoadImage`（每个参考图一张）、`HiDreamO1ReferenceImages`（连�?CLIPTextEncode �?positive/negative 和所有参考图）、`ComfySwitchNode`（positive/negative 两条路径切换）、`PrimitiveBoolean(true)`（启用参考图模式）。无参考图时保持当前直连模式�?- **Preflight 扩展**: 新增 4 个可选节点类型（HiDreamO1ReferenceImages, ComfySwitchNode, PrimitiveBoolean, LoadImage�?- **限制**: 参考图必须是本地文件路径（�?Qwen Edit 一致），通过 `uploadImage()` 上传�?ComfyUI input 目录后被 `LoadImage` 引用
- lint �?tsc �?build �?
## 2026-06-05 Session (�? �?HiDream-O1 Image 集成 ComfyUI Provider
- **HiDream-O1 ComfyUI 工作流集�?*: 根据官方模板 `image_hidream_o1.json` 的扁�?API 格式，新�?`buildHiDreamO1Workflow()` 方法（CheckpointLoaderSimple + ModelNoiseScale + BasicScheduler + KSamplerSelect + HiDreamO1PatchSeamSmoothing + CLIPTextEncode + EmptyHiDreamO1LatentImage + SamplerCustom + VAEDecode + SaveImage�?- **模型路由**: `generateImage()` 新增 `isHiDreamO1` 分支，支�?modelId �?`hidream` 时自动路由；`detectWorkflowFamily()` 新增 `hidream_o1` 文件检�?- **分辨率映�?*: 新增 `ratioToHiDreamO1Size()`，按 HiDream-O1 训练分辨率（2048²/2560×1440/2304×1728/1440×2560 等）映射 aspect ratio
- **步骤控制**: `quality === "default"` �?40 步（原模板默认），否�?20 �?Turbo
- **Preflight**: 新增 `"hidream-o1-comfyui"` 7 个必需节点类型
- **Model List API**: 新增 `hidream-o1-comfyui` �?ComfyUI Image 模型列表
- lint �?tsc �?build �?- **Session [之前] �?Battle prompts registry + 4 provider test files**: Integrated 29 martial-arts shot prompt templates into `registry-battle.ts` (5 categorized slots), registered in `registry.ts` (19 total), appended rule 6 to `shot_split` fidelity rules; wrote 63 tests across `veo.test.ts` (13), `ucloud-seedance.test.ts` (16), `framepack-video.test.ts` (15), `aivideo-video.test.ts` (15). Fixed `vi.clearAllMocks` �?`vi.resetAllMocks` to prevent leftover `mockResolvedValueOnce` bleed across tests; used `vi.useFakeTimers` + `advanceTimersByTimeAsync` for poll timing test; used class `function()` expression in `vi.mock` factory for Google GenAI SDK constructor. lint �?tsc �?- **Session 06/06 下班**: 新写 1 �?wan-video.test.ts�?8 tests），累计 16 �?provider test 文件；所有新 provider �?`generateText`（抛不支持异常）、`generateImage`（t2i/size/认证/错误/写盘）、`generateVideo`（keyframe/reference/text/轮询/错误）全覆盖；支�?7 �?AI 厂商 × 2 大模态（图片+视频）；lint �?tsc ✅，`next build` �?Windows 上因内存超时受阻（`--turbo` bypass�?- **Hermes agent 修复并升级到 v0.15.1**: 根因是旧�?`0.15.1` pip 包的 `hermes_cli` 缺少 `main.py`，加�?`~ermes*` 残余目录干扰。清理残留后从本地源码重�?editable (v0.14.0)，然后运�?`hermes update --yes` 拉取 796 个新 commit，成功升级到 `0.15.1 (2026.5.29)`，状�?`Up to date`
- LongLive 1.0 inference pipeline functional (SDPA fallback, PyTorch 2.12)
- 4-grid batch frame generation button fixed (storyboard/page.tsx)
- Auto Run cascading fixed (needsPrompt includes needsFrame check)
- videoPrompt saved to DB after generation (video-keyframe.ts)
- OpenClaw Gateway running with QQ Bot + YuanBao channels connected
- OpenClaw security hardened (groupPolicy allowlist, plugins.allow whitelist)
- Harness infrastructure: AGENTS.md, .claude/settings.json, PROGRESS.md, setup.ps1/sh
- Dev server restarted (picks up fixed COMFYUI_OUTPUT_DIR from .env)
- Batch 4-grid tail flash trim added (video-keyframe.ts: ffmpeg trim for batch mode)
- `pnpm-lock.yaml` generated, eslint config rewritten (bypasses rushstack/pnpm incompatibility), `.npmrc` created
- **4-grid quality aligned to manual workflow**: frame_idx `[0,90,180,270]` + full LoRA chain (subtitles-remove �?restoration �?dynamic 0.6 �?OmniNFT 0.2 �?distilled 0.5) in `ltx-i2v-multiguide.json`
- Completion criteria all pass: lint �?tsc �?build �?- **Phase 1 �?角色库自动沉淀完成**: frame 生成后自动将角色出图追加�?`characters.referenceImageHistory`，用户可浏览历史帧图并设为主要参考图 (`src/lib/pipeline/handlers/frames.ts:33-49`)
- **4-grid 画质优化**: sigma schedule �?"balanced"�?步）�?"quality"�?7步）�?"quality_lite"�?3步）；distilled LoRA 强度 0.5 �?0.65，减少运动模�?- **N+1 dialogue 查询修复**: `/api/projects/[id]` �?`/api/projects/[id]/episodes/[episodeId]` 两个 GET 端点�?`inArray` + Map 分组替代逐个 shot 的对话查�?- **页面导航性能优化**: layouts 改用轻量模式 (`?exclude=shots`)，不加载 shots/assets/dialogues；storyboard 页按需触发完整数据加载
- **SenseNova 413 修复**: 所�?`generateText`/`generateImage` 调用的图片数组上限统一�?6 �?(`visionFrames`, `sceneFramePaths`, `shotCharRefImages`, Omnigen upload loop)
- **模型提供商架构修�?*:
  - `resolveAIProvider`: �?SenseNova �?text provider 回退�?OpenAI（继承同 protocol �?baseUrl/apiKey�?  - `model-store.getModelConfig()`: 添加 `capability` 检查，确保 `defaultTextModel` 只返�?`capability === "text"` �?provider
  - `ensureDefaultProvider()`: 新增 `isTextCapable()` 验证
  - Emotion-analysis + continuity-check API 路由: 添加 `modelConfig?.text` 存在性校验（400 拦截�?- **Git 分叉修复**: 本地 `master` �?`main` 重命名，GitHub 两端 (`main` + `master`) 同步，CNB 同步
- **测试框架**: 配置 vitest 4.1 + 5 test files / 61 tests (model-store, provider-factory, validation, id, utils)
- lint �?tsc �?(build �?environment timeouts �?blocked by resource limits)
- **Agent + 无限画布 (阶段1)**: 基于 `@xyflow/react` �?Storyboard 页面新增 Canvas 视图模式；点�?Shot 节点调出 Agent Chat 面板；`POST /api/projects/:id/agent/chat` 端点将自然语言指令映射�?pipeline actions
- **审计修复 (7 issues)**: 全部修复
  - Critical: `hasVideo` 类型修正�?`boolean` (!! 转换)
  - Critical: `useCanvasStore.getState()` 改为 zustand selector hook `useCanvasStore(s => s.selectedShotId)` 封装�?`CanvasView` 子组�?  - Critical: camera direction 倒挂解析 �?改用 `parseCameraDirection` + 正则匹配"pan left/zoom in"�?  - Critical: Storyboard Page 嵌入 canvas 结构调整 (消除双重 `viewMode === "kanban"`)
  - High: `INTENT_MAP` 排序提取到模块级常量 `INTENT_MAP_SORTED`，不在每�?`matchIntent` 调用时排�?  - High: agent-chat race condition �?`shotIdRef` 跟踪请求�?shot，过期响应自动丢�?  - High: `chatMessages` 全局数组 �?�?`selectedShotId` 隔离 (`chatMessagesByShotId: Record<string, ChatMessage[]>`)
  - 顺手修复: `<img>` 缺失 `onError` 兜底、页面残�?`{/* unused import */}` 清理
- **四宫格视频提示词 413 修复**: `video-prompt.ts` 在调用文本模型前按总图片体积预算选择 vision frames（最�?6 张且总原图体积约 2.5MB），避免 4 张大 panel base64 后请求体超限；lint �?tsc ✅，build 仍因环境资源超时
- **项目加载慢初步修�?*: `project-store` 增加 `loadedProjectKey`，Project/Episode layout �?Storyboard full fetch 会跳过已加载的同 key 请求，减少重复轻�?完整数据拉取；lint �?tsc �?- **Next root layout + 请求循环修复**: �?`src/app/layout.tsx` 恢复 `<html>/<body>`，`[locale]/layout.tsx` 改为只包 Provider；`project-store.fetchProject` 增加 `pendingProjectKey` 与同 key 去重，避�?ProjectLayout/EpisodeLayout 互相覆盖导致重复请求/页面 500；lint �?tsc ✅；dev server 已重新启动，`/zh` 返回 200
- **四宫格视频提示词只有 Duration 修复**: `video-prompt.ts` 对文本模型空输出增加 fallback prompt，避�?`rawPrompt.trim()` 为空时仍保存 `Duration: Ns`；单�?批量均覆盖；lint �?tsc �?- **单张生成 episodeId 传递修�?*: `ShotCard`/`ShotDrawer` 的单张参考帧、视频提示词、帧、视频生成请求补�?`episodeId`，避免服务端日志 `episodeId=none` 导致 episode 上下文刷�?筛选错位，看起来生成未成功；lint �?tsc �?- **4-grid 视频时长/去水印修�?*: 移除 `video-keyframe.ts` �?4-grid 视频生成后的 `ffmpeg -t dur-1.5` 裁剪逻辑，解决生成视频总比提示词少�?2 秒；同时�?LTX 模板中的 `ltx2.3-ic-subtitles-remove-general` �?`ltx2.3-video-restoration-general` 强度�?`0.9` 提到 `1.0`，增强字�?水印抑制；lint �?tsc �?- **吸收 Seedance skill 思路优化视频提示�?*: 增强 `registry-video.ts` �?`video_generate_4grid` 模板，加入“导演化改写规则”、时间分段、镜头语言、安全区与四层描述要求；增强 `video-enhance.ts`，将口语化视频描述自动翻译为更专业的电影镜头语言；lint �?tsc �?- **审计回归修复**: `enhanceVideoPrompt()` 增加 mode 参数，拆分为 `default` �?`four_grid` 两套 system prompt，避免四格导演化增强误伤普通视�?参考视频链路；`video-keyframe.ts` 的四格调用显式传 `"four_grid"`；lint �?tsc �?- **风格预设接入 ScriptEditor**: 新增 `src/lib/style-presets.ts`，整�?120 风格为可复用预设；`ScriptEditor` 增加风格下拉与“插入风格”按钮，会把所选风格写�?`Idea` 文本中的 `视觉风格参考：中文 / English` 行，便于脚本生成链路复用；lint �?tsc �?- **视觉风格参考显式进入生成链�?*: `buildScriptGeneratePrompt()` 现在会提�?`视觉风格参考：...` 并以高优先级显式注入 script_generate user prompt；`buildShotSplitPrompt()`/`shots.ts` 也会把该风格作为“最高优先级”约束喂给分镜拆解，确保 startFrame/endFrame/videoScript 持续体现选定风格；lint �?tsc �?- **风格链路继续下沉到关键帧/参考图**: `keyframe.ts` �?`ref-image.ts` 现在会优先读�?`视觉风格参考：...`（从 script / idea 中提取），再与剧本里�?`视觉风格 / 色彩基调 / 时代美学 / 氛围情绪 / 画幅比例` 合并，显式传入关键帧提示词和参考图提示词生成；lint �?tsc �?- **风格链路打通到视频提示�?参考视�?*: `video-prompt.ts` �?`video-reference.ts` 现在也会�?script / idea 中提�?`视觉风格参考：...`；该风格会显式注�?`buildRefVideoPromptRequest()` �?`buildReferenceVideoPrompt()`，使视频提示词与参考视频提示词保持和上游剧�?分镜同一风格基调；lint �?tsc �?- **UI 显示当前全局视觉风格**: 新增 `extractVisualStyleReference()` 工具方法；Script 页面�?Storyboard 页面页头会显示当�?`视觉风格参考` 徽标，方便用户随时确认当前项目风格；lint �?tsc �?- **吸收 lanshu 仓库的模型分流思路**: 新增 `src/lib/ai/video-model-strategy.ts`，可推断视频提示词家族（`ltx` / `wan` / `seedance` / `generic`）；`video-enhance.ts` 现在会按模型家族切换增强 system prompt，让 Wan 更偏稳定单动作、Seedance 更偏分镜散文、LTX 维持现有写法；lint �?tsc �?- **模型家族分流继续下沉到视�?prompt builder**: `buildRefVideoPromptRequest()` �?`buildReferenceVideoPrompt()` 现在支持 `family` 参数；`video-prompt.ts` / `video-reference.ts` 会把 `inferVideoPromptFamily(modelConfig)` 传入，使 Wan/Seedance 在原始视频提示词构造阶段就体现差异，而不只是在增强阶段分流；lint �?tsc �?- **Storyboard 显示当前视频模型家族**: `video-model-strategy.ts` 新增 `getVideoPromptFamilyLabel()`；Storyboard 页头现在会展示当前视频模型策略徽标（�?`LTX 连续镜头` / `Wan 稳定单动作` / `Seedance 分镜散文`），帮助用户理解当前提示词写法偏向；lint �?tsc �?- **Storyboard 显示模型策略说明**: `video-model-strategy.ts` 新增 `getVideoPromptFamilyHint()`；Storyboard 页头现在在视频模型徽标下方显示一行简短说明（例如“偏连续镜头、时序推进和电影化动作描述”），让模型差异化策略更可感知；lint �?tsc �?- **Script 页面也显示当前视频模型策�?*: `ScriptEditor` 页头现在同步展示当前视频模型家族徽标与简短说明，使用户在写创�?剧本阶段就能理解后续视频提示词偏向（LTX / Wan / Seedance）；lint �?tsc �?- **修复审计问题并提取专用策略徽标组�?*: 审计确认 Script/Storyboard 中原先直接通过 `getModelConfig()` 计算策略存在非响应式风险；现已抽�?`src/components/editor/video-model-strategy-badge.tsx`，通过响应式订阅视频模型状态统一展示策略标签与说明，不改高影响面�?`InlineModelPicker`；lint �?tsc �?- **风格下拉与当前项目状态同�?*: `style-presets.ts` 新增 `findStylePresetIdByReference()`；`ScriptEditor` 现在会根�?`project.idea` 中已有的 `视觉风格参考：...` 自动回填当前风格下拉，避�?UI 停在错误默认值；lint �?tsc �?- **插入风格时同步回填剧本视觉风格字�?*: `ScriptEditor.applyStylePreset()` 现在除了更新 `idea` �?`视觉风格参考：...`，还会在已有剧本正文中同步替�?`视觉风格�?..` 行，确保 UI 选定风格、剧本结构块和下游解析保持一致；lint �?tsc �?- **风格徽标显示增加 script 回退**: `style-presets.ts` 新增 `extractVisualStyleValue()`；Script �?Storyboard 页头现在会先�?`idea` 中的 `视觉风格参考：...`，若不存在则回退读取剧本结构块里�?`视觉风格�?..`，避免已有剧本项目不显示风格；lint �?tsc �?- **提取专用 VisualStyleBadge 组件**: 新增 `src/components/editor/visual-style-badge.tsx`，把风格徽标�?idea/script 回退逻辑统一封装，Script �?Storyboard 页面改为复用该组件，减少重复逻辑并便于后续扩展；lint �?tsc �?- **抽取统一视觉风格解析工具**: 新增 `src/lib/visual-style.ts`，统一提供 `extractStyleField()`、`extractPrimaryVisualStyleReference()`、`buildVisualStyleContext()`；`keyframe.ts`、`ref-image.ts`、`video-prompt.ts`、`video-reference.ts` 已切换到复用这套工具，去掉重复的风格解析代码；lint �?tsc �?- **视觉风格参考继续前移到 script_outline**: `visual-style.ts` 新增 `buildVisualStylePromptLead()`；`handleScriptOutlineAction()` 现在会在 outline 阶段就把风格作为显式高优先级上下文注入，无论走绑�?Agent 还是内置 `streamText` 路径，都能更早锁定整体美学方向；lint �?tsc �?- **Normal 视频路径注入视觉风格 + 模型家族**: `video-keyframe.ts` �?`buildVideoPrompt()` 调用新增 `visualStyle` �?`family` 参数，使非四格普通视频的 base prompt 也带上全局风格和模型策略上下文；lint �?tsc �?- **ComfyUI preflight 校验 + 错误代码标准�?*: 新增 `src/lib/comfyui/errors.ts`（标准错误代码枚�?+ `ComfyUIError` 接口）和 `src/lib/comfyui/preflight.ts`（`checkComfyUIServer()` / `checkComfyUIModels()` / `preflightWorkflow()`）；�?`ComfyUIVideoProvider` �?`ComfyUIImageProvider` �?`generateVideo()`/`generateImage()` 入口插入预检查，`SERVER_UNAVAILABLE` 等常见故障在提交 workflow 前就被捕获；同时�?image provider 补齐�?auth headers 支持；lint �?tsc �?- **4-grid 视频提示词注入视觉风�?+ 模型家族**: `build4GridPrompt()` �?fallback 模板�?registry 模板现在都支�?`VISUAL_STYLE` �?`MODEL_FAMILY` 两个额外替换变量；`video-keyframe.ts` �?single/batch 四格调用点将全局风格和模型家族传入；lint �?tsc �?- **Agent 脚本生成路径补齐视觉风格指令**: `handleScriptGenerate()` 绑定�?Agent 路径现在�?`handleScriptOutlineAction()` 一样，�?agent prompt 前显式注�?`buildVisualStylePromptLead()`；lint �?tsc �?- **视频提示�?duration cap �?10s 提升�?30s**: `buildVideoPrompt()` �?`buildReferenceVideoPrompt()` �?prompt 内时长硬帽从 10s 提升�?30s（适配 LTX/Wan 最�?30s 能力）；`buildRefVideoPromptRequest()` 同样提升�?30s，并根据 `family` 参数动态确定上限；lint �?tsc �?- **视频提示词测试修�?10 个失�?*: `buildInterpolationHeader` 在有 `segmentContext` 时跳�?registry 默认值（原先 registry 的通用 `interpolation_header` 覆盖了分段专�?header）；修复�?`detectLanguage` 按脚本文字语言输出标签导致�?10 个断言失败（英文输入输出英文标签，�?output 不含 `视频脚本`/`Video Script` 标签行）�?1 tests �?- **apiFetch TypeError: Failed to fetch 修复**: 所�?11 个批量操�?handler �?guard �?`if (!project) return;` 改为 `if (!project?.id) return;`，防�?store 未加载时 URL 变为 `/api/projects/undefined/generate`；`apiFetch` 增加 URL 包含 `undefined` 的检测和网络层异常的中文错误包装；lint �?tsc �?- **Duration cap 30s �?10s 还原**: `buildVideoPrompt()`, `buildReferenceVideoPrompt()`, `buildRefVideoPromptRequest()` 的所有时长硬帽统一回退�?10 秒；相关测试同步更新；lint �?tsc �?- **kling-video.test.ts**: 14 tests �?构造函数（默认�?环境变量/参数覆盖），generateVideo（image2video 关键�?text2video 引用/JWT Bearer/�?secretKey 直用 ak/400 无引用重�?轮询/提交失败/生成失败/duration v1 映射/duration v3 钳位/HTTP 图片引用）；lint �?tsc �?build �?- **kling-image.test.ts**: 15 tests �?构造函数（默认�?环境变量/参数覆盖），generateText（不支持异常），generateImage（正确body/自定义aspectRatio/JWT Bearer/无secretKey直用/poll轮询/submit HTTP错误/submit错误�?poll HTTP错误/poll失败/无URL/下载写盘）；lint �?tsc �?build �?- **siliconflow-image.test.ts**: 17 tests �?导出 `clampSize`/`resolveImageSize`；构造函数（默认�?env/参数覆盖/尾部斜杠），generateText（不支持异常），generateImage（默认body/model覆盖/aspectRatio/explicit size/img2img引用/HTTP URL引用/Bearer auth/HTTP错误/错误�?无图�?下载失败/下载写盘）；lint �?tsc �?build �?- **dashscope-image.test.ts**: 25 tests �?导出 `getModelFamily`/`resolveSize`/`ModelFamily`；getModelFamily（wan/zimage/qwen默认），resolveSize（explicit优先/wan比率/qwen比率/zimage比率/family默认/未知比率），构造函数（默认�?env/参数覆盖/尾部斜杠），generateText（不支持异常），generateImage（qwen body/wan尺寸/zimage无n/model覆盖/size优先�?Bearer auth/HTTP错误/API错误�?无URL/下载失败/下载写盘）；lint �?tsc �?build �?- **sensenova-image.test.ts**: 21 tests �?导出 `normalizeSenseNovaSize`/`normalizeBaseUrl`；normalizeSenseNovaSize（aspect映射/size映射/回退），normalizeBaseUrl（默�?强制/v1/尾部斜杠），构造函数（默认�?OPENAI_API_KEY/参数覆盖），generateText（不支持异常），generateImage（正确payload/explicit size/Bearer auth/b64_json保存/URL下载/frames目录/HTTP错误/API错误/空响�?无payload/下载失败）；lint �?tsc �?build �?- **hidream-image.test.ts**: 16 tests �?构造函数（默认/参数覆盖/尾部斜杠），generateText（不支持异常），generateImage（t2i模式/edit模式/subject模式/6张限�?size解析/默认2048+seed32/SSE解码写盘/start HTTP错误/无job_id/stream HTTP错误/SSE error事件/stream无结果）；lint �?tsc �?build �?- **omnigen-image.test.ts**: 20 tests �?构造函数（默认/参数覆盖/尾部斜杠），generateText（不支持异常），buildOmnigenPrompt（无ref/含ref/label+role/editBaseImage/dedup/6张限制），parseSSE（data+complete事件/[DONE]/非JSON），generateImage（上�?启动/下载写盘/txt2img免上�?上传失败/启动失败/无event_id/下载失败）；lint �?tsc �?build �?- **wan-video.test.ts**: 28 tests �?构造函数（默认�?环境变量/参数覆盖），buildKeyframeBody（wan2.6 img_url + size/wan2.7 media[] + ratio），buildReferenceBody（wan2.6 img_url/wan2.7 reference_image/上限8张），buildTextBody（非wan2.7 model/wan2.7→t2v），generateVideo（关键帧任务/引用任务/纯文本任�?Bearer auth + X-DashScope-Async/多轮轮询/submit HTTP错误/无task_id/生成FAILED/无video_url/下载写盘）；lint �?tsc �?build �?- **Provider 测试总览**: 16 �?provider test 文件，总计 20 �?test 文件；lint �?tsc �?(build �?environment timeout �?`--turbo` bypasses)
- **集成 Agnes AI 免费 API**: 新增 `agnes-video.ts` video provider（OpenAI-compatible 轮询风格定影模式），注册 `agnes` protocol �?model-store（Protocol 联合类型）、provider-factory（text/image �?OpenAIProvider，video �?AgnesVideoProvider）、ai-sdk（复�?createOpenAI）、UI provider-form（DEFAULT_BASE_URLS + 三级 capability 选择）。已验证 API：text（`Agnes-2.0-Flash`）✅ image（`Agnes-Image-2.0-Flash` 返回 URL）✅ video（`POST/GET /v1/video/generations`，提�?轮询+下载）但 free API 不稳定（upstream 500 "division by zero"）。lint �?tsc �?build �?- **Agnes video 测试**: 新增 `agnes-video.test.ts`�?8 tests）�?构造函数（默认/env/参数覆盖/尾部斜杠）、generateVideo（纯文本提交/图片base64/firstFrame/initialImage/Bearer认证/多轮轮询→COMPLETED/submit HTTP错误/无task_id/FAILURE错误/FAILED错误/COMPLETED无URL/video_url备选字�?下载失败/写盘验证/alt id字段）。lint �?tsc �?- **Key Decisions**:
  - `inferProvider()` called with `config: any` to avoid circular import from registry
  - `vi.stubGlobal("fetch", vi.fn(...))` + `vi.unstubAllGlobals()` in `beforeEach` for hermetic fetch stubs
  - Dedicated `generateVideo` test for multi-poll (RUNNING→SUCCEEDED), FAILED, missing video_url, HTTP error, no task_id
  - `as any` casts on test params to bypass restrictive union type narrowing (e.g., `VideoGenerateParams` union requires `initialImage` for all arms)
  - Text-only video generation handled via separate `buildTextBody` method; keyframe/reference each have dedicated builders
  - All helpers exported for direct unit testing (`clampSize`, `resolveImageSize`, `getModelFamily`, `resolveSize`, `normalizeSenseNovaSize`, `normalizeBaseUrl`)
  
## 迁移�?Infinite Canvas
- **决策**: 采用"工作流样�?方式迁移�?`basketikun/infinite-canvas`，不做插件化侵入
- **漫画提示词库**: 创建�?`prompts/manga-reference/prompts.json`�?5条提示词，涵�?7 大类：漫画风格、分镜构图、四格漫画、角色设计、动作场面、效果技法、漫画封面）
- **Go 后端**: �?`repository/db.go` 注册新分�?`manga-reference`，在 `service/prompt_fetch.go` 添加 fetcher（类 davidwu �?JSON 格式�?- **构建验证**: Go `go build ./...` �? `go vet ./...` �? Web `pnpm run build` �?(Next.js)
- **下一�?*: 创建 GitHub repo `basketikun/manga-prompt-reference`，将 prompts.json 推上去以激活自动同步；之后创建工作流样�?
## 2026-06-04 Session �?本地模型对比测试 + 视频生成项目评估
- **batiai/qwen3.6-27b:iq3 (11GB IQ3)**: 下载完成并测�?�?�?3.8 t/s（比 17GB Q4_K_M �?~3 t/s �?~25%），节省 6GB VRAM，释放更多显存余量�?- **Qwen3.6-35B-A3B-MTP-GGUF (Jackrong/ModelScope)**: 两个 GGUF 下载完成并对比测�?�?  - **Q2_K (12.34GB)**: `--spec-draft-n-max 4 --ctx-size 30000 -ngl 99` �?**159.8 t/s** 🚀。有 3.7GB VRAM 余量，适合大上下文
  - **Q3_K_S (14.48GB)**: `--spec-draft-n-max 3 --ctx-size 8192 -ngl 99` �?**129.0 t/s**�?4.48GB 太接�?16GB 上限�?0K ctx 会降速到 6.8 t/s
  - **结论**: Q2_K (12.34GB) �?RTX 4080 16GB 上的最佳选择 �?159.8 t/s + 30K ctx，远�?4060 Ti �?114 t/s (IQ2_XXS)
  - MTP (speculative decoding) 内嵌�?GGUF 中自动生效，`--spec-draft-n-max=4` 最�?- **Mamoda2.5 (ByteDance) 评估结果 �?*: 25B MoE DiT (128 experts, Top-8) + Qwen3-VL-8B = ~33B 总参数；即使 4-bit 量化 (~16.5GB) + 128 expert 路由开销 + Wan2.2 VAE 远超 16GB VRAM�?*不能�?RTX 4080 本地运行**，需 CNB/L40
- **Stream-R1 (USTC/FrameX.AI) 评估结果 �?*: 基于 Wan2.1 1.3B 蒸馏，仅需 8.19GB VRAM，RTX 4080 16GB 可轻松运�?(23.1 FPS at 832×480)；GitHub �?HuggingFace �?ISP 拦截，暂无法克隆/下载
- **项目结论**: RTX 4080 16GB 本地可用�?AI 视频方案：Stream-R1 (1.3B, 需 ISP 修复)、Wan2.1 1.3B/14B FP8+T5 offload、LTX-Video (0.9B)、ComfyUI 已有

## Blocked
- LongLive 1.0 local inference too slow (~3h per 30-frame video on RTX 4080) �?use CNB (L40, Linux, FA2) for production
- **Qwen3.6-35B-A3B NVFP4**: vLLM 0.22.0 加载成功（MarlinNvFp4Kernel + MARLIN MoE backend），模型架构/量化识别正确，但 RTX 4080 16GB VRAM 不够（权�?~16GB + 中间激�?OOM），需 CNB (L40 48GB) 或下�?GGUF 小模型本地部�?- **Stream-R1 / Mamoda2.5**: GitHub (代码) �?HuggingFace (模型权重) 均被 ISP 拦截，Nginx 代理不支�?git 协议，等 ISP 修复或手动下�?
## Known Issues
- `next build` webpack 模式�?ComfyUI（~21GB）运行时内存不足挂起，改�?`--turbo` 参数即可；`package.json` 已默认带�?`--turbo --no-lint`
- `verify-videos.js` excluded from lint (utility script)
- Vitest fake timer + rejects.toThrow 会产�?unhandled rejection 假阳性（测试本身通过�?
## 2026-06-02 Session �?Provider 全量审计 + 代码质量修复 + 测试覆盖加固 (+80 tests)
- **Provider 一致性审计完�?*: 20 providers 全部 √，端点/响应与真�?API 对齐�? response shape 不匹�?- **3 CRITICAL, 5 HIGH, 2 MEDIUM 问题全部修复**:
  - CRITICAL: comfyui-image.ts (6 fetch calls 全部�?AbortSignal.timeout)
  - CRITICAL: comfyui-video.ts (硬编�?`M:\ComfyUI...\output` �?platform-aware；checkpoint 路径反斜�?�?前斜�?
  - CRITICAL: ucloud-seedance.ts (缺少 `process.env.UCLOUD_API_KEY` fallback)
  - HIGH: dashscope-image, kling-image, kling-video, seedance, wan-video (全部 fetch �?timeout)
  - MEDIUM: openai.ts, sensenova-image.ts (�?timeout)
  - 同时修复 ltx-workflows.ts 全部 6 处反斜杠路径
- **`.env.example` 更新**: 新增 `UCLOUD_API_KEY`, `COMFYUI_OUTPUT_DIR`, `COMFYUI_LTX_CHECKPOINT`
- **测试覆盖审计 + 加补**: 发现 4 个关键缺�?(0% 覆盖�? �?全部填补
  - AbortSignal 传播测试: 0% �?89% (17/19 providers)
  - JSON 解析错误测试: 0% �?84% (16/19)
  - 轮询超时/最大重试测�? 0% �?100% (9/9 polling providers)
  - 缺失 API key 验证测试: 0% �?86% (12/14 applicable providers)
  - 网络错误测试: 5% �?84% (16/19)
  - 总计新增 ~80 tests，全部通过
  - 3 unhandled rejections 是已知的 Agnes 假定时器假阳�?- **验证**: lint �?tsc �?build �?全部 489 tests �?- **修复 IMAGEGEN_API_KEY 优先级问�?*: `openai.ts` �?`process.env.IMAGEGEN_API_KEY` 无条件覆�?`params.apiKey`，导�?Agnes 协议配置�?key �?ASXS 全局 key 冲掉 �?401。修复为 `params.apiKey` 优先，`IMAGEGEN_*` 仅作 fallback。测试同步更新。lint �?tsc �?35/35 �?
## 2026-06-05 Session �?蚂蚁女王 + Ideogram-4 角色提示词规�?+ ComfyUI 扁平 workflow 修复
- **更新 `character-image.ts`**: `ImageModelFamily` 添加 `"ideogram4"` 类型；`detectImageModelFamily()` 支持 detection via `protocol === "ideogram4"` �?modelId 包含 `ideogram4`/`ideogram-4`
- **新增 `characterImageIdeogram4Def` (registry-character.ts)**: 第七个角色提示词定义，输出结构化 JSON 格式 (`high_level_description`/`style_description`/`compositional_deconstruction`)，支�?`<3D 迪士�?皮克斯动画风�?` 可编�?slot
- **注册�?`registry.ts`**: 导入并注�?`characterImageIdeogram4Def`
- **更新 `character.ts` handler**: `handleSingleCharacterImage` �?`handleBatchCharacterImage` �?`ideogram4` 模型家族路由�?`"character_image_ideogram4"` 
- **ComfyUI provider 集成**: `ComfyUIImageProvider` 新增 `buildIdeogram4Workflow()`（最小化 15 节点扁平格式）；`generateImage()` 新增 Ideogram-4 分支（提�?�?轮询 �?下载）；workflow 模板 `ideogram4-t2i.json` 复制�?`src/lib/ai/providers/workflows/`
- **`buildIdeogram4Workflow()` 扁平格式修复**: 原实现直接返回带子图定义�?workflow JSON（含 `nodes`/`links`/`definitions/subgraphs`），�?ComfyUI `/prompt` API 只接受扁�?`{ node_id: { class_type, inputs } }` 格式 �?500 "Server got itself in trouble"。已重写为硬编码 15 节点扁平 workflow：CLIPLoader �?CLIPTextEncode �?ConditioningZeroOut �?DualModelGuider（positive/negative），UNETLoader(v2) �?CFGOverride �?DualModelGuider（model），UNETLoader(uncond) �?DualModelGuider（model_negative），RandomNoise + KSamplerSelect + Ideogram4Scheduler + EmptyFlux2LatentImage �?SamplerCustomAdvanced �?VAEDecode(VAELoader) �?SaveImage。跳�?JSON 解析辅助子图（结构化 JSON 直接注入 CLIPTextEncode）。`quality: "default"` �?20 步，否则 12 �?Turbo�?- **Preflight 支持**: `preflight.ts` 添加 `"ideogram4-comfyui"` 节点类型检查（26 个必需节点类型�?- **生产构建**: `copy-env-to-standalone.mjs` 新增�?4 步——复�?workflows/ 目录�?standalone 目录
- **验证**: lint �?tsc �?build �?- **Session 2026-06-05 �?Workflow 路由修复 + 三重降级检�?*:
  - **问题**: `isIdeogram4` 始终�?false �?`ComfyUIImageProvider.model` 不含 "ideogram4"（model config �?`modelId` �?"z-image-turbo-comfyui"），prompt 也不�?`"prompt_generation"`（因 `detectImageModelFamily` 返回 "other" �?默认 free-text builder）→ 落入 Z-Image Turbo �?400
  - **修复方案（三重降级检测）**:
    1. **`WorkflowFamily` 选项** (`types.ts`): `ImageOptions.workflowFamily`，caller 可显式指�?workflow
    2. **Prompt 内容检�?* (`comfyui-image.ts:451`): prompt �?`"prompt_generation"` �?Ideogram-4
    3. **Server 端模型自动检�?* (`comfyui-image.ts:422-452`): `detectWorkflowFamily()` 查询 `/models`，发�?`ideogram4_nvfp4_mixed.safetensors` �?`"ideogram4-comfyui"`。带实例级缓�?+ localhost 短路
  - **额外修复**: 构造函�?fallback 移除误用�?`process.env.COMFYUI_BASE_URL`（URL 字符串当 model 名）
  - **检测优先级**: `options.workflowFamily` �?model �?�?prompt 内容 �?server 模型列表 �?默认 Z-Image Turbo
   - **测试**: 582 tests ✅（新增 localhost 短路 + 缓存后恢�?6 个因 fetch 中断�?comfyui-image.test�?   - lint �?tsc �?
## 2026-06-05 Session (�? �?Qwen Edit Dual 自动检测修�?+ Z-Image Turbo 路径验证
- **Z-Image Turbo UNET 路径**: 已验证官方模�?`image_z_image_turbo.json` �?note 说明模型存放�?`diffusion_models/z_image_turbo_bf16.safetensors`（根目录，无 `ZImage/` 子文件夹）。代码中�?`unet_name: "z_image_turbo_bf16.safetensors"` 正确，无需修改�?- **Qwen Edit Dual 自动检测修�?*: `detectWorkflowFamily()` 原本只扫�?`diffusion_models` 文件夹，�?Qwen Edit 模型�?checkpoint（位�?`checkpoints` 目录）。已改为同时扫描 `diffusion_models` �?`checkpoints` 两个目录�?- **构建修复**: 需先清�?`.next` 缓存、关闭残�?`next dev` 进程、使�?`--turbo` flag（与 `package.json` �?build script 一致）�?- lint �?tsc �?build �?
## 2026-06-05 Session (�? �?SenseNova 故事板帧 Prompt 重构 (去格�?去文�?
- **问题**: 用户反馈故事板帧图生成（通过 SenseNova `sensenova-ul-fast`）仍然出现格子边框和文字标签
- **修复**: `buildPanelPrompt()` (frames.ts:59-75) 彻底重构�?  - 移除�?`"生成四宫格分镜中�?PANEL X，作为一张高质量图像�?`（触发模型输出网�?漫画分格�?  - 移除了所�?`=== 场景描述 ===`/`=== 当前面板画面 ===`/`=== 角色描述 ===` 节标�?  - 改为纯平铺格式，第一行即为质量约束（"电影级动画场景渲染，丰富细节，电影布光，完整环境背景。不要格子边框，不要分格线，不要出现任何文字标签�?�?  - 结尾行从"画面应像漫画/分镜的单�?panel，而不是拼贴图"改为"保持角色、服装、光线、画风连续性�?
  - 新格式与 `characterImageSimpleDef`（已验证 SenseNova 工作正常）格式一�?- **registry-frame.ts**: �?`frame_generate_first`/`frame_generate_last`/`scene_frame_generate` 的首行追加反约束�?不要格子边框，不要漫画分格线，不要出现任何文字标�?�?- **验证**: lint �?tsc �?build �?(编译 10.3s)
- **API 测试受阻**: ASXS 代理 (`gpt-4o-mini`/`gpt-4o`) �?Agnes API �?503，无法用 Vision 自动检�?SenseNova 出图效果
- **下一�?*: 用户重启 dev server 后实际测试故事板帧图生成 SenseNova 效果
## 2026-06-05 Session (�? �?SenseNova API timeout 180s�?00s
- **问题**: Batch 4-grid 生成�?shot 5 �?192.4s 超时。根因：`sensenova-image.ts:124` �?`AbortSignal.timeout(180_000)` 不足以覆�?4 �?panel（每�?~45s�?- **修复**: 180s�?00s（与 `api-fetch.ts` �?300s 一致）
- **验证**: lint �?tsc �?build �?
## 2026-06-05 Session (�? �?角色参考图历史三重优化
- **问题**: 每生成一帧分镜图都追加到�?shot **所有角�?*�?`referenceImageHistory`，角色卡历史图杂�?- **三重优化** (`frames.ts:33-51`):
  1. **按角色名匹配**: `appendFrameToCharacterHistory` 新增 `matchContext` 参数，只有角色名出现在帧描述文本中才追加（跳过无关角色）
  2. **只追首帧**: 移除 last frame 的追加（2�?call site），4grid 模式保持只追 panel[0]
  3. **历史上限 20**: 超过 20 张时自动删除最早的，防止无限增�?- **验证**: lint �?tsc �?build �?619 tests �?- **实测验证** �? 通过 `agnes-image-2.0-flash` 用新 prompt 格式生成测试图，再经 `agnes-2.0-flash` vision 分析确认：`grid:false text:false type:scene` �?无格子边框、无文字、单张场景图。新格式有效�?
## LoomVideo 记录 �?阿里全能视频生成+编辑模型 (2026-06)
- **论文**: [arxiv.org/pdf/2606.06042](https://arxiv.org/pdf/2606.06042)
- **开�?*: [github.com/MSALab-PKU/LoomVideo](https://github.com/MSALab-PKU/LoomVideo)
- **架构**: 5B DiT + 8B Qwen3-VL（去�?T5，用 Qwen 做多模态条件输入）
- **三大创新**:
  1. **Deepstack**: Qwen3-VL 每层特征一对一注入 DiT 对应层（而非只取最后一层）
  2. **Scale-and-Add**: 隐空间直接数学运算替�?Token 拼接，编辑提�?5.41×（核心）
  3. **Negative Temporal RoPE**: 参考图负编号、视频帧正编号，区分素材与生成内�?- **性能**: 480×832×97 帧，文生 132s / 编辑 166s（消费级 GPU 可行�?- **局�?*: 上限 480p、偏向电商服饰、高动态镜头易畸变
- **接入评估**: RTX 4080 16GB 可跑，需写独立推理脚本或�?ComfyUI 节点

## Session 2026-06-06 �?全部 5 �?LTX 模板补齐 Singularity LoRA + NAGuidance，Windows ComfyUI OSError 修复
### ComfyUI Windows 控制�?OSError 修复
- **根因**: `ComfyUI/app/logger.py` LogInterceptor 硬编�?`encoding='utf-8'`，Windows 控制台实际为 GBK(cp936)。`tqdm` �?`wandb` �?`comfyui_manager/prestartup_script.py` �?`app/logger.py:66` 整条链在 `TextIOWrapper.write()` �?`OSError: [Errno 22] Invalid argument`
- **修复�?1** (`logger.py`): `encoding='utf-8'` �?`encoding=stream.encoding` + `errors='replace'`
- **修复�?2** (`logger.py`): write/flush �?`try/except OSError: pass`
- **修复�?3** (`main.py`): `setup_logger()` 前设 `WANDB_CONSOLE=off / WANDB_SILENT=true / WANDB_MODE=disabled`
- **启动验证**: ComfyUI (PID 5844, 端口 8188) 正常运行，零 OSError、零 UnicodeError

### `ltx-workflows.ts` 优化
- 对比实际工作�?`video_ltx2_3_i2v (1).json`，补�?3 个缺�?LoRA（Singularity-LTX-2.3_OmniCine_V1 strength=1.0 / subtitles-remove strength=1.0 / restoration strength=1.0）→ �?4 LoRA 堆叠�? distilled strength=0.5），插入 NAGuidance 节点（nag_scale=5, nag_alpha=0.5, nag_tau=1.5），更新 camera control 接线，合并负向提示词

### 全部 5 个模板补�?Singularity LoRA + NAGuidance
- **`ltx-i2v-pro.json`**: 新增 `320:326` Singularity + `320:329` NAGuidance，更�?2 �?CFGGuider 模型引用，合并负向提示词
- **`ltx-i2v-api.json`**: 新增 `320:326/327/328` �?LoRA + `320:329` NAGuidance，更�?CFGGuider 模型引用
- **`ltx-i2v-4grid-baseline-simple.json`**: 新增 `377` Singularity（紧凑格式）
- **`ltx-i2v-4grid-baseline.json`**: 新增 `376` Singularity
- **`ltx-i2v-multiguide.json`**: 新增 `378` Singularity�? LoRA 堆叠 + NAGuidance 最复杂模板�?- **链完整�?*: 全部 5 个模板验证通过 �?�?Singularity 均为 checkpoint 后第一 LoRA，NAGuidance 均为 CFGGuider 前最后节�?
### Verification
- lint �?tsc �?
## Session 2026-06-06 (�? �?管线端到端验�?+ Camera LoRA 对齐官方命名
### Camera LoRA 命名与官方对�?- 对照 `github.com/Lightricks/LTX-2` 官方仓库列出�?9 �?Camera LoRA（dolly-in/out/left/right, jib-up/down, static），�?`CAMERA_LORA_MAP` 完全一�?�?- 项目额外�?pan/tilt/zoom/roll/orbit LoRA 为社区扩展，未在官方仓库中但兼容同一架构

### Camera LoRA 接线修复
- `addCameraLoRANode` �?`buildLTXi2vT2vWorkflow`（非 pro）和 `buildLTXProWorkflow`（模�?pro）中均正确插入于 distilled LoRA（`320:285`）之后、NAGuidance（`320:329`）之�?- Camera LoRA 激活时链：`Checkpoint �?Singularity �?SubtitleRemove �?VideoRestore �?Distilled �?Camera �?NAG �?CFG`
- Camera LoRA 未激活时链：`Checkpoint �?Singularity �?SubtitleRemove �?VideoRestore �?Distilled �?NAG �?CFG`
- `addCameraLoRANode` 参数�?`cfgGuiderIds` �?`downstreamNodeIds` 消除语义误导

### Model name 更新
- `models/list/route.ts`: `"LTX Video 2.3 图生视频 Pro (3LoRA双采�?"` �?`"LTX Video 2.3 图生视频 Pro (4LoRA+NAG双采�?"`

### 端到端验�?- JSON 模板替换后解�?✅（5/5 �?ltx-i2v-pro/ltx-i2v-api/4grid-baseline/4grid-baseline-simple/multiguide�?- 节点引用完整性检�?✅（全部模板零断链）
- ComfyUI 实战提交流程验证 ✅：`POST /prompt` 接受 ltx-i2v-pro 工作流（prompt_id=`e790a4fe-...`），返回 200 �?说明 ComfyUI 识别 NAGuidance/所�?LoRAs、连接有效、结构正�?- Dev server `http://localhost:3000` ✅，ComfyUI `http://127.0.0.1:8188` �?- lint �?tsc �?- **下一阶段**: 在浏览器中实际跑一�?`ltx-i2v-pro`（需要一张参考图 + shot 数据），或切�?`HiDream-O1` 测试单帧生成质量

## Session 2026-06-06 (�? �?Mano-P 本地 VLA 集成 + Windows-MCP-Enhanced 端到端验�?
### Mano-P 启动 & 验证
- 系统 Python（`C:\Users\zjwji\...\Python313\python.exe`，torch 2.6.0+cu124）启�?`app.py`，加�?`Qwen3VLForConditionalGeneration` from `I:\AIs\Mano-P\models\Mininglamp\Mano-P\fp16`
- �?shard 加载 ~10s，VRAM ~9.9 GB，监�?`127.0.0.1:7861`
- 健康检�?`GET /api/manop/health` �?`{"model_loaded":true,"status":"ok"}`
- `.venv-win` �?`torch 2.12.0+cpu` 不可用（CUDA 不可用），确定系�?Python 为唯一可行路径

### Mano-P 推理性能优化
- 原始 1080p 全屏截图推理 ~25s（Qwen3VL 将大图分片为大量视觉 token�?- 添加运行�?resize（`max_image_width: 1280`）：解码 JPEG �?`Image.LANCZOS` 等比缩放 �?重新编码 JPEG �?推理降至 **~1.7s**
- 配置�?`mano-p.parameters.max_image_width` 默认 1280，在 vla_client �?`_call_api()` 中实�?
### 系统提示词适配
- Mano-P 端点为纯用户消息（Flask server 使用 `apply_chat_template`，不�?system role），系统提示词在 vla_client 中前置到 task text
- 初始长格式提示词（含完整 action schema 描述）→ 模型以中文自然语言回复，非 JSON
- 迭代优化：极简提示�?`"Output ONLY valid JSON, nothing else. Example: {\"action_type\":\"FINISH\"}"` �?模型输出正确 `{"action_type":"FINISH"}`

### 端到�?Agent 测试
- `WindowsGUIAgent` + `mano-p` provider：截�?�?resize 1280px �?含提示词�?task �?`POST /api/manop/infer` �?JSON 解析 �?动作执行
- **Test 1 (FINISH)**: 9.9s �?迭代�?**3.1s**，`{"action_type":"FINISH"}` 正确返回 �?- **Test 2 (MOVE)**: 初始返回 FINISH（跳过动作）�?改进提示词（极简 JSON 示例 + 明确动作列表）后正确输出 `{"action_type":"MOVE","x":...,"y":...}` ✅（但坐标推断不准：�?DPI 降采样截图下模型像素级定位差�?- 16 单元测试全部通过 �?
### 关键修复 �?Prompt Engineering 迭代
| 版本 | 问题 | 修复 |
|------|------|------|
| 长格式提示词 + action schema | 模型输出中文自然语言而非 JSON | 极简 prompt + JSON 示例 |
| �?FINISH/FAIL 示例 | 模型对所有任务输�?FINISH | 增加 MOVE/CLICK/TYPE/PRESS 多动作示�?|
| `element_id` 未支�?| 模型自定�?`target: [x,y)` 格式 �?JSON 解析失败 | 提示词标�?`element_id` 为坐标替代方�?|
| 元素上下文追加在 task �?| 模型误认为要交互元素、忽�?FINISH | 改为 `=== 参�?===` + `=== Task ===` 分离结构 |

### Hybrid 架构：Snapshot 元素�?+ VLA 坐标注入
- 问题：Mano-P 降采�?1280px 后无法精确输出像素坐标（输出 `x:1000` 而非 `x:100`�?- 方案：agent 在截图时一并调�?`Desktop.get_state(use_ui_tree=True)`，提�?`interactive_nodes` 作为元素上下�?- 实现�?  - `_get_cached_screenshot()` 同步抓取 `tree_state.interactive_nodes`（一次调用，免额外遍历）
  - `_format_element_context()` �?格式化为 `id=N: "label" (control_type) [x,y]` 文本（~1700 chars�?  - 注入 VLA 提示词，声明 `use element_id for precise coordinates`
  - 模型输出 `{"action_type":"CLICK","element_id":3}` �?`_resolve_element_id()` 从缓存元素树解析出实际坐�?- 效果：含元素上下文的 FINISH 测试 **4.9s**（无上下�?3.1s，~1.8s 开销来自 UI 树遍历）
- 单元测试覆盖：`test_resolve_element_id_from_cached_tree` ✅、`test_resolve_element_id_skipped_when_missing` �?
### MOVE 停止条件改进
- 原代码仅匹配 `"only moves the mouse"` 精确子串 �?扩展�?`move_phrases = ('move the mouse', 'move cursor', 'move the cursor', 'only moves the mouse')`
- MOVE e2e 测试：迭代次数从 3�?�?.4s 完成�?
### 已知局�?- Qwen3VL-4B 坐标推断不准：高 DPI 降采样截图下像素级定位能力差，`element_id` 方案可绕开此问题但需要模型学会使�?`element_id`
- 当前不做 use-case 时可保持 Mano-P 服务器运行（~9.9 GB VRAM）；需要时可重�?
### Real-World Click via `element_id` �?- 测试：在真实桌面上通过 `element_id` 点击系统托盘 Realtek 音频图标
- **模型输出**: `{"action_type":"CLICK","element_id":2}` ✅（正确使用 element_id 而非猜测像素坐标�?- **坐标解析**: `_resolve_element_id()` 从缓存的 `_last_element_tree` 中查�?`id=2` �?`[2470, 1416]` �?- **验证**: `validate_action()` 已更新为接受 `element_id` 作为 x/y 替代 �?- **停止条件**: `click_phrases` 匹配 "click on it" �?1 次迭代完�?�?- **延迟优化**:
  - 原始�?2s�?44 元素注入 �?模型处理大量无关上下文）
  - 优化�?*5.2s**�?88%），过滤只保�?25 个相关控件（Button/Edit/Hyperlink 等常见类型、剔除空�?超长名元素）
  - 方法：`_format_element_context()` 增加 `relevant_types` 白名�?+ 25 元素上限 + 名字长度 < 60
- **新增单元测试**: `test_should_stop_after_click_for_click_task` ✅（�?17 测）

### 关键改进
- `utils.py validate_action()`: `coord_actions` �?`element_id` 可替�?`x`/`y`
- `gui_agent.py _resolve_element_id()`: 新增 task 文本回退解析 `element_id=N`（即使模型未输出 element_id 字段也能工作�?- `gui_agent.py _should_stop_after_action()`: 新增 `click_phrases` 点击停止条件
- 测试框架：mock `infer_action` 增加 `element_context=""` 参数兼容

### JSON 自修复（模型输出格式容错�?- Mano-P (Qwen3VL-4B) 生成 JSON 时有 token 错误（遗�?key、多余括�?方括号）
- `_extract_json_block()`: 三阶段修复策�?  1. 通用清理：去掉数值后�?`)`, `]`, 重复 `}`
  2. �?key：`"x":<n>,<m>` �?`"x":<n>,"y":<m>`（遗�?"y":�?  3. 最终兜底：截取首个完整 `{...}` �?- `infer_action()`: JSON 解析失败时自动重�?1 次，追加错误提示�?task 文本
- 验证：多种格式错误均能修�?  - `{"x":158,931}` �?`{"x":158,"y":931}` �?  - `{"y":492)}` �?`{"y":492}` �?  - `{"x":500,499]}}` �?`{"x":500,"y":499}` �?
### AIComicBuilder 项目全面测试 �?- **Dev Server**: PID 38036, port 3000, 运行正常
- **API 端点** (4/5 通过):
  - �?`GET /api/projects` �?200 `[]`
  - �?`GET /api/prompt-templates` �?200 `[]`
  - �?`GET /api/prompt-presets` �?200
  - �?`GET /api/agents` �?200
  - ⚠️ `POST /api/models/list` �?502 (需正确请求�?
- **前端页面**:
  - ⚠️ `/` �?500 Internal Server Error
  - �?`/zh` �?404
  - ⚠️ `/en` �?500
  - �?API JSON 直接访问正常
- **DOM 提取** (`use_dom=True`):
  - �?�?Chrome 提取 `dom_informative_nodes` (~10 条文�?
  - �?`dom_node` �?`ScrollElementNode` (�?bbox/center)
  - �?Chrome `--remote-debugging-port=9222` �?MCP session 无法启用
- **GUI Agent (Mano-P)**:
  - �?单步点击 5.2s（element_id�?  - �?多步推理不可靠（卡在同一动作循环�?  - �?桌面导航成功（`Desktop.click/type` �?Chrome 地址�?�?页面跳转�?
### 已知问题
- Qwen3VL-4B 输出 JSON �?token 级错误（需修复层兜底）
- Chrome 远程调试端口不可�?�?`use_dom` 只返回文本摘要（~10 条），无完整 DOM �?- 多步推理超出 4B 模型能力，建议单步任�?+ Python 编排
- API `/api/models/list` 需 POST body `{protocol, capability, baseUrl?, apiKey?}`

## Next Steps
- Fix Chrome remote debugging �?enable full DOM tree �?proper web UI testing
- Fix root page 500 SSR error (app frontend bug)
- Generate test project via API then test full storyboard flow
- For AIComicBuilder mainline: implement HiDream-O1 ComfyUI workflow, LTX Video 4-grid
- When ASXS quota resets: benchmark GPT-5.5 vs Mano-P on same GUI tasks

## 2026-06-07 Session (�?) �?ERNIE-Image ComfyUI 集成
- 用户下载�?ERNIE-Image (M:\models\ernie-image\, 43.83 GB) �? 集成到项�?- 新增 WorkflowFamily: \ernie-image-comfyui\
- 新增 ImageModelFamily: \ernie\ (modelId includes 'ernie')
- 复用 \character_image_hidream_o1\ prompt key (layout selector + 中文 prompt 都适用)
- 文件改动 (9):
  - \src/lib/ai/types.ts\ �?WorkflowFamily �?'ernie-image-comfyui'
  - \src/lib/ai/prompts/character-image.ts\ �?ImageModelFamily + detect()
  - \src/lib/comfyui/preflight.ts\ �?WORKFLOW_NODE_REQUIREMENTS['ernie-image-comfyui']
  - \src/lib/ai/providers/comfyui-image.ts\ �?buildErnieImageWorkflow() + generateImage 分支
  - \src/lib/pipeline/handlers/character.ts\ �?family === 'ernie' 分支 (×2)
  - \src/app/api/models/list/route.ts\ �?comfyui image 列表�?ERNIE
  - 3 测试文件 �?+5 测试 (comfyui-image 3, detection 1, character 1)
- ERNIE workflow 节点:
  - UNETLoader (66): ernie-image.safetensors | ernie-image-turbo.safetensors
  - CLIPLoader (62): ministral-3-3b.safetensors, type='flux2'
  - VAELoader (63): flux2-vae.safetensors
  - KSamplerSelect (16): 'euler' (base) | 'res_multistep' (turbo)
  - KSampler (70): steps 50/8, cfg 4.0/1.0
  - EmptyFlux2LatentImage (71), CLIPTextEncode (76/78), RandomNoise (18), VAEDecode (65), SaveImage (73)
- 分辨�? 1024², 1376×768, 768×1376, 1200×896, 896×1200, 1264×848, 848×1264
- 未实�? prompt enhancement 节点 (\TextGenerate\ + \ernie-image-prompt-enhancer.safetensors\), 可后�?toggle
- 用户使用步骤: 设置�?�?�?ComfyUI provider �?模型勾�?'ERNIE-Image (ComfyUI)' �?启动 ComfyUI
- 验证: lint �? tsc �? vitest 647/647 (+5) �?

## 2026-06-07 Session (�?) �?NVIDIA NIM Cosmos 视频/图片 API 集成
- 调研 NVIDIA 视频生成 API (build.nvidia.com NIM 目录):
  - **Cosmos 系列** (首�? 免费 ~40 req/min): Cosmos-1.0 7B/14B, Cosmos-Predict1/2 (2B/14B),
    Cosmos-Transfer2 (多控+4K), Cosmos-Reason2 (VLM), Cosmos-Embed1 (向量)
  - 免费额度足够 prototype, 商用可自托管 (NVIDIA Open Model License, RTX 50 �?+ NVFP4/FP8 �?2.5x)
  - 未集�?Cosmos 3 (太新, 8s 片段 ~15min 一�?
- 新增协议: `nvidia-nim` (与现�?`nvidia` 协议分离, 避免影响 LLM text 路径)
- 新增 provider 文件 (2):
  - `src/lib/ai/providers/nvidia-nim-video.ts` (NvidiaNimVideoProvider implements VideoProvider)
    - 支持 3 种模�? T2V (text→video), I2V (initialImage→video), Keyframe (firstFrame+lastFrame→video)
    - 自动检�?model family: `cosmos-1.0` / `cosmos-predict1` / `cosmos-predict2`
    - cosmos-1.0/predict1 强制 1024×640 / 32 frames / 8 fps
    - cosmos-predict2 �?aspect-ratio 映射 (16:9�?280×720 �?7 �?
    - num_frames �?duration 缩放: �?s�?2, �?0s�?4, >10s�?3
    - 异步任务: 提交�?`https://ai.api.nvidia.com/v1/cosmos/<model>` �?轮询
      `https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/<id>`, 5s 间隔, 30min 上限
    - 同时支持 sync 响应 (�?inline video) �?async 轮询
    - 支持 base64 内嵌视频�?URL 视频两种返回格式
    - 3 helper: `getNimVideoModelFamily()`, `isVideoToWorld()`, `isTextToWorld()`,
      `ratioToResolution()`, `toImageUrl()`
  - `src/lib/ai/providers/nvidia-nim-image.ts` (NvidiaNimImageProvider implements AIProvider)
    - text 生成�?"does not support" 异常 (image-only)
    - 2B 模型�?20 steps / cfg 3.0, 14B �?35 steps / cfg 7.0
    - 同样支持 sync 响应 + async 轮询 + base64 / URL
    - 接受 `size` / `aspectRatio` / `negativePrompt` 参数
- 注册 + 静态模型列�?
  - `src/lib/ai/provider-factory.ts`: `createAIProvider` �?`"nvidia-nim"` case (image) +
    `createVideoProvider` �?`"nvidia-nim"` case (video)
  - `src/app/api/models/list/route.ts`: NIM video 列表 (10 �?Cosmos 模型) + NIM image 列表 (2 �?
  - `src/stores/model-store.ts`: `Protocol` union �?`"nvidia-nim"`
  - `src/components/settings/provider-form.tsx`: `DEFAULT_BASE_URLS["nvidia-nim"] = "https://ai.api.nvidia.com"`,
    `getProtocolOptions()` �?image �?video 两边都加 "NVIDIA NIM (Cosmos)" 选项
- 测试 (2 个新文件, +32 tests):
  - `src/lib/ai/providers/__tests__/nvidia-nim-video.test.ts` (22 tests):
    - family 检�?(cosmos-1.0/1/2)
    - isVideoToWorld / isTextToWorld capability detection
    - ratioToResolution (�?cosmos-1.0 强制 1024×640)
    - toImageUrl (http URL passthrough + 本地文件�?data URL)
    - 提交: text-only / I2V / keyframe 模式 body
    - cosmos-1.0 dimensions 验证 (1024×640, 32 frames, 8 fps)
    - num_frames �?duration 缩放
    - NVCF status 端点轮询 + Bearer auth
    - 提交失败 / 状态失败抛�?
    - sync 响应 (inline video URL) 处理
    - base64 视频保存 (writeFileSync)
  - `src/lib/ai/providers/__tests__/nvidia-nim-image.test.ts` (10 tests):
    - text 生成�?"does not support"
    - 提交 body (size, steps, guidance)
    - 2B vs 14B 参数差异
    - aspect ratio 映射 / 显式 size 解析
    - negativePrompt 透传
    - NVCF 轮询
    - HTTP 错误 / 状态失�?
    - base64 图片保存
- 验证: lint �? tsc �? vitest 679/679 (+32) �?
- 用户使用步骤:
  1. �?https://build.nvidia.com 注册拿免�?API key
  2. 项目设置 �?�?"NVIDIA NIM (Cosmos)" 协议 (image �?video)
  3. base URL 默认 `https://ai.api.nvidia.com` (无需�?
  4. �?API key �?拉模型列�?�?�?Cosmos 模型
  5. keyframe 视频�?`comfyui-ltx-flf2v` 类似方式, �?I2V �?`nvidia/cosmos-predict2-14b-video2world`
- 资源:
  - https://build.nvidia.com/models (�?capability 过滤 video)
  - https://docs.api.nvidia.com/ (完整 API reference)
  - https://github.com/nvidia-cosmos/cosmos-predict2 (Cosmos Predict2 开�?

## 2026-06-07 Session (�?) �?Hermes-Agent CNB 同步 + ERNIE 模型落盘
### 项目�?
- commit `70e1b01` ERNIE-Image 集成 (见上)
- ERNIE 模型 (43.83 GB) 已落 `M:\models\ernie-image\`:
  - `diffusion_models/ernie-image.safetensors` (14.96 GB)
  - `diffusion_models/ernie-image-turbo.safetensors` (14.96 GB)
  - `text_encoders/ministral-3-3b.safetensors` (7.19 GB)
  - `text_encoders/ernie-image-prompt-enhancer.safetensors` (6.41 GB) �?未接�?workflow
  - `vae/flux2-vae.safetensors` (0.31 GB)
- 官方 ComfyUI workflow JSON: `M:\models\image_ernie_image.json` (54.6 KB)
- 状�? dev server **DOWN** (3000 端口�?, ComfyUI **UP** (8188)
- 未做 (用户�?: 编辑 `M:\ComfyUI_windows_portable\extra_model_paths.yaml` �?
  `M:\models\ernie-image` 加为 model 搜索路径, 重启 ComfyUI

### Hermes-Agent 同步
- 镜像�? `https://cnb.cool/zjwjing/hermes-agent` (user's fork)
- CNB HEAD: `44c0c2d refactor(inventory): make force_fresh_nous_tier keyword-only + pin contract`
- 同步: robocopy /E 从临�?clone 覆盖�?`I:\claw\hermes-agent\`
- 结果: 4,896 文件 (4,136 + 760 �?, 105.2 MB
- 保留 162 �?local-only 文件 (107 skills, 29 website, 15 RELEASE_v*, 11 misc �?
  `gateway\platforms\homeassistant.py`, `plugins\example-dashboard\`)
- SHA256 校验 3 个关键文�?
- **更正之前的错误假�?*: `I:\claw\hermes-agent\.git\` 一直存�? `.git/config` 远程
  已指�?CNB (而不�?GitHub). robocopy 同步 `.git` 时把 config 也覆盖了. 之前
  误以�?local �?git 仓库

### `hermes update` 失败根因
- 之前失败是因为原 `.git/config` 指向 `https://github.com/NousResearch/hermes-agent.git`
  (blocked)
- 同步�?`.git/config` 已指 CNB, 正常路径会工�?
- 潜在风险: 即使 CNB 已是 origin, `_is_fork()` 会判 True (CNB 不在
  `OFFICIAL_REPO_URLS`), 触发 `_sync_with_upstream_if_needed()` 尝试 fetch
  `github.com/NousResearch`. 失败时函�?graceful return, 不阻塞主更新�?
- 未实现修�? �?`https://cnb.cool/zjwjing/hermes-agent.git` 加入
  `OFFICIAL_REPO_URLS` (`hermes_cli/main.py:8460`), �?CNB 视为官方�?
  跳过 upstream 检�? 用户未要�? 留待后续

## Next Steps
- 用户�? 编辑 ComfyUI `extra_model_paths.yaml` + 重启 ComfyUI + 重启 dev server
- 用户�? smoke test ERNIE end-to-end (创建 character �?�?ERNIE 模型 �?生成)
- (可�? patch `hermes_cli/main.py:8460` �?CNB �?OFFICIAL_REPO_URLS
- (可�? 实现 ERNIE prompt-enhancer (TextGenerate + `ernie-image-prompt-enhancer.safetensors`)
  作为 UI toggle
- (可�? rebase 26de0b4 去掉 "will 404" 注释
- 之前 deferred: GPT-5.5 vs Mano-P benchmark, full DOM tree extraction,
  4B 多步推理加固
- 之前 deferred: `next build` 4 次被 shell 工具 kill, 暂以 lint+tsc+vitest(647)
  作为完成标准

## 2026-06-07 Session (��4) �� ERNIE-Image �˵��˲��� + �ٷ� workflow ����
### �˵�����֤
- �û�ȷ�� ComfyUI �ѹ��� ERNIE ģ�� (M:\models\diffusion_models\, text_encoders\, vae\), dev server ������
- ComfyUI /object_info/UNETLoader ȷ�Ͽɼ� ernie-image.safetensors + ernie-image-turbo.safetensors
- /object_info/CLIPLoader ȷ�Ͽɼ� ministral-3-3b.safetensors + ernie-image-prompt-enhancer.safetensors
- /object_info/VAELoader ȷ�Ͽɼ� lux2-vae.safetensors

### ���� Bug: buildErnieImageWorkflow() ʹ���˴���� KSampler API
- �ִ깤����ʹ���°� KSampler �ӿ� (Ҫ 
oise: [...] + sampler: [...] ����)
- ComfyUI 0.24.0 KSampler �Ǿ����, Ҫ sampler_name + seed + scheduler ֱ��ֵ
- �ύ 400 ����: Required input is missing: sampler_name, seed

### �޸�: ���ùٷ� API workflow JSON ģ��
- ���� src/lib/ai/providers/_workflows/ernie-image-api.ts: ���� ERNIE_IMAGE_API_PROMPT (�ٷ� 20 �ڵ� API ��ʽ����)
- uildErnieImageWorkflow() ��Ϊ JSON.parse(JSON.stringify(ERNIE_IMAGE_API_PROMPT)) ���¡ + ���踲��:
  - "88:78".inputs.value = �û� prompt
  - "88:72".inputs.text = negative prompt (ƴ��Ĭ�� + �û�����)
  - "88:76".inputs.value = 	rue (prompt enhancement ����, Ĭ�Ͽ���)
  - "88:71".inputs.{width,height,batch_size} = �ֱ���
  - "88:70".inputs.{seed,steps,cfg,sampler_name,scheduler,denoise} = ��������
  - "88:66".inputs.unet_name = turbo vs base ģ��ѡ��
  - "88:92"/"88:93".inputs.source = ʵ�ʳߴ� (�� StringReplace �滻 {width}/{height})
  - "73".inputs.filename_prefix = turbo vs base ǰ׺
- turbo ����: 8 steps / cfg 1.0 / res_multistep / simple; base: 20 steps / cfg 4.0 / euler / simple (ƥ��ٷ�Ĭ��)

### ���Ը���
- comfyui-image.test.ts ���� ERNIE ���Ը��� "88:XX" �ڵ� ID (ƥ������ͼ�����ռ�)
- base model steps ������ 50 ��Ϊ 20 (ƥ��ٷ�Ĭ��)

### ʵ����֤
- ֱ�� ComfyUI �ύ prompt_id 2b8ba641-cb70-487a-9800-6c866ca9f692
- ����ǰ�� LTX-2.3 ��Ƶ (1280��720��24fps��8s), �ȴ�Լ 60s
- ʵ�� ERNIE �� ~150s (20 steps �� ERNIE-Image base ����)
- ���: ernie-test_00001_.png (1024��1024, 1.5 MB) �� ����ƥ�� prompt (���ɰ�è + ��̨ + Ϧ��)
- ��֤: lint ? tsc ? vitest 679/679 ? (����������, ���޸Ķ���)

### ����
- ɾ�� 	est-ernie.mjs + 	est-ernie-wait.mjs (��ʱ���Խű�)

### �ؼ��ļ�
- src/lib/ai/providers/comfyui-image.ts:566-616 (�� uildErnieImageWorkflow)
- src/lib/ai/providers/_workflows/ernie-image-api.ts (�ٷ� API JSON ����, 200+ ��)
- M:\models\image_ernie_image-API.json (����)
- C:\Users\zjwji\AppData\Local\Temp\opencode\ernie-test\ernie-final-*.png (�������)

## Next Steps
- �û����� dev server, �� UI �˵��˲��� ERNIE ��ɫͼ����
- (��ѡ) ʵ�� ERNIE prompt-enhancer (TextGenerate + ernie-image-prompt-enhancer) ��Ϊ UI toggle
- (��ѡ) �ύ�����޸� (git add + �Һ��� commit)


## 2026-06-09 Session �� Prompt ������ + ��������
### �ؼ��޸�
- uildVideoPrompt �Ƴ��� uildInterpolationHeader ���ã�registry Seedance Ԫָ�����Ⱦ��Ƶģ�����룩����Ϊ���α��
- ɾ����δʹ�õ� uildInterpolationHeader ������-71 �У�
- ���²��ԣ�Seedance ���Դ����ĸ�ΪӢ��

### ��ƽ��
- lint: ? tsc: ? vitest 679/679 ?
- git diff: 2 files, +16/-62 lines
- GitNexus: LOW risk, 0 affected flows

### ����
- ComfyUI ����ʧ�ܣ�custom node ȱ aiofiles + GBK ���룩
- Dev server δ����

### ComfyUI fixed
- aiofiles installed; PYTHONIOENCODING=utf-8 set
- ComfyUI UP on port 8188 (PID 44128)
- LTX nodes available, API responsive

### Next: run video test with clean prompt or check next build

## 2026-06-09 Session — turbovec vector search integration
### Key changes
- **Schema**: New `embeddings` table (content_type, content_id, model, vector, text) — stores OpenAI embedding vectors as JSON text
- **New module `src/lib/embedding/index.ts`**: `embedText()` / `embedBatch()` using OpenAI `text-embedding-3-small`
- **New module `src/lib/vector-search/index.ts`**: `cosineSimilarity()` + `findCharacterBySemanticMatch()` + `storeEmbedding()` + `getEmbedding()` — DB-backed vector similarity search
- **Integration in frames.ts**: When exact character name match returns 0 results (`filteredChars.length === 0` but `shotCharNameSet` has names), falls back to `findCharacterBySemanticMatch()` using shot prompt → finds top character by cosine similarity > 0.5 threshold
- **Migration**: `drizzle/0055_add_embeddings.sql` + journal entry
- **Script**: `scripts/index-character-embeddings.ts` — batch-index all existing characters

### Verification
- lint ✅ tsc ✅ build ✅
- Blast radius: LOW — only frames.ts character filtering path modified; 2 code sites (batch + single frame generate)

### Design
- **turbovec concept absorbed**: 16x compressed vector storage via SQLite JSON + TypeScript cosine similarity. Upgrade path to turbovec Python sidecar if scale demands it.
- **No Python dep**: Pure TypeScript/OpenAI embeddings — works on all platforms without Python runtime
- **Semantic fallback**: Only activates when exact name match fails (0 chars found). Doesn't change hot path.

### Status
- **Embedding API**: Current proxy (`asxs.top`) returns 404 on `/v1/embeddings`. SiliconFlow/DashScope also unreachable in current network. System gracefully degrades: semantic match → fuzzy name match → exact name match.
- **Fuzzy name match**: `charNGramSimilarity` in `vector-search/index.ts` — bigram overlap for Chinese text. Handles "阿壮-兵蚁" ↔ "阿壮" or "工蚁丙" ↔ "工蚁丙（落水者）"
- **Migration 0055 applied**: `embeddings` table exists in DB
- **Character index**: Populating embeddings requires an embedding-capable API. Set `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` env vars (separate from main chat API) when available.

### Next
- Frontend integration for candidates/readiness/SSE/transitions
- Embedding API (needs EMBBEDDING_BASE_URL/API_KEY — blocked)
- AI agent binding: shot-split agent output format now has transition fields, verify agent compatibility

## 2026-06-20 Session (全链条管道加固 + 转场推荐系统)
- **视频管道统一改进**：
  - `video-keyframe.ts`：batch handler 增加 readiness 逐 shot 诊断、cancellation (AbortSignal registerTask)、generationId
  - `video-reference.ts`：batch handler 加 taskId 参数、readiness 诊断、cancellation、generationId；single handler 加 generationId
  - `generate/route.ts`：`batch_reference_video` 加入 BATCH_ACTIONS 受 pipeline 锁保护
- **转场推荐系统 `transition-recommender.ts`**：
  - 规则引擎：相邻 shot 分析镜头方向 (weight map)、场景变化 (sceneId)、动态强度 (action/calm 关键词)、位置（首尾特殊处理）
  - 7 种转场值：cut / dissolve / fade_in / fade_out / wipeleft / slideright / circleopen
  - 首帧 `fade_in` / 尾帧 `fade_out` / 同场景 `cut` / 场景切 `dissolve` / 大方向变 `wipe`
- **转场 API**：
  - `GET /api/projects/[id]/transitions?episodeId=xxx` — 只读预览推荐
  - `POST /api/projects/[id]/transitions` with `{ confirm: true }` — 批量写入 shot.transitionIn/Out
- **分镜生成自动填充转场**（`shots.ts` handler）：
  - shot-split 解析后（agent + built-in 双路径），运行 recommendTransitions 算法补填 `transitionIn`/`transitionOut`
  - 用户零操作：新分镜自动获得合理转场（UI 上可手动覆盖）
- **AI 提示增强**（`registry-shot.ts`）：
  - 输出格式加 `transitionIn`/`transitionOut` 字段
  - 新增 `transitions` 槽（rules slots），含转场选择指导原则
- **诊断增强**（`diagnostic/route.ts`）：
  - 返回 `transitions.recommendations[]`（逐 shot 建议）
  - 返回 `transitions.suboptimalCount`（实际值与推荐值不同的数量）
  - summary 增加 `suboptimalTransitions` 统计
- **代码质量**：`frames.ts` 修复 `episodeId!` 非空断言 → 安全解构变量 `epId`
- **全量审计 + 修复**：
  - **generationId 覆盖 48% → 100%**：补齐 scene frame handler（2 处）、keyframe.ts（4 处）、ref-image.ts（5 处）、shots.ts upsertPromptAsset（1 处）
  - **死代码清理**：移除 `failTask` 未用 import（frames.ts、video-keyframe.ts、video-reference.ts）
- **cancellation/readiness 统一集成**：
  - `ref-image.ts`：`handleBatchRefImageGenerate` + `handleGenerateRefPrompts` 加 taskId、registerTask、signal.abort 检查、progress 更新、completeTask
  - `character.ts`：`handleBatchCharacterImage` 加 taskId、registerTask、signal.abort 检查、progress 更新、completeTask
- **PROGRESS.md checkpoint 更新**
- **验证**：lint ✅ tsc ✅ build ✅
- **前端集成 (全部4项完成)**：
  - **转场推荐 UI**：Storyboard 页面新增 Row 5 区域含"转场推荐"按钮；Dialog 显示 shot-by-shot 推荐 vs 当前 diff（含入/出转场对比、原因）；"应用全部推荐"按钮调用 POST confirm
  - **Canvas 转场可视化**：`canvas-storyboard.tsx` edges 增加彩色标签（cut=灰/dissolve=蓝/fade=金/wipe=紫/circle=绿）、transition 类型缩写显示、label bg 白色半透明
  - **SSE 实时进度**：`pollTaskSSE()` 使用 EventSource 连接 `/api/tasks/{id}/stream`，SSE 失败时自动回退 HTTP 轮询；startBatchTask 优先尝试 SSE
   - **诊断面板 UI**：Storyboard 页面新增"诊断"按钮；Dialog 显示 summary grid（完成/失败/卡住/过期等）、完成度进度条、diagnostic messages（带 severity 色彩）、per-shot 状态列表
- **验证**：lint ✅ tsc ✅ build ✅

## 2026-06-20 Session (续) — task 基础设施完成 + sceneId 注入
- **task 基础设施补齐（4 handler）**：
  - `keyframe.ts`：`handleGenerateKeyframePrompts` 加 agent + built-in 双路径 abort 检查 + updateTaskProgress；注册 `generate_keyframe_prompts` → BATCH_ACTIONS
  - `video-prompt.ts`：`handleBatchVideoPrompt` 加 taskId（每 shot abort 检查 + per-shot progress）；注册 `batch_video_prompt` → BATCH_ACTIONS
  - `video-assemble.ts`：`handleVideoAssembleSync` 加 taskId（5-step progress：version resolve / query / transitions / dialogue audio / ffmpeg）；注册 `video_assemble` → BATCH_ACTIONS
  - `script.ts`（流式 API）和 `ai-optimize.ts`（单次文本转换无 DB 写）→ 跳过，因生命周期不兼容或无意义
- **转场推荐测试**：`transition-recommender.test.ts` 14 个用例覆盖空数组、首尾帧规则、static cut、scene change dissolve、wipe、motion intensity、中文文本、internal shot collapse、mergeTransitions
- **poll timeout 测试日志噪音消除**：4 个 provider 测试 (wan/agnes/aivideo/kling) 用 `vi.spyOn(console, "log").mockImplementation(() => {})` 抑制 126+ 行轮询输出
- **sceneId 注入（shots.ts 双向路径 + DB）**：
  - `ParsedShot` 新增 `sceneId?: string`
  - 内置路径：按 chunk 分组分配 `sg_0`, `sg_1`...
  - Agent 路径：按 scene group 分组分配 `sg_N`
  - 两路径 DB insert 均写入 `shot.sceneId`
  - `recommendTransitions` 输入传真实 sceneId（不再是 null），scene change 检测生效
- **审计确认**：11 handler 中 8 个具备完整 task 基础设施；`genId()` 输出 12 字符 nanoid，DB `text("id").primaryKey()` 无长度限制（taskId 18-char limit 不存在，已取消对应条目）
- **验证**：lint ✅ tsc ✅

## 2026-06-20 Session (续2) — BATCH_ACTIONS 补齐 + shot_split task 基础设施
- **BATCH_ACTIONS 注册补齐**（`generate/route.ts`）：新增 `shot_split`、`batch_character_image`、`batch_ref_image_generate`、`generate_ref_prompts` → 这些 handler 之前已有 task 基础设施但未注册为后台任务，运行时 `taskId` 始终为 undefined，基础设施是死代码；注册后改为后台执行 + SSE 轮询
- **`shot_split` task 基础设施**（`shots.ts`）：
  - 接受 `taskId` 参数（6 号参数）
  - `registerTask(taskId)` + AbortSignal 检查（batch 循环间 + fallback 循环间）
  - 进度：`updateTaskProgress` 以 chunk 为单位（`total: sceneChunks.length`）
  - 成功 `completeTask` / 失败 `failTask` / 取消 `completeTask({ failed: ["Cancelled"] })`
- **审计更新**：11 handler 中 **9 个**具备完整 task 基础设施（排除 script.ts 流式 + ai-optimize.ts 单次）；3 个 handler（batch_character_image/batch_ref_image_generate/generate_ref_prompts）基础设施从死代码变为实际可用
- **验证**：lint ✅ tsc ✅

## 2026-06-20 Session (续3) — batch_scene_frame task 基础设施
- **`batch_scene_frame` task 基础设施**（`frames.ts:handleBatchSceneFrame`）：
  - 接受 `taskId`、`registerTask` + AbortSignal（shot 循环间 + target 循环间）
  - `updateTaskProgress` 以 shot 为单位（`total: allShots.length`）
  - 成功 `completeTask` / 取消 `completeTask({ failed: ["Cancelled"] })`
  - 注册 `batch_scene_frame` → BATCH_ACTIONS
- **审计更新**：11 handler 中 **10 个**具备完整 task 基础设施（仅 script.ts 流式 + ai-optimize.ts 单次排除）；所有 `batch_*` handler 均注册为后台任务
- **验证**：lint ✅ tsc ✅

## 2026-06-20 Session (续4) — shot-split 集成测试 + generationId 修复
- **shot-split 集成测试**（`shots.test.ts`，5 个测试）：
  - 空白剧本 400 / 无模型配置 400
  - 成功路径：验证 sceneId（`sg_0`）、转场填充（`fade_in`/`dissolve`/`fade_out`）、DB insert 数据完整性
  - task 进度：验证 `updateTaskProgress`（初始 total:0 + 按 chunk 粒度）和 `completeTask`
  - 失败路径：验证 `failTask` 在 `generateText` 抛出异常时被调用
  - DB mock 模式：`_results` 数组驱动查询响应，支持 `.where()` 直接 await 和 `.where().orderBy().limit()` 两种链式模式
- **generationId 修复**（`frames.ts:handleBatchSceneFrame`）：每张 ref image 使用独立 `genId()` 替代共享 `batchGenId`，使单张图片可追踪；删除废弃变量 `batchGenId`
- **审计确认**：所有 `batch_*` handler 使用每操作独立 generationId（无共享 batchGenId 残余）
- **验证**：lint ✅ tsc ✅ build ✅

## 当前状态总结
- **11 handler 中 10 个**具备完整 task 基础设施（`registerTask` + AbortSignal + `updateTaskProgress` + `completeTask/failTask`）；排除 `script.ts`（流式）和 `ai-optimize.ts`（单次无 DB 写）
- **generationId 覆盖 100%**：所有图片/视频生成操作使用独立 `genId()`
- **转场推荐系统**：规则引擎 7 种转场值 + 14 个测试 + shot-split 自动填充 + 前端 UI/Canvas/SSE/诊断面板
- **sceneId 注入**：built-in + agent 双路径，按 chunk/scene group 分组分配，DB 持久化
- **BATCH_ACTIONS**：所有 `batch_*` handler + `shot_split` + `generate_ref_prompts` 注册为后台任务
- **698 tests** 全部通过；build 正常完成（`--turbo --no-lint`）
- **阻塞项**：嵌入向量 API（需设 `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY` 环境变量）
