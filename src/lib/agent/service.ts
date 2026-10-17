import { withTransaction } from "../db";
import "server-only";
import { db, id, audit } from "../db";
import { tasks } from "../repository";
import {
  dayKey,
  dayOffset,
  resolveSchedule,
  validDay,
  validTimezone,
} from "./dates";
import { interpret, modelStatus } from "./model";
import type { Actor } from "../types";
import type {
  ActionPayload,
  AgentMessage,
  AgentState,
  Intent,
  TaskSummary,
} from "./contracts";
export class AgentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function ownedThread(a: Actor, threadId: string) {
  const thread = await db()
    .prepare(
      "SELECT * FROM agent_threads WHERE id=? AND tenant_id=? AND user_id=?",
    )
    .get(threadId, a.tenantId, a.id);
  if (!thread) throw new AgentError("Conversation not found.", 404);
  return thread;
}
function actionCard(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    status: String(row.status),
    payload: JSON.parse(String(row.payload)) as ActionPayload,
    taskId: row.task_id ? String(row.task_id) : null,
    expiresAt: Number(row.expires_at),
  };
}
export async function agentState(
  a: Actor,
  threadId: string | null,
  timezone: string,
  summaryOnly = false,
): Promise<AgentState> {
  validTimezone(timezone);
  const threads = summaryOnly
    ? []
    : ((await db()
        .prepare(
          "SELECT id,title,updated_at FROM agent_threads WHERE tenant_id=? AND user_id=? ORDER BY updated_at DESC,_rowid DESC LIMIT 50",
        )
        .all(a.tenantId, a.id)) as unknown as AgentState["threads"]);
  const selected = summaryOnly ? null : threadId || threads[0]?.id || null;
  if (selected) await ownedThread(a, selected);
  const messages = selected
    ? ((await Promise.all(
        (
          await db()
            .prepare(
              "SELECT id,role,content,result,created_at FROM agent_messages WHERE thread_id=? AND tenant_id=? ORDER BY _rowid DESC LIMIT 200",
            )
            .all(selected, a.tenantId)
        )
          .reverse()
          .map(async (row) => {
            const result = JSON.parse(String(row.result));
            if (result.action) {
              const action = await db()
                .prepare(
                  "SELECT * FROM agent_actions WHERE id=? AND tenant_id=? AND user_id=?",
                )
                .get(result.action.id, a.tenantId, a.id);
              if (action) result.action = actionCard(action);
              else delete result.action;
            }
            return { ...row, result };
          }),
      )) as unknown as AgentMessage[])
    : [];
  const own = (await tasks(a)).filter(
    (t) => t.assignee === a.name && t.stage !== "Done",
  );
  const quadrants = [0, 0, 0, 0];
  for (const task of own)
    quadrants[task.important ? (task.urgent ? 0 : 1) : task.urgent ? 2 : 3]++;
  const reminders = (
    await db()
      .prepare(
        "SELECT r.id,r.task_id,t.title,r.remind_at,r.timezone FROM task_reminders r JOIN tasks t ON t.id=r.task_id AND t.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.user_id=? AND r.status='scheduled' AND t.stage!='Done' ORDER BY r.remind_at LIMIT 100",
      )
      .all(a.tenantId, a.id)
  ).map((r) => ({
    ...r,
    due: Date.parse(String(r.remind_at)) <= Date.now(),
  })) as unknown as AgentState["reminders"];
  return {
    threads,
    threadId: selected,
    messages,
    reminders,
    counts: {
      pending: own.length,
      important: own.filter((t) => t.important).length,
      urgent: own.filter((t) => t.urgent).length,
      quadrants,
    },
    ...modelStatus(),
  };
}
async function writeMessage(
  a: Actor,
  threadId: string,
  role: string,
  content: string,
  result: unknown = {},
  clientKey: string | null = null,
) {
  const mid = id();
  await db()
    .prepare(
      "INSERT INTO agent_messages(id,tenant_id,thread_id,role,content,result,client_key) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      mid,
      a.tenantId,
      threadId,
      role,
      content,
      JSON.stringify(result),
      clientKey,
    );
  await db()
    .prepare(
      "UPDATE agent_threads SET updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id=? AND tenant_id=? AND user_id=?",
    )
    .run(threadId, a.tenantId, a.id);
  return mid;
}
async function selectedTasks(a: Actor, intent: Intent, timezone: string) {
  const today = dayKey(new Date(), timezone);
  return (await tasks(a)).filter(
    (t) =>
      (intent.scope === "team" || t.assignee === a.name) &&
      (intent.important === null || !!t.important === intent.important) &&
      (intent.urgent === null || !!t.urgent === intent.urgent) &&
      (intent.filter === "all" || t.stage !== "Done") &&
      (intent.filter === "important"
        ? !!t.important
        : intent.filter === "urgent"
          ? !!t.urgent
          : intent.filter === "overdue"
            ? !!t.due_date && t.due_date < today
            : intent.filter === "today"
              ? t.due_date === today
              : intent.filter === "tomorrow"
                ? t.due_date === dayOffset(new Date(), timezone, 1)
                : true),
  );
}
async function plan(
  a: Actor,
  intent: Intent,
  timezone: string,
  message: string,
  threadId: string,
  history: AgentMessage[],
) {
  if (intent.kind === "help")
    return {
      content:
        "I can create a task, show pending priorities, mark a task done, change its importance or urgency, or schedule an in-app reminder. Try: ‘Create a task to create a group with the new prospect team and remind me tomorrow.’ I record the task; I don’t create external groups or send messages.",
      result: {},
    };
  if (intent.kind === "list") {
    const list = await selectedTasks(a, intent, timezone);
    const priority = [
      intent.important === null
        ? ""
        : intent.important
          ? "important"
          : "not important",
      intent.urgent === null ? "" : intent.urgent ? "urgent" : "not urgent",
    ]
      .filter(Boolean)
      .join(" and ");
    const qualifier =
      priority ||
      (["important", "urgent"].includes(intent.filter) ? intent.filter : "");
    const dateFilter =
      intent.filter === "overdue"
        ? " overdue"
        : ["today", "tomorrow"].includes(intent.filter)
          ? ` due ${intent.filter}`
          : "";
    const noun = list.length === 1 ? "task" : "tasks";
    const label =
      intent.filter === "all"
        ? `${qualifier ? qualifier + " " : ""}${noun} (including completed)`
        : `${qualifier ? qualifier + " " : ""}pending ${noun}${dateFilter}`;
    return {
      content: `${intent.scope === "team" ? "Your workspace has" : "You have"} ${list.length} ${label}.${list.length > 10 ? " Showing the first 10; the count includes all matching tasks." : ""}`,
      result: {
        tasks: list.slice(0, 10),
        total: list.length,
        scope: intent.scope,
      },
    };
  }
  let task: TaskSummary | undefined;
  if (intent.kind === "update") {
    const all = await tasks(a);
    const target = (intent.target || "").trim().toLowerCase();
    let matches = target
      ? all.filter((t) => t.id === target || t.title.toLowerCase() === target)
      : [];
    if (
      !matches.length &&
      /^(it|that|that task|this|this task|last task)$/.test(target)
    ) {
      const last = [...history]
        .reverse()
        .find(
          (m) => m.role === "assistant" && (m.result.action || m.result.tasks),
        );
      const taskId =
        last?.result.action?.status === "applied"
          ? last.result.action.taskId
          : last?.result.tasks?.length === 1
            ? last.result.tasks[0].id
            : null;
      matches = all.filter((t) => t.id === taskId);
    } else if (!matches.length && target.length >= 3)
      matches = all.filter((t) => t.title.toLowerCase().includes(target));
    if (matches.length !== 1)
      return {
        content: matches.length
          ? "More than one task matches. Please use the exact task title or ID so I change the right one."
          : "I couldn’t identify one task. Please give its exact title or ID, or ask me to list pending tasks first.",
        result: { tasks: matches.slice(0, 10), total: matches.length },
      };
    task = matches[0];
    if (
      intent.stage === null &&
      intent.important === null &&
      intent.urgent === null &&
      !intent.dueDate &&
      !intent.reminder
    )
      return {
        content:
          "What would you like to change: status, importance, urgency, due date or reminder?",
        result: { tasks: [task] },
      };
  }
  let title = (task?.title || intent.title || "").trim();
  if (title.length < 2 || title.length > 200)
    throw new AgentError("Give the task a title between 2 and 200 characters.");
  // A mention of a reminder without a recognized date must never silently become a task without one.
  if (
    /\bremind me\b/i.test(message.replace(/["“][^"”]+["”]/g, "")) &&
    !intent.reminder
  )
    throw new AgentError(
      "When should I remind you? Try tomorrow at 9 AM, or in 30 minutes.",
    );
  let reminderAt: string | null = null;
  let dueDate = task?.due_date || "";
  try {
    if (intent.reminder)
      reminderAt = resolveSchedule(intent.reminder, timezone);
    if (intent.dueDate) {
      const value = intent.dueDate;
      const absolute = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      dueDate =
        absolute ||
        (/\btomorrow\b/i.test(value)
          ? dayOffset(new Date(), timezone, 1)
          : /\btoday\b/i.test(value)
            ? dayKey(new Date(), timezone)
            : dayKey(new Date(resolveSchedule(value, timezone)), timezone));
    }
    if (!dueDate && reminderAt)
      dueDate = dayKey(new Date(reminderAt), timezone);
  } catch (e) {
    throw new AgentError((e as Error).message);
  }
  if (dueDate && !validDay(dueDate))
    throw new AgentError("Please use a valid due date.");
  const payload: ActionPayload = {
    kind: task ? "update" : "create",
    title,
    taskId: task?.id || null,
    revision: task?.revision || null,
    stage: intent.stage || task?.stage || "To do",
    important: intent.important ?? !!task?.important,
    urgent: intent.urgent ?? !!task?.urgent,
    dueDate,
    reminderAt,
    timezone,
    assignee: task?.assignee || a.name,
    reminderOnly:
      !!task &&
      !!reminderAt &&
      intent.stage === null &&
      intent.important === null &&
      intent.urgent === null &&
      !intent.dueDate,
  };
  if (payload.reminderAt && payload.stage === "Done")
    throw new AgentError(
      "This task is complete. Move it back to To do before scheduling a reminder.",
    );
  const aid = id(),
    expiresAt = Date.now() + 3600000;
  await db()
    .prepare(
      "INSERT INTO agent_actions(id,tenant_id,user_id,thread_id,payload,expires_at) VALUES(?,?,?,?,?,?)",
    )
    .run(aid, a.tenantId, a.id, threadId, JSON.stringify(payload), expiresAt);
  return {
    content: task
      ? "Review this task update. Nothing changes until you apply it."
      : "Here’s the task I’ll create. Review the details, then apply it. External group creation and messaging are not performed.",
    result: {
      action: { id: aid, status: "pending", payload, taskId: null, expiresAt },
    },
  };
}
export async function sendMessage(
  a: Actor,
  input: {
    threadId?: string;
    message: string;
    clientKey: string;
    timezone: string;
  },
) {
  const { message, clientKey, timezone } = input;
  validTimezone(timezone);
  let threadId = input.threadId;
  if (threadId) {
    await ownedThread(a, threadId);
    const previous = await db()
      .prepare(
        "SELECT id FROM agent_messages WHERE thread_id=? AND tenant_id=? AND client_key=?",
      )
      .get(threadId, a.tenantId, clientKey);
    if (previous) return await agentState(a, threadId, timezone);
  }
  const recent = (await db()
    .prepare(
      "SELECT COUNT(*) AS n FROM agent_messages m JOIN agent_threads t ON t.id=m.thread_id WHERE t.tenant_id=? AND t.user_id=? AND m.role='user' AND m.created_at>to_char(clock_timestamp() AT TIME ZONE 'UTC' - INTERVAL '1 minute', 'YYYY-MM-DD HH24:MI:SS')",
    )
    .get(a.tenantId, a.id)) as {
    n: number;
  };
  if (recent.n >= 20)
    throw new AgentError(
      "Please pause for a moment before sending more messages.",
      429,
    );
  const history = threadId
    ? (await agentState(a, threadId, timezone)).messages
    : [];
  const intent = await interpret(message, {
    timezone,
    now: new Date().toISOString(),
    tasks: await tasks(a),
    history: history.map((m) => ({ role: m.role, content: m.content })),
  });
  const d = db();
  const requestedThreadId = threadId;
  try {
    const transactionResult = await withTransaction(async () => {
      threadId = requestedThreadId;
      if (!threadId) {
        // A retried first message reuses the same thread rather than creating duplicate proposals.
        const previous = await d
          .prepare(
            "SELECT m.thread_id FROM agent_messages m JOIN agent_threads t ON t.id=m.thread_id WHERE m.client_key=? AND t.tenant_id=? AND t.user_id=?",
          )
          .get(clientKey, a.tenantId, a.id);
        if (previous) {
          return await agentState(a, String(previous.thread_id), timezone);
        }
        threadId = id();
        await d
          .prepare(
            "INSERT INTO agent_threads(id,tenant_id,user_id,title) VALUES(?,?,?,?)",
          )
          .run(threadId, a.tenantId, a.id, message.slice(0, 65));
      } else if (
        await d
          .prepare(
            "SELECT id FROM agent_messages WHERE thread_id=? AND client_key=?",
          )
          .get(threadId, clientKey)
      ) {
        return await agentState(a, threadId, timezone);
      }
      const outcome = await plan(
        a,
        intent,
        timezone,
        message,
        threadId,
        history,
      );
      await writeMessage(a, threadId, "user", message, {}, clientKey);
      await writeMessage(a, threadId, "assistant", outcome.content, {
        ...outcome.result,
        engine: modelStatus().engine,
      });
    });
    if (transactionResult !== undefined) return transactionResult;
  } catch (e) {
    throw e;
  }
  return await agentState(a, threadId || null, timezone);
}
export async function decide(
  a: Actor,
  actionId: string,
  decision: "apply" | "cancel",
  timezone: string,
) {
  const d = db();
  let threadId = "";
  try {
    const transactionResult = await withTransaction(async () => {
      const row = await d
        .prepare(
          "SELECT * FROM agent_actions WHERE id=? AND tenant_id=? AND user_id=?",
        )
        .get(actionId, a.tenantId, a.id);
      if (!row) throw new AgentError("Action not found.", 404);
      threadId = String(row.thread_id);
      await ownedThread(a, threadId);
      if (row.status !== "pending") {
        return await agentState(a, threadId, timezone);
      }
      if (Number(row.expires_at) < Date.now())
        throw new AgentError(
          "This review expired. Please ask again for a fresh task proposal.",
          409,
        );
      const p = JSON.parse(String(row.payload)) as ActionPayload;
      let taskId = p.taskId;
      if (decision === "apply") {
        if (p.kind === "create") {
          taskId = id();
          await d
            .prepare(
              "INSERT INTO tasks(id,tenant_id,title,stage,important,urgent,due_date,assignee,last_actor_id) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              taskId,
              a.tenantId,
              p.title,
              p.stage,
              Number(p.important),
              Number(p.urgent),
              p.dueDate,
              p.assignee,
              a.id,
            );
        } else {
          const result = await d
            .prepare(
              "UPDATE tasks SET stage=?,important=?,urgent=?,due_date=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
            )
            .run(
              p.stage,
              Number(p.important),
              Number(p.urgent),
              p.dueDate,
              a.id,
              p.taskId,
              a.tenantId,
              p.revision,
            );
          if (result.changes !== 1)
            throw new AgentError(
              "The task changed since this proposal. Ask again to review the latest version.",
              409,
            );
        }
        if (p.reminderAt && p.stage !== "Done") {
          await d
            .prepare(
              "UPDATE task_reminders SET status='replaced' WHERE tenant_id=? AND user_id=? AND task_id=? AND status='scheduled'",
            )
            .run(a.tenantId, a.id, taskId);
          await d
            .prepare(
              "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,?,?,?,?,?)",
            )
            .run(id(), a.tenantId, a.id, taskId, p.reminderAt, p.timezone);
        }
        await audit(
          a.tenantId,
          a.id,
          p.kind === "create" ? "created" : "updated",
          "task",
          taskId!,
          "Applied assistant task action",
        );
      }
      await d
        .prepare(
          "UPDATE agent_actions SET status=?,task_id=? WHERE id=? AND tenant_id=? AND user_id=?",
        )
        .run(
          decision === "apply" ? "applied" : "cancelled",
          taskId,
          actionId,
          a.tenantId,
          a.id,
        );
      await writeMessage(
        a,
        threadId,
        "assistant",
        decision === "cancel"
          ? "Cancelled. No task was changed."
          : `${p.kind === "create" ? "Created" : "Updated"}: ${p.title}.${p.reminderAt ? " Your in-app reminder is scheduled. It will appear here and in the reminder inbox when due; external notifications are not connected." : ""}`,
        {
          tasks:
            decision === "apply"
              ? (await tasks(a)).filter((t) => t.id === taskId)
              : [],
        },
      );
    });
    if (transactionResult !== undefined) return transactionResult;
  } catch (e) {
    throw e;
  }
  return await agentState(a, threadId || null, timezone);
}
export async function dismissReminder(a: Actor, reminderId: string) {
  const result = await db()
    .prepare(
      "UPDATE task_reminders SET status='dismissed' WHERE id=? AND tenant_id=? AND user_id=?",
    )
    .run(reminderId, a.tenantId, a.id);
  if (!result.changes) throw new AgentError("Reminder not found.", 404);
}
