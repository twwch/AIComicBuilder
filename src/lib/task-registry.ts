const controllers = new Map<string, AbortController>();

export function registerTask(taskId: string): AbortController {
  const ac = new AbortController();
  controllers.set(taskId, ac);
  return ac;
}

export function cancelTask(taskId: string): boolean {
  const ac = controllers.get(taskId);
  if (!ac) return false;
  ac.abort();
  controllers.delete(taskId);
  return true;
}

export function unregisterTask(taskId: string) {
  controllers.delete(taskId);
}
