import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { actor, canMutate, isStaff, ensureOrigin } from "./auth";
import { db, id, audit, dataDir, withTransaction } from "./db";
import { normalizeTaskTitle, proposedTitle } from "./ocr/notebook.mjs";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
class NotebookError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const selection = z.object({
  action: z.literal("apply"),
  notebookId: z.string().uuid(),
  revision: z.number().int().positive(),
  projectId: z.string().max(100).default(""),
  goalIds: z.array(z.string().max(100)).max(20).default([]),
  items: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        action: z.enum(["create", "complete"]),
        title: z.string().trim().min(2).max(200),
        taskId: z.string().max(100).default(""),
        taskRevision: z.number().int().positive().optional(),
        allowDuplicate: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(50),
});
async function boundedForm(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new NotebookError("Choose an image.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 11 * 1024 * 1024) {
      await reader.cancel();
      throw new NotebookError("Upload an image up to 10 MB.", 413);
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": req.headers.get("content-type") || "" },
  }).formData();
}
export async function notebookRoute(req: Request) {
  try {
    const a = await actor();
    if (!a) return fail("Sign in to continue.", 401);
    if (!isStaff(a))
      return fail("Notebook tasks are available to workspace members.", 403);
    const url = new URL(req.url),
      notebookId = url.searchParams.get("id");
    if (req.method === "GET") {
      if (!notebookId) {
        const rows = await db()
          .prepare(
            "SELECT id,original_name,status,error,revision,created_at FROM task_notebooks WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30",
          )
          .all(a.tenantId, a.id);
        return NextResponse.json({
          notebooks: rows,
          enabled: process.env.HUMETO_OCR_ENABLED === "true",
        });
      }
      const job = await db()
        .prepare(
          "SELECT id,original_name,status,error,warnings,revision,created_at,stored_name,mime_type FROM task_notebooks WHERE id=? AND tenant_id=? AND user_id=?",
        )
        .get(notebookId, a.tenantId, a.id);
      if (!job) return fail("Notebook not found.", 404);
      if (url.searchParams.has("source")) {
        if (basename(job.stored_name) !== job.stored_name)
          return fail("Source unavailable.", 404);
        return new NextResponse(
          new Uint8Array(
            await readFile(join(dataDir, "uploads", job.stored_name)),
          ),
          {
            headers: {
              "Content-Type": job.mime_type,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Disposition": 'inline; filename="notebook-source"',
            },
          },
        );
      }
      const lines = await db()
        .prepare(
          "SELECT * FROM task_notebook_lines WHERE notebook_id=? ORDER BY line_index",
        )
        .all(notebookId);
      const page = await db()
        .prepare(
          "SELECT width,height,method FROM task_notebook_pages WHERE notebook_id=?",
        )
        .get(notebookId);
      const tasks = await db()
        .prepare(
          "SELECT id,title,stage,revision FROM tasks WHERE tenant_id=? ORDER BY created_at DESC",
        )
        .all(a.tenantId);
      return NextResponse.json({
        notebook: {
          id: job.id,
          name: job.original_name,
          status: job.status,
          error: job.error,
          warnings: job.warnings,
          revision: job.revision,
        },
        page: page || null,
        lines: lines.map((line) => ({
          ...line,
          title: proposedTitle(line.source_text),
          matches: tasks
            .filter(
              (task) =>
                normalizeTaskTitle(task.title) ===
                normalizeTaskTitle(proposedTitle(line.source_text)),
            )
            .map((task) => ({
              id: task.id,
              title: task.title,
              stage: task.stage,
              revision: task.revision,
            })),
        })),
      });
    }
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return fail("A writable subscription is required.", 403);
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (process.env.HUMETO_OCR_ENABLED !== "true")
        return fail("Local document reading is disabled.", 503);
      const form = await boundedForm(req),
        file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
        return fail("Choose a PNG or JPEG up to 10 MB.");
      const bytes = Buffer.from(await file.arrayBuffer()),
        png = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpeg)
        return fail("Only PNG and JPEG image contents are supported.");
      const nid = id(),
        stored = "notebook-" + nid + (png ? ".png" : ".jpg");
      await mkdir(join(dataDir, "uploads"), { recursive: true, mode: 0o700 });
      await writeFile(join(dataDir, "uploads", stored), bytes, { mode: 0o600 });
      try {
        await withTransaction(async () => {
          await db()
            .prepare("SELECT id FROM tenants WHERE id=? FOR UPDATE")
            .get(a.tenantId);
          const { count } = (await db()
            .prepare(
              "SELECT count(*)::int AS count FROM task_notebooks WHERE tenant_id=? AND user_id=?",
            )
            .get(a.tenantId, a.id)) as { count: number };
          if (count >= 100)
            throw new NotebookError(
              "This local notebook workspace has reached its 100-image limit.",
            );
          const { pending } = (await db()
            .prepare(
              "SELECT count(*)::int AS pending FROM task_notebooks WHERE tenant_id=? AND status IN ('queued','running')",
            )
            .get(a.tenantId)) as { pending: number };
          if (pending >= 20)
            throw new NotebookError(
              "This workspace already has 20 pending notebook images. Try later.",
            );
          await db()
            .prepare(
              "INSERT INTO task_notebooks(id,tenant_id,user_id,original_name,stored_name,mime_type,source_sha256) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              nid,
              a.tenantId,
              a.id,
              basename(file.name).slice(0, 180),
              stored,
              png ? "image/png" : "image/jpeg",
              createHash("sha256").update(bytes).digest("hex"),
            );
          await audit(
            a.tenantId,
            a.id,
            "uploaded",
            "task_notebook",
            nid,
            "Uploaded a private notebook for review",
          );
        });
      } catch (e) {
        await unlink(join(dataDir, "uploads", stored));
        throw e;
      }
      return NextResponse.json({ id: nid });
    }
    const raw = await req.json();
    if (raw.action === "retry") {
      const v = z
        .object({
          notebookId: z.string().uuid(),
          revision: z.number().int().positive(),
        })
        .parse(raw);
      const result = await db()
        .prepare(
          "UPDATE task_notebooks SET status='queued',attempts=0,error='',revision=revision+1,updated_at=now() WHERE id=? AND tenant_id=? AND user_id=? AND revision=? AND status='failed'",
        )
        .run(v.notebookId, a.tenantId, a.id, v.revision);
      return result.changes
        ? NextResponse.json({ ok: true })
        : fail("Notebook changed. Refresh before retrying.", 409);
    }
    const v = selection.parse(raw);
    if (new Set(v.items.map((x) => x.lineId)).size !== v.items.length)
      return fail("Choose each source line once.");
    return await withTransaction(async () => {
      // Serialize review batches and title-based duplicate checks within this workspace.
      await db()
        .prepare("SELECT id FROM tenants WHERE id=? FOR UPDATE")
        .get(a.tenantId);
      const job = await db()
        .prepare(
          "SELECT * FROM task_notebooks WHERE id=? AND tenant_id=? AND user_id=? FOR UPDATE",
        )
        .get(v.notebookId, a.tenantId, a.id);
      if (!job) throw new NotebookError("Notebook not found.", 404);
      if (job.status !== "completed" || job.revision !== v.revision)
        throw new NotebookError(
          "Notebook changed. Refresh before applying.",
          409,
        );
      if (
        v.projectId &&
        !(await db()
          .prepare("SELECT id FROM projects WHERE id=? AND tenant_id=?")
          .get(v.projectId, a.tenantId))
      )
        throw new NotebookError("Project not found.", 404);
      for (const gid of new Set(v.goalIds))
        if (
          !(await db()
            .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
            .get(gid, a.tenantId))
        )
          throw new NotebookError("Goal not found.", 404);
      const taskIds = new Set<string>();
      let created = 0,
        completed = 0;
      for (const item of v.items) {
        const line = await db()
          .prepare(
            "SELECT * FROM task_notebook_lines WHERE id=? AND notebook_id=? FOR UPDATE",
          )
          .get(item.lineId, job.id);
        if (!line || line.applied_at)
          throw new NotebookError(
            "A source line was already used or is unavailable. Refresh.",
            409,
          );
        let taskId = item.taskId;
        if (item.action === "create") {
          const tasks = await db()
            .prepare("SELECT title FROM tasks WHERE tenant_id=?")
            .all(a.tenantId);
          if (
            !item.allowDuplicate &&
            tasks.some(
              (task) =>
                normalizeTaskTitle(task.title) ===
                normalizeTaskTitle(item.title),
            )
          )
            throw new NotebookError(
              "A task with this title already exists. Choose it or explicitly allow a duplicate.",
              409,
            );
          taskId = id();
          await db()
            .prepare(
              "INSERT INTO tasks(id,tenant_id,title,assignee,last_actor_id,project_id) VALUES(?,?,?,?,?,?)",
            )
            .run(taskId, a.tenantId, item.title, a.name, a.id, v.projectId);
          await db()
            .prepare(
              "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES(?,'task',?,?,?)",
            )
            .run(a.tenantId, taskId, a.id, a.id);
          for (const gid of new Set(v.goalIds))
            await db()
              .prepare(
                "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
              )
              .run(a.tenantId, taskId, gid);
          created++;
        } else {
          if (!taskId || !item.taskRevision || taskIds.has(taskId))
            throw new NotebookError(
              "Choose a different current task for each completion.",
            );
          const task = await db()
            .prepare(
              "SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE",
            )
            .get(taskId, a.tenantId);
          if (
            !task ||
            task.revision !== item.taskRevision ||
            task.stage === "Done" ||
            task.title !== item.title
          )
            throw new NotebookError(
              "A selected task changed or is already complete. Refresh.",
              409,
            );
          await db()
            .prepare(
              "UPDATE tasks SET stage='Done',revision=revision+1,last_actor_id=? WHERE id=? AND tenant_id=?",
            )
            .run(a.id, taskId, a.tenantId);
          completed++;
        }
        taskIds.add(taskId);
        await db()
          .prepare(
            "UPDATE task_notebook_lines SET task_id=?,action=?,reviewed_title=?,applied_at=now() WHERE id=?",
          )
          .run(
            taskId,
            item.action === "create" ? "created" : "completed",
            item.title,
            line.id,
          );
        await audit(
          a.tenantId,
          a.id,
          item.action === "create"
            ? "created_from_notebook"
            : "completed_from_notebook",
          "task",
          taskId,
          "Explicit notebook review applied",
        );
      }
      await db()
        .prepare(
          "UPDATE task_notebooks SET revision=revision+1,updated_at=now() WHERE id=?",
        )
        .run(job.id);
      return NextResponse.json({ created, completed });
    });
  } catch (e) {
    if (e instanceof NotebookError) return fail(e.message, e.status);
    if (e instanceof z.ZodError)
      return fail(e.issues[0]?.message || "Invalid input.");
    if (e instanceof Error && e.message === "ORIGIN")
      return fail("Origin not allowed.", 403);
    console.error("Notebook request failed.");
    return fail("Unable to complete notebook request.", 500);
  }
}
