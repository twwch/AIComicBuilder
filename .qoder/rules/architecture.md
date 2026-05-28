# 项目架构约束

- src/lib/ai/providers/ 下的文件必须遵循现有 Provider 接口模式（implements VideoProvider）
- 新增视频模型必须同时修改 route.ts（模型列表）、model-limits.ts（时长限制）、对应 provider.ts 三个文件
- 不得修改 core/ 目录下的基础设施代码，除非获得架构师批准
- 修改范围必须最小化——只改需要改的，不"顺手"优化周边代码
- 遵循项目现有的代码风格和设计模式，不进行未授权的重构
- 不得引入新的 npm 依赖，除非在 Spec 中明确声明
