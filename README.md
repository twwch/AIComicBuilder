# AI Comic Builder

AI 驱动的漫剧生成器 — 从剧本到动画视频的全自动流水线。

## 功能特性

- **剧本创作** — 手动编写或 AI 辅助生成剧本
- **角色提取** — AI 自动从剧本中提取角色并生成详细视觉描述
- **角色三视图** — 为每个角色生成参考图，确保后续帧画面一致性
- **智能分镜** — AI 将剧本拆解为专业镜头列表（含构图、灯光、运镜指令）
- **首尾帧生成** — 为每个镜头生成起始帧和结束帧关键画面
- **视频生成** — 基于首尾帧插值生成动画视频片段
- **视频合成** — 将所有片段拼接为完整动画，支持字幕烧录
- **资源下载** — 支持最终视频下载及全部素材打包下载
- **多语言** — 中文 / English / 日本語 / 한국어
- **多模型** — 支持 OpenAI、Gemini、Seedance 等多家 AI 供应商，可按项目配置

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 前端 | React 19, Tailwind CSS 4, Zustand, Base UI |
| 国际化 | next-intl |
| 数据库 | SQLite + Drizzle ORM |
| AI 文本 | OpenAI / Gemini (via AI SDK) |
| AI 图像 | OpenAI DALL-E / Gemini Imagen |
| AI 视频 | Seedance (Volcengine Ark) |
| 视频处理 | FFmpeg (fluent-ffmpeg) |
| 包管理 | pnpm |

## 快速开始

### 环境要求

- Node.js 18+
- pnpm
- FFmpeg（视频合成功能需要）

### 安装

```bash
pnpm install
```

### 配置

复制 `.env.example` 为 `.env`，填写至少一个 AI 供应商的 API Key：

```env
# OpenAI
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1

# Google Gemini
GEMINI_API_KEY=

# Seedance (视频生成)
SEEDANCE_API_KEY=
SEEDANCE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDANCE_IMAGE_MODEL=doubao-seedream-5-0-260128
SEEDANCE_MODEL=doubao-seedance-1-5-pro-250528
```

### 初始化数据库

```bash
pnpm drizzle-kit push
```

### 启动

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

## Docker 部署

项目现在支持直接用 Docker Compose 部署，适合没有本机 `pnpm` / `ffmpeg` 环境的服务器。

### 环境准备

复制 `.env.example` 为 `.env`，至少配置一个文本模型的 API Key：

```bash
cp .env.example .env
```

可选调整：

- `APP_PORT`：宿主机暴露端口，默认 `3000`
- `NEXT_PUBLIC_APP_URL`：对外访问地址

### 启动容器

```bash
docker compose up -d --build
```

### 查看状态

```bash
docker compose ps
docker logs -f aicomicbuilder
```

### 停止容器

```bash
docker compose down
```

SQLite 数据库会持久化到 `./data/`，生成素材会持久化到 `./uploads/`。

## 生成流水线

```
剧本输入 → 剧本解析 → 角色提取 → 角色三视图
                                      ↓
                                   智能分镜
                                      ↓
                              首尾帧生成（逐镜头）
                                      ↓
                              视频生成（逐镜头）
                                      ↓
                                 视频合成 + 字幕
```

每个阶段支持单独触发或批量生成，用户可完全控制流水线节奏。

## 项目结构

```
src/
├── app/
│   ├── [locale]/                # i18n 路由
│   │   ├── (dashboard)/         # 项目列表
│   │   ├── project/[id]/        # 项目编辑器
│   │   │   ├── script/          # 剧本编辑
│   │   │   ├── characters/      # 角色管理
│   │   │   ├── storyboard/      # 分镜面板
│   │   │   └── preview/         # 预览 & 合成
│   │   └── settings/            # 模型配置
│   └── api/                     # API 路由
├── components/
│   ├── ui/                      # 基础 UI 组件
│   ├── editor/                  # 编辑器组件
│   └── settings/                # 设置组件
├── lib/
│   ├── ai/                      # AI 供应商 & Prompt
│   ├── pipeline/                # 生成流水线
│   ├── db/                      # 数据库 Schema
│   └── video/                   # FFmpeg 处理
└── stores/                      # Zustand 状态管理
```

## 数据模型

- **Project** — 项目（剧本、状态）
- **Character** — 角色（名称、描述、参考图）
- **Shot** — 镜头（序号、提示词、时长、首尾帧、视频）
- **Dialogue** — 对白（角色、文本、音频）
- **Task** — 后台任务队列

## 界面截图

| 项目列表 | 剧本生成 |
|:---:|:---:|
| ![项目列表](images/demo/list.png) | ![剧本生成](images/demo/剧本生成.png) |

| 角色解析 | 分镜 |
|:---:|:---:|
| ![角色解析](images/demo/角色解析.png) | ![分镜](images/demo/分镜.png) |

| 预览 | 模型配置 |
|:---:|:---:|
| ![预览](images/demo/预览.png) | ![模型配置](images/demo/模型配置.png) |

## Demo

https://ladr-1258957911.cos.ap-guangzhou.myqcloud.com/jadeai/demo1.mp4

<video src="https://ladr-1258957911.cos.ap-guangzhou.myqcloud.com/jadeai/demo1.mp4" controls width="100%"></video>

## License

[Apache License 2.0](./LICENSE)
