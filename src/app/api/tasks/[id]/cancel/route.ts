import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { cancelTask as cancelTaskRegistry } from "@/lib/task-registry";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [row] = await db
    .select({ task: tasks })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(projects.userId, userId)));

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (row.task.status !== "running") {
    return NextResponse.json({ error: `任务状态 ${row.task.status} 不允许取消` }, { status: 400 });
  }

  // Signal in-memory handler first, then update DB with
  // conditional WHERE to avoid overwriting completed tasks.
  cancelTaskRegistry(id);
  await db
    .update(tasks)
    .set({ status: "cancelled", error: "用户手动取消" })
    .where(and(eq(tasks.id, id), eq(tasks.status, "running")));

  return NextResponse.json({ cancelled: true });
}
