# public-apis/public-apis 分析记录

仓库地址：https://github.com/public-apis/public-apis

## 概览

`public-apis/public-apis` 是一个人工维护的公共 API 目录仓库，本质上是一个大型 README 数据集，而不是一个可运行的软件项目。

- 描述：`A collective list of free APIs`
- Star：约 `432k+`
- Fork：约 `47k+`
- License：MIT
- 默认分支：`master`
- 主要语言标记：Python，但核心内容是 Markdown/API 列表
- README 规模：约 `198k` 字符
- API 条目数：约 `1458`
- 分类数：`51`

## 内容结构

README 主要由分类标题和表格组成。

分类示例：

- Animals
- Anime
- Art & Design
- Authentication & Authorization
- Blockchain
- Books
- Business
- Cloud Storage & File Sharing
- Cryptocurrency
- Development
- Finance
- Food & Drink
- Games & Comics
- Geocoding
- Government
- Health
- Machine Learning
- News
- Open Data
- Open Source Projects
- Security
- Shopping
- Social
- Sports & Fitness
- Text Analysis
- Transportation
- Video
- Weather

常见表格字段：

```md
| API | Description | Auth | HTTPS | CORS |
```

新版 README 顶部也包含 APILayer 推广区：

```md
| API | Description | Call this API |
```

## 适合用途

- API 发现入口
- 数据源索引
- 开发者工具推荐库
- API 市场/目录产品参考
- 自动化爬取公共 API 元数据
- 构建 API 检索、筛选、分类系统
- 给 AI Agent 提供工具/API 候选集

## 不适合用途

- 稳定 API 网关
- 实时可用性保证来源
- 安全可信的生产依赖清单
- 自动调用 API 的唯一依据

## 优点

- 覆盖面广，分类完整
- 社区维护多年，知名度极高
- 格式相对统一，容易解析
- API 条目包含认证、HTTPS、CORS 等基本元信息
- 适合做数据集、知识库、API 推荐系统

## 风险与问题

- README 人工维护，数据可能过期
- API 可用性不能保证
- 免费 API 常有限流、地域限制、认证变更
- 安全审查不足，不能默认信任所有 API
- 部分 API 文档链接可能失效
- 不是结构化 JSON 数据源，解析 Markdown 有维护成本
- 开放 issue 很多，说明维护压力较大

## 推荐集成方式

不要让应用实时读取 README。建议做一层同步、清洗和验证。

流程：

1. 定期拉取 README
2. 解析 `### Category`
3. 解析 Markdown 表格行
4. 标准化为 JSON
5. 做可用性探测
6. 存入数据库或搜索索引
7. 前端或 Agent 通过内部 API 查询

标准化 JSON 示例：

```json
{
  "name": "Example API",
  "category": "Weather",
  "description": "...",
  "auth": "apiKey",
  "https": true,
  "cors": "yes",
  "link": "https://..."
}
```

可用性探测建议：

- HTTP 状态
- 文档是否可访问
- 是否需要 API Key
- 是否有免费额度
- 是否支持 HTTPS
- 是否存在明显安全风险

## 在 AIComicBuilder / Agent 系统中的用途

- 外部 API 工具库推荐
- 自动查找图片、天气、新闻、地理、百科类 API
- 给 Agent 选择工具时提供候选 API
- 作为知识库索引，而不是直接调用来源
- 做一个 API 市场页面，让用户按分类筛选

## 可落地实现

可新增同步脚本，例如：

```bash
pnpm scripts:sync-public-apis
```

脚本职责：

1. 下载 README
2. 解析分类和表格
3. 输出 `data/public-apis.json`
4. 可选写入数据库
5. 暴露 `/api/public-apis` 查询接口

## 结论

`public-apis/public-apis` 价值很高，但它是“公共 API 目录数据集”，不是工程库。最佳使用方式是将它作为外部 API 元数据来源，定期同步、清洗、验证后再用于应用或 Agent 系统。
