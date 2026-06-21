# 分镜页面重设计 Task Plan

## Goal
将分镜页面从「步骤 tab 切换」模式改造为「竖向流水线卡片 + 批量操作面板 + 版本控制」模式。
**核心约束：只改 UI 交互，所有生成逻辑/API 调用/提示词不改。**

## Files Modified
- `src/components/editor/shot-card.tsx` — 分镜卡片（重构完成）
- `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx` — 页面主体
- `src/components/editor/new-version-dialog.tsx` — 新建版本对话框（新增）
- `messages/{zh,en,ja,ko}.json` — i18n 新增版本相关 key

## Phases

### P0-A: 竖向流水线 ShotCard [x] done
重构 ShotCard，移除 activeStep 依赖，改为卡片内部展示完整四步流水线。

**实现情况：**
- 头部（始终可见）：序号 + 缩略图预览 + 场景摘要 + 时长 + 整体进度点 ✅
- 步骤区（始终可见，可折叠）：
  - Step 1「文本」：显示场景描述摘要，重新生成按钮 ✅
  - Step 2「帧」：显示首/尾帧缩略图（keyframe）或参考帧（reference），生成帧按钮 ✅
  - Step 3「视频提示词」：显示提示词摘要，重新生成提示词按钮 ✅
  - Step 4「视频」：显示视频缩略图或未生成状态，生成视频按钮 ✅
- 每步状态：✓(绿) / ○(灰) / ⟳(动画) / ✗(红) ✅
- 底部：完整文本编辑区（可折叠展开）✅
- 历史版本切换箭头（帧/视频资产）✅

**Props 变更（与计划一致）：**
- 移除 `activeStep` ✅
- `batchGenerating*` 系列因页面传参兼容性保留，但卡片内部使用 status 字段判断
- 新增 `videoRatio` prop（从 page 传下来，统一控制）✅

### P0-B: 页面批量操作面板 [x] done
重构 storyboard/page.tsx 顶部控制区。

**实现情况：**
- 版本栏（tabs）：V1 / V2 / ... / [+ 新建版本] ✅
- 批量操作卡片（始终展开，不再是 step-conditional）：
  - 行1：[① 批量生成文本]（text model picker + agent picker）✅
  - 行2：[② 批量生成帧]（image model picker + agent picker）+ [覆盖] ✅
  - 行3：[③ 批量生成视频提示词]（text model picker + agent picker）✅
  - 行4：[④ 批量生成视频]（video model picker + ratio picker）+ [覆盖] ✅
  - 分隔线 ✅
  - [▶ 一键续跑] — 扫描缺失步骤，弹确认框后执行 ✅
- 保留 GenerationModeTab 和下载按钮 ✅
- 字符内联面板 ✅

### P0-C: 一键续跑逻辑 [x] done
在 page.tsx 中实现 handleAutoRun。

**实现情况：**
1. 扫描当前版本所有 shots，统计缺失步骤 ✅
2. 弹出确认 toast/dialog（使用原生 confirm）✅
3. 按顺序执行：缺文本→批量文本，缺帧→批量帧，缺提示词→批量提示词，缺视频→批量视频 ✅
4. 兼容 reference 和 keyframe 两种模式 ✅

### P1: 版本新建对话框 [x] done
点击「+ 新建版本」时显示 Dialog。

**实现情况：**
- 版本名称 input（自动填充日期-V{序号}）✅
- 基于：[当前版本复制] / [从头开始] radio 选择 ✅
- 复制内容 checkboxes（基于当前版本时显示）：文本、图片帧、视频提示词、视频 ✅
- [创建] 调用 shot_split action（与现有逻辑一致）✅
- 组件位置：`src/components/editor/new-version-dialog.tsx` ✅
- 四种语言 i18n 支持 ✅

### P2: 版本对比 [x] done
双栏对比模式。

**实现情况：**
- `VersionCompare` 组件完整重写 ✅
- 版本 A/B 选择器 ✅
- 按序号对齐/原始顺序切换 ✅
- 差异高亮：新增(绿)、删除(红)、修改(橙) ✅
- 变更摘要统计条 ✅
- 分镜头像、视频、提示词、对白、时长、转场对比 ✅
- 真实 per-version 数据获取（新 API：`/api/projects/[id]/versions/[versionId]/shots`） ✅
- 独立加载状态与错误处理 ✅

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| — | — | — |

## Decisions
- `activeStep` prop 从 ShotCard 移除，由卡片自己根据数据状态判断「下一步」
- 批量操作的 model picker 保留在 page 级别（不下沉到卡片）
- videoRatio 在 page 保持全局状态，通过 prop 传给每张卡片的视频生成按钮
- 版本 tab 切换沿用现有 fetchProject(id, versionId) 机制
- `batchGenerating*` props 保留在 ShotCard 中用于外部批量操作的视觉反馈
- 新建版本对话框的复制内容选项为 UI 完整设计，目前全部调用 shot_split 生成
