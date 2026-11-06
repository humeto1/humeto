import { Capacitor, registerPlugin } from "@capacitor/core";

type Op = {
  id: string;
  owner: string;
  path: string;
  method: "POST" | "PATCH";
  body: any;
  at: string;
  localId?: string;
  label: string;
};
type Account = {
  cache: Record<string, any>;
  queue: Op[];
  ids: Record<string, string>;
  conflict?: string;
  needsAuth?: boolean;
  conflictServer?: any;
  lastSync?: string;
};
type Store = { active: string | null; accounts: Record<string, Account> };
type Network = (path: string, body?: unknown, method?: string) => Promise<any>;
const Device = registerPlugin<{
  readOffline: () => Promise<{ value?: string }>;
  saveOffline: (options: { value: string }) => Promise<void>;
}>("HumetoDevice");
let store: Store = { active: null, accounts: {} };
let initialized: Promise<void> | null = null;
let tail: Promise<unknown> = Promise.resolve();
let flushing: Promise<void> | null = null;
let offline = false;
const copy = <T>(value: T): T => structuredClone(value);
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("humeto-offline-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read() {
  if (Capacitor.getPlatform() === "android")
    return (await Device.readOffline()).value;
  const db = await database();
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction("state");
      const r = tx.objectStore("state").get("workspace");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function persist() {
  const value = JSON.stringify(store);
  if (Capacitor.getPlatform() === "android") {
    await Device.saveOffline({ value });
    return;
  }
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(value, "workspace");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function initOffline() {
  return (initialized ||= (async () => {
    const value = await read();
    if (value) {
      const parsed = JSON.parse(value);
      if (!parsed.accounts || !("active" in parsed))
        throw Error("Offline storage cannot be read. Your data has been kept.");
      store = parsed;
    }
    emit();
  })());
}
function current() {
  return store.active ? store.accounts[store.active] : undefined;
}
function emit() {
  window.dispatchEvent(new Event("humeto-sync"));
}
export function syncStatus() {
  const a = current();
  return {
    offline,
    pending: a?.queue.length || 0,
    conflict: a?.conflict || "",
    needsAuth: !!a?.needsAuth,
    lastSync: a?.lastSync || "",
    recovery: Object.entries(a?.cache || {})
      .filter(([key]) => key.startsWith("offline-recovery-"))
      .flatMap(([, value]) =>
        (value as Op[]).map((item) => ({ title: item.label, body: item.body })),
      ),
    serverVersion: a?.conflictServer || null,
    canReapply:
      !!a?.queue[0] &&
      a.queue[0].method === "PATCH" &&
      /\/(tasks|task-links|projects|goals)\//.test(a.queue[0].path),
    change: a?.queue[0]
      ? { title: a.queue[0].label, body: copy(a.queue[0].body) }
      : null,
  };
}
export function setConnection(value: boolean) {
  offline = !value;
  emit();
}
async function update<T>(fn: () => T | Promise<T>): Promise<T> {
  await initOffline();
  const job = tail.then(async () => {
    const before = copy(store);
    try {
      const result = await fn();
      await persist();
      emit();
      return result;
    } catch (error) {
      store = before;
      throw error;
    }
  });
  tail = job.catch(() => {});
  return job;
}
export async function lockOffline() {
  await update(() => {
    if (current()) current()!.needsAuth = true;
  });
}
export async function prepareLogin() {
  await update(() => {
    store.active = null;
  });
}
export async function clearOffline() {
  await update(() => {
    if (store.active) delete store.accounts[store.active];
    store.active = null;
  });
}
export const cacheable = (path: string) =>
  path === "/api/mobile" ||
  /^\/api\/(workspace\/(focus|scheduling|task-history|task-storage|planning|task-preferences|task-links)|productivity|milestones|task-activities)(\?|\/|$)/.test(
    path,
  );
export async function cacheResponse(path: string, result: any) {
  if (!cacheable(path)) return;
  await update(() => {
    if (path === "/api/mobile") {
      const owner = result.actor.tenantId + ":" + result.actor.id;
      if (!result.actor.tenantId)
        throw Error("Update the server before using offline mode.");
      store.active = owner;
      store.accounts[owner] ||= { cache: {}, queue: [], ids: {} };
      current()!.needsAuth = false;
    }
    const a = current();
    if (!a || a.needsAuth || a.queue.length) return;
    a.cache[path] = copy(
      path === "/api/workspace/focus"
        ? { ...result, receivedAt: Date.now() }
        : result,
    );
    a.lastSync = new Date().toISOString();
  });
}
export async function cached(path: string) {
  await initOffline();
  await tail;
  const a = current();
  if (!a || a.needsAuth) return undefined;
  return a.cache[path] === undefined ? undefined : copy(a.cache[path]);
}
export function queueable(path: string, method: string, body: any) {
  return (
    ["POST", "PATCH"].includes(method) &&
    /^\/api\/workspace\/(tasks|task-links|task-storage|projects|goals|focus)(\/[A-Za-z0-9_-]+)?$/.test(
      path,
    ) &&
    !(path.endsWith("/focus") && body?.action === "interpret")
  );
}
function replaceIds(value: any, from: string, to: string): any {
  if (typeof value === "string")
    return value === from ? to : value.replace("/" + from, "/" + to);
  if (Array.isArray(value))
    return value.map((item) => replaceIds(item, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceIds(item, from, to),
      ]),
    );
  return value;
}
function minorAmount(value: unknown) {
  if (value === undefined || value === "") return null;
  const clean = String(value).replaceAll(",", "");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(clean))
    throw Error("Use a positive amount with up to two decimal places.");
  const [whole, decimal = ""] = clean.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
const focusPath = "/api/workspace/focus";
function applyLocal(a: Account, op: Op) {
  const boot = a.cache["/api/mobile"];
  if (!boot)
    throw Error(
      "Connect once to download your workspace before making offline changes.",
    );
  const [, kind, id] = op.path.match(/^\/api\/workspace\/([^/]+)(?:\/(.*))?$/)!;
  const body = op.body,
    at = Date.parse(op.at),
    iso = op.at;
  const task = boot.tasks.find((t: any) => t.id === id);
  const f = (a.cache[focusPath] ||= {
    active: null,
    history: [],
    events: [],
    taskTotals: [],
    serverNow: iso,
    receivedAt: Date.now(),
  });
  const timer = f.active;
  function closeFocus(state: string) {
    if (!f.active) return;
    const t = f.active;
    t.elapsed_seconds =
      Number(t.elapsed_seconds || 0) +
      (t.running_since
        ? Math.max(0, Math.floor((at - Date.parse(t.running_since)) / 1000))
        : 0);
    t.total_seconds = t.elapsed_seconds;
    t.state = state;
    t.running_since = null;
    t.check_in_at = null;
    t.revision++;
    if (["completed", "stopped"].includes(state)) {
      t.ended_at = iso;
      f.history.unshift(copy(t));
      f.active = null;
    }
  }
  if (kind === "tasks" && op.method === "POST") {
    if (
      typeof body.title !== "string" ||
      body.title.trim().length < 2 ||
      body.title.trim().length > 200
    )
      throw Error("Use a task title between 2 and 200 characters.");
    boot.tasks.unshift({
      id: op.localId,
      title: body.title.trim(),
      stage: "To do",
      revision: 1,
      created_at: iso,
      category: body.category || "",
      due_date: body.dueDate || "",
      assignee: body.assignee || "",
      important: Number(!!body.important),
      urgent: Number(!!body.urgent),
      project_id: body.projectId || "",
      project_title:
        boot.projects.find((p: any) => p.id === body.projectId)?.title || "",
      goals: boot.goals.filter((g: any) => body.goalIds?.includes(g.id)),
      value_type: body.valueType || "none",
      value_minor:
        body.valueType === "none" ? null : minorAmount(body.valueAmount),
      value_currency: body.valueCurrency || "PKR",
      value_timing: body.valueTiming || "prompt",
      payment_pattern: body.paymentPattern || "one_time",
      value_note: body.valueNote || "",
    });
  } else if (kind === "tasks" || kind === "task-links") {
    if (!task) throw Error("This task is not available offline.");
    Object.assign(task, body);
    delete task.projectId;
    delete task.goalIds;
    if ("dueDate" in body) task.due_date = body.dueDate;
    if ("projectId" in body) {
      task.project_id = body.projectId;
      task.project_title =
        boot.projects.find((p: any) => p.id === body.projectId)?.title || "";
    }
    if ("goalIds" in body)
      task.goals = boot.goals.filter((g: any) => body.goalIds.includes(g.id));
    for (const [from, to] of Object.entries({
      isCsf: "is_csf",
      isKpi: "is_kpi",
      valueType: "value_type",
      valueMinor: "value_minor",
      valueCurrency: "value_currency",
      valueNote: "value_note",
      valueTiming: "value_timing",
      paymentPattern: "payment_pattern",
    }))
      if (from in body) task[to] = body[from];
    if ("valueAmount" in body) task.value_minor = minorAmount(body.valueAmount);
    if (task.value_type === "none") task.value_minor = null;
    task.important = Number(!!task.important);
    task.urgent = Number(!!task.urgent);
    task.revision = body.revision + 1;
    if (body.stage === "Done") {
      task.completed_at = iso;
      if (f.active?.task_id === task.id) closeFocus("completed");
    }
  } else if (kind === "task-storage") {
    const storage = (a.cache["/api/workspace/task-storage"] ||= { items: [] });
    const item = task || storage.items.find((t: any) => t.id === id);
    if (!item) throw Error("This stored task has not been downloaded.");
    item.revision++;
    item.storage_state = body.action === "restore" ? "active" : body.action;
    item.stored_at = iso;
    item.purge_after =
      body.action === "bin" ? new Date(at + 30 * 86400000).toISOString() : null;
    boot.tasks = boot.tasks.filter((t: any) => t.id !== id);
    storage.items = storage.items.filter((t: any) => t.id !== id);
    if (body.action === "restore") boot.tasks.unshift(item);
    else storage.items.unshift(item);
    if (f.active?.task_id === id) closeFocus("stopped");
  } else if (kind === "projects" || kind === "goals") {
    const list = boot[kind];
    const plan = id ? list.find((p: any) => p.id === id) : undefined;
    if (id && !plan) throw Error("This plan is not available offline.");
    if (kind === "goals" && !body.targetDate)
      throw Error("Choose a target date for this goal.");
    const saved = {
      ...(plan || {}),
      ...body,
      id: id || op.localId,
      title: body.title,
      description: body.description || "",
      target_date: body.targetDate || "",
      status: body.status || "Active",
      goal_id: body.goalId || "",
      success_metric: body.successMetric || "",
      revision: plan ? plan.revision + 1 : 1,
      created_at: plan?.created_at || iso,
      completed_at: body.status === "Completed" ? iso : null,
    };
    if (plan) Object.assign(plan, saved);
    else list.unshift(saved);
  } else if (kind === "focus") {
    const action = body.action;
    if (
      ![
        "start",
        "switch",
        "pause",
        "resume",
        "extend",
        "complete",
        "blocked",
        "stop",
        "progress",
        "break",
      ].includes(action)
    )
      throw Error("This focus feature needs internet.");
    if (timer)
      timer.total_seconds =
        Number(timer.elapsed_seconds || 0) +
        (timer.running_since
          ? Math.max(
              0,
              Math.floor((at - Date.parse(timer.running_since)) / 1000),
            )
          : 0);
    const target = boot.tasks.find((t: any) => t.id === body.taskId);
    if (["start", "switch"].includes(action)) {
      if (!target || target.stage === "Done")
        throw Error("Choose an available unfinished task.");
      if (action === "start" && timer)
        throw Error("Stop or switch the current focus first.");
      if (action === "switch") closeFocus("stopped");
      target.stage = "In progress";
      target.revision++;
      f.active = {
        id: op.localId,
        task_id: target.id,
        title: target.title,
        task_stage: target.stage,
        task_revision: target.revision,
        project_id: target.project_id,
        state: "running",
        elapsed_seconds: 0,
        total_seconds: 0,
        target_minutes: body.minutes || 25,
        started_at: iso,
        running_since: iso,
        check_in_at: new Date(at + (body.minutes || 25) * 60000).toISOString(),
        ended_at: null,
        revision: 1,
        note: body.note || "",
        next_step: body.nextStep || "",
        progress: body.progress ?? null,
      };
    } else {
      if (!timer)
        throw Error("There is no active focus session on this device.");
      const t = boot.tasks.find((t: any) => t.id === timer.task_id);
      if (action === "progress") {
        timer.note = body.note || timer.note;
        timer.progress = body.progress ?? timer.progress;
        timer.next_step = body.nextStep ?? timer.next_step;
        timer.revision++;
      } else {
        closeFocus(
          action === "complete"
            ? "completed"
            : action === "stop"
              ? "stopped"
              : action === "blocked"
                ? "blocked"
                : "paused",
        );
        if (action === "complete" && t) {
          t.stage = "Done";
          t.revision++;
          t.completed_at = iso;
        }
        if (["resume", "extend"].includes(action)) {
          timer.state = "running";
          timer.running_since = iso;
          timer.check_in_at = new Date(
            at + (body.minutes || 25) * 60000,
          ).toISOString();
          timer.break_until = null;
        }
        if (action === "break") {
          timer.break_until = new Date(
            at + (body.minutes || 5) * 60000,
          ).toISOString();
          timer.break_kind = body.breakKind || "quiet";
        }
        if (body.note) timer.note = body.note;
      }
      if (f.active) f.active.task_revision = t?.revision;
    }
    f.serverNow = iso;
    f.receivedAt = Date.now();
  }
  if (f.active && kind !== "focus") {
    const t = boot.tasks.find((t: any) => t.id === f.active.task_id);
    if (t) f.active.task_revision = t.revision;
  }
  if (kind === "focus") {
    f.serverNow = iso;
    f.receivedAt = Date.now();
  }
}
export async function enqueue(path: string, body: any, method: string) {
  return update(() => {
    const a = current();
    if (!a || a.needsAuth)
      throw Error("Sign in and connect once before working offline.");
    if (!a.cache["/api/mobile"]?.writable)
      throw Error("This workspace is read-only.");
    if (a.queue.length >= 1000)
      throw Error("Connect to sync pending changes before adding more.");
    const snapshot = a.cache[focusPath];
    const offset =
      snapshot?.serverNow && snapshot?.receivedAt
        ? Date.parse(snapshot.serverNow) - snapshot.receivedAt
        : 0;
    const op: Op = {
      id: crypto.randomUUID(),
      owner: store.active!,
      path,
      method: method as Op["method"],
      body: copy(body),
      at: new Date(Date.now() + offset).toISOString(),
      label: String(
        body.title ||
          a.cache["/api/mobile"].tasks.find(
            (t: any) =>
              t.id === path.split("/").pop() ||
              t.id === body.taskId ||
              t.id === snapshot?.active?.task_id,
          )?.title ||
          body.action ||
          "Plan change",
      ),
    };
    if (
      (method === "POST" &&
        /^\/api\/workspace\/(tasks|projects|goals)$/.test(path)) ||
      (path === focusPath && ["start", "switch"].includes(body.action))
    )
      op.localId = "local-" + crypto.randomUUID();
    applyLocal(a, op);
    a.queue.push(op);
    return { ok: true, id: op.localId || body.sessionId };
  });
}
export async function flush(network: Network) {
  await initOffline();
  if (flushing) return flushing;
  flushing = (async () => {
    while (navigator.onLine) {
      await tail;
      const key = store.active,
        a = current();
      if (!key || !a || a.conflict || a.needsAuth || !a.queue.length) return;
      const op = copy(a.queue[0]);
      try {
        const { localId, label, ...payload } = op;
        const result = await network("/api/mobile-sync", payload, "POST");
        await update(() => {
          const account = store.accounts[key];
          if (!account || account.queue[0]?.id !== op.id) return;
          account.queue.shift();
          if (localId && result.id) {
            account.ids[localId] = result.id;
            account.cache = replaceIds(account.cache, localId, result.id);
            account.queue = replaceIds(account.queue, localId, result.id);
          }
          account.lastSync = new Date().toISOString();
          offline = false;
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401) {
          await lockOffline();
          throw error;
        }
        if (status && status < 500) {
          let serverVersion: any = null;
          if (status === 409) {
            try {
              const verified = await network("/api/mobile");
              if (verified.actor.tenantId + ":" + verified.actor.id === key) {
                const resource = op.path.split("/")[3],
                  id = op.path.split("/")[4];
                serverVersion =
                  (resource === "projects"
                    ? verified.projects
                    : resource === "goals"
                      ? verified.goals
                      : verified.tasks
                  ).find((row: any) => row.id === id) || null;
              }
            } catch {
              /* Keep the local change even when the comparison cannot be downloaded. */
            }
          }
          await update(() => {
            store.accounts[key].conflict = (error as Error).message;
            store.accounts[key].conflictServer = serverVersion;
          });
          return;
        }
        offline = true;
        emit();
        return;
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
export async function resolvedId(id: string | undefined) {
  await tail;
  return id ? current()?.ids[id] || id : undefined;
}
export async function pending() {
  await initOffline();
  await tail;
  return !!current()?.queue.length;
}
export async function resolveConflict(network: Network, keep: boolean) {
  await initOffline();
  await tail;
  const key = store.active,
    a = current();
  if (!key || !a || !a.queue[0]) return;
  const op = a.queue[0];
  if (keep && !a.conflict) {
    await flush(network);
    return;
  }
  if (keep) {
    // Fetch current server records only after explicit approval to reapply the local edit.
    const boot = await network("/api/mobile");
    const resource = op.path.split("/")[3],
      id = op.path.split("/")[4];
    const list =
      resource === "projects"
        ? boot.projects
        : resource === "goals"
          ? boot.goals
          : boot.tasks;
    const row = list.find((item: any) => item.id === id);
    if (
      !row ||
      !["tasks", "task-links", "projects", "goals"].includes(resource) ||
      op.method !== "PATCH"
    )
      throw Error(
        "This change needs review in the connected app. Your local work is still saved.",
      );
    await update(() => {
      const account = store.accounts[key];
      const delta = row.revision - op.body.revision;
      for (const item of account.queue)
        if (
          item.path.split("/")[4] === id &&
          typeof item.body.revision === "number"
        ) {
          item.body.revision += delta;
          item.id = crypto.randomUUID();
        }
      account.conflict = undefined;
      account.conflictServer = undefined;
    });
  } else {
    // Retain the offline version as a recovery copy; never silently erase a queue.
    await update(() => {
      const account = store.accounts[key];
      account.cache["offline-recovery-" + Date.now()] = copy(account.queue);
      account.queue = [];
      account.conflict = undefined;
      account.conflictServer = undefined;
    });
  }
  await flush(network);
}
