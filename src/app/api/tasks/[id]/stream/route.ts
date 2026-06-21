import { db } from "@/lib/db";
import { tasks, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { onTaskEvent } from "@/lib/task-events";

export const dynamic = "force-dynamic";
export const maxDuration = 1800;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [row] = await db
    .select({ task: tasks })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(projects.userId, userId)));

  if (!row) {
    return new Response("Not found", { status: 404 });
  }

  let cleanup: (() => void) | undefined;

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(`data: ${JSON.stringify({ type: "connected", taskId: id })}\n\n`);

      cleanup = onTaskEvent(id, (event) => {
        try {
          controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "complete" || event.type === "fail") {
            controller.close();
          }
        } catch {
          // ignore write errors after close
        }
      });

      request.signal.addEventListener("abort", () => {
        cleanup?.();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
