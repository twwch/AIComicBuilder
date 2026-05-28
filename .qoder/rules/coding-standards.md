# 编码规范

- TypeScript strict 模式，不允许 any 类型
- 所有 API 调用必须有错误处理和超时设置
- 命名规范：模型 ID 格式为 {family}-{version}-{type}（如 happyhorse-1.0-t2v）
- 所有异步操作使用 async/await，不使用 .then() 链
- 修改后必须通过 pnpm build + pnpm lint
- 错误信息不得暴露内部实现细节
