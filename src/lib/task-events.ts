import { EventEmitter } from "events";

export interface TaskEvent {
  taskId: string;
  type: "progress" | "complete" | "fail";
  data: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

export function emitTaskEvent(taskId: string, type: TaskEvent["type"], data: Record<string, unknown>) {
  emitter.emit(taskId, { taskId, type, data } satisfies TaskEvent);
}

export function onTaskEvent(taskId: string, handler: (event: TaskEvent) => void) {
  emitter.on(taskId, handler);
  return () => emitter.off(taskId, handler);
}

export function removeAllTaskListeners(taskId: string) {
  emitter.removeAllListeners(taskId);
}
