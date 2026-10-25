// Native emulator acceptance tests. Production account data is never used.
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes, scryptSync, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createTestDatabase } from "./lib/test-database.mjs";
import { database } from "../src/lib/postgres.mjs";
import { connectWebView } from "./lib/android-cdp.mjs";
const root = process.cwd(),
  out = resolve(".data/android-acceptance");
mkdirSync(out, { recursive: true });
const sdkCandidates = [
  process.env.ANDROID_HOME,
  join(homedir(), "Library/Android/sdk"),
].filter(Boolean);
const sdk = sdkCandidates.find((p) => existsSync(join(p, "emulator/emulator")));
if (!sdk) throw Error("Android SDK/emulator required.");
const adb = join(sdk, "platform-tools/adb"),
  emulator = join(sdk, "emulator/emulator");
let serial = "";
function adbRun(args) {
  return execFileSync(adb, [...(serial ? ["-s", serial] : []), ...args], {
    encoding: "utf8",
    timeout: 45000,
  }).trim();
}
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
const logs = [];
function start(cmd, args, env, name, cwd = root) {
  const fd = openSync(join(out, name + ".log"), "w");
  logs.push(fd);
  return spawn(cmd, args, { cwd, env, stdio: ["ignore", fd, fd] });
}
async function run(cmd, args, env, name, cwd = root) {
  const p = start(cmd, args, env, name, cwd);
  const code = await new Promise((r) => p.once("exit", r));
  if (code !== 0)
    throw Error(name + " failed; see " + join(out, name + ".log"));
}
const results = [];
async function check(name, fn) {
  await fn();
  results.push({ name, status: "passed" });
  console.log("PASS " + name);
  writeFileSync(join(out, "report.json"), JSON.stringify({ results }, null, 2));
}
let fixture, backend, emu, cdp;
let success = false;
const directory = mkdtempSync(join(tmpdir(), "humeto-android-qa-"));
const p = await port(),
  forward = await port();
const qaOrigin = `http://10.0.2.2:${p}`;
const userEmail = "android-qa@example.test",
  password = "Android QA " + randomBytes(8).toString("hex") + "!";
let env;
try {
  fixture = await createTestDatabase();
  env = {
    ...process.env,
    DATABASE_URL: fixture.url,
    DATABASE_URL_UNPOOLED: fixture.url,
    HUMETO_DATA_DIR: directory,
    HUMETO_AGENT_PROVIDER: "local",
    HUMETO_LOCAL_DEMO: "true",
    HUMETO_EMAIL_MODE: "capture",
    HUMETO_ISOLATED_QA: "true",
    // QA uploads stay local even when the developer has production storage credentials.
    NEXT_PUBLIC_SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_STORAGE_BUCKET: "",
    HUMETO_HTTPS: "false",
    VERCEL: "0",
    HUMETO_PUBLIC_APP_URL: qaOrigin,
    HUMETO_SUPER_ADMIN_EMAIL: "qa-admin@example.test",
  };
  await run(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.mts"],
    env,
    "seed",
  );
  const d = database(fixture.url),
    salt = randomBytes(16).toString("hex");
  await d
    .prepare("UPDATE users SET email=?,password_hash=? WHERE id=?")
    .run(
      userEmail,
      salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      "ayesha",
    );
  await d.close();
  backend = start(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(p),
    ],
    env,
    "backend",
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${p}/login`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  await run(
    "npm",
    ["run", "build", "--", "--mode", "qa"],
    { ...process.env, VITE_HUMETO_QA_API: qaOrigin },
    "qa-web",
    join(root, "mobile"),
  );
  await run(
    "npx",
    ["cap", "sync", "android"],
    process.env,
    "qa-sync",
    join(root, "mobile"),
  );
  await run(
    "./gradlew",
    ["assembleDebug", "-PhumetoQa"],
    process.env,
    "qa-apk",
    join(root, "mobile/android"),
  );
  const devices = adbRun(["devices"])
    .split("\n")
    .slice(1)
    .map((s) => s.split(/\s+/))
    .find(([id, state]) => id?.startsWith("emulator-") && state === "device");
  if (devices) serial = devices[0];
  else {
    const avd = execFileSync(emulator, ["-list-avds"], { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    if (!avd) throw Error("An Android AVD is required.");
    emu = start(
      emulator,
      [
        "-avd",
        avd,
        "-no-window",
        "-no-audio",
        "-no-boot-anim",
        "-no-snapshot",
        "-gpu",
        "swiftshader_indirect",
        "-cores",
        "2",
        "-memory",
        "2048",
      ],
      process.env,
      "emulator",
    );
    for (let i = 0; i < 120; i++) {
      const line = adbRun(["devices"])
        .split("\n")
        .find((x) => x.startsWith("emulator-") && x.includes("device"));
      if (line) {
        serial = line.split(/\s+/)[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!serial) throw Error("Emulator did not start.");
  for (let i = 0; i < 100; i++) {
    if (adbRun(["shell", "getprop", "sys.boot_completed"]) === "1") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const key of [
    "window_animation_scale",
    "transition_animation_scale",
    "animator_duration_scale",
  ])
    adbRun(["shell", "settings", "put", "global", key, "0"]);
  adbRun([
    "install",
    "-r",
    "mobile/android/app/build/outputs/apk/debug/app-debug.apk",
  ]);
  adbRun(["shell", "am", "force-stop", "com.humeto.tasks.qa"]);
  adbRun(["shell", "pm", "clear", "com.humeto.tasks.qa"]);
  adbRun(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  adbRun([
    "shell",
    "am",
    "start",
    "-n",
    "com.humeto.tasks.qa/com.humeto.tasks.MainActivity",
  ]);
  let pid = "";
  for (let i = 0; i < 100; i++) {
    // A freshly booted emulator can start the activity before its WebView provider is ready.
    if (i === 30) {
      console.log("Retrying QA activity after cold WebView startup.");
      adbRun(["shell", "am", "force-stop", "com.humeto.tasks.qa"]);
      adbRun([
        "shell",
        "am",
        "start",
        "-n",
        "com.humeto.tasks.qa/com.humeto.tasks.MainActivity",
      ]);
    }
    try {
      pid = adbRun(["shell", "pidof", "com.humeto.tasks.qa"]);
      adbRun([
        "forward",
        `tcp:${forward}`,
        `localabstract:webview_devtools_remote_${pid}`,
      ]);
      cdp = await connectWebView(forward);
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!cdp) throw Error("Native WebView did not become available.");
  await cdp.wait(`Boolean(window.Capacitor?.isNativePlatform?.())`);
  await cdp.wait(`Boolean(document.querySelector('input[name=email]'))`);
  const nativeApi = async (path, body, method) =>
    cdp.evaluate(
      `(async()=>{const r=await window.Capacitor.Plugins.CapacitorHttp.request({url:${JSON.stringify(qaOrigin)}+${JSON.stringify(path)},method:${JSON.stringify(method || (body ? "POST" : "GET"))},headers:{Origin:${JSON.stringify(qaOrigin)},'Content-Type':'application/json'},${body ? "data:" + JSON.stringify(body) + "," : ""}responseType:'json'});return {status:r.status,data:r.data};})()`,
    );
  await check(
    "Native bridge uses isolated backend; no anonymous task access",
    async () => {
      assert.equal(
        await cdp.evaluate("window.Capacitor.isNativePlatform()"),
        true,
      );
      assert.equal((await nativeApi("/api/mobile")).status, 401);
      await cdp.wait(`Boolean(document.querySelector('input[name=email]'))`);
    },
  );
  await check(
    "Password sign-in through native UI and HttpOnly session cookie",
    async () => {
      await cdp.fill("input[name=email]", userEmail);
      await cdp.fill("input[name=password]", password);
      await cdp.click("Sign in");
      await cdp.wait(`document.body.innerText.includes('What matters today?')`);
      const r = await nativeApi("/api/mobile");
      assert.equal(r.status, 200);
      assert.equal(r.data.actor.id, "ayesha");
      assert.equal(
        await cdp.evaluate(`document.cookie.includes('humeto_session')`),
        false,
      );
    },
  );
  const title = "Android native acceptance task";
  let taskId = "";
  await check(
    "Create a task in native UI and read the same database record",
    async () => {
      await cdp.click("Tasks");
      await cdp.click("Add task");
      await cdp.fill("input[name=title]", title);
      await cdp.fill("input[name=category]", "Personal");
      await cdp.select("select[name=valueType]", "profit");
      await cdp.fill("input[name=valueAmount]", "25000");
      assert.equal(
        await cdp.evaluate(
          `document.querySelector('input[name=valueAmount]').value`,
        ),
        "25,000",
      );
      await cdp.select("select[name=valueCurrency]", "EUR");
      await cdp.select("select[name=valueTiming]", "deferred");
      await cdp.select("select[name=paymentPattern]", "installments");
      await cdp.click("Create task");
      await cdp.wait(`!document.querySelector('[role=dialog]')`);
      const r = await nativeApi("/api/mobile");
      const t = r.data.tasks.find((t) => t.title === title);
      assert.ok(t);
      taskId = t.id;
      assert.equal(t.value_currency, "EUR");
      assert.equal(t.value_timing, "deferred");
      assert.equal(t.payment_pattern, "installments");
      const d = database(fixture.url);
      assert.ok(
        await d
          .prepare("SELECT id FROM tasks WHERE id=? AND tenant_id=?")
          .get(taskId, "northstar"),
      );
      await d.close();
    },
  );
  await check(
    "Native task options archive, bin and restore the same task",
    async () => {
      await cdp.evaluate(
        `document.querySelector('[aria-label="Task options: Android native acceptance task"]').click()`,
      );
      await cdp.click("Archive", true);
      await cdp.wait(
        `!document.querySelector('[aria-label="Task options: Android native acceptance task"]')`,
      );
      await cdp.evaluate(
        `[...document.querySelectorAll('[aria-label="Task locations"] button')].find(b=>b.textContent.startsWith('Archive')).click()`,
      );
      await cdp.wait(
        `document.querySelector('[aria-label="Task Archive"]')?.textContent.includes('Android native acceptance task')`,
      );
      await cdp.evaluate(
        `[...document.querySelectorAll('[aria-label="Task Archive"] article')].find(a=>a.textContent.includes('Android native acceptance task')).querySelectorAll('button')[1].click()`,
      );
      await cdp.evaluate(
        `[...document.querySelectorAll('[aria-label="Task locations"] button')].find(b=>b.textContent.startsWith('Bin')).click()`,
      );
      await cdp.wait(
        `document.querySelector('[aria-label="Task Bin"]')?.textContent.includes('Android native acceptance task')`,
      );
      await cdp.evaluate(
        `[...document.querySelectorAll('[aria-label="Task Bin"] article')].find(a=>a.textContent.includes('Android native acceptance task')).querySelector('button').click()`,
      );
      await cdp.wait(
        `!document.querySelector('[aria-label="Task Bin"]')?.textContent.includes('Android native acceptance task')`,
      );
      await cdp.click("Active tasks", true);
      const task = (await nativeApi("/api/mobile")).data.tasks.find(
        (t) => t.id === taskId,
      );
      assert.equal(task.value_currency, "EUR");
      assert.equal(task.value_timing, "deferred");
      assert.equal(task.payment_pattern, "installments");
    },
  );
  await check(
    "Edit task title and priority in the native detail sheet",
    async () => {
      await cdp.wait(
        `Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.includes(${JSON.stringify(title)})))`,
      );
      await cdp.evaluate(
        `document.querySelectorAll('button').forEach(e=>{if(e.textContent.includes(${JSON.stringify(title)}))e.click();})`,
      );
      await cdp.wait(`Boolean(document.querySelector('input[name=title]'))`);
      await cdp.fill("input[name=title]", title + " updated");
      await cdp.fill("input[name=category]", "Creative projects");
      await cdp.select("select[name=valueType]", "avoid_loss");
      await cdp.fill("input[name=valueAmount]", "75000");
      await cdp.evaluate(
        `document.querySelector('input[name=important]').click()`,
      );
      await cdp.click("Save changes");
      await cdp.wait(`document.body.innerText.includes('Task updated.')`);
      const t = (await nativeApi("/api/mobile")).data.tasks.find(
        (t) => t.id === taskId,
      );
      assert.equal(t.title, title + " updated");
      assert.equal(t.important, 1);
      assert.equal(t.category, "Creative projects");
      assert.equal(t.value_type, "avoid_loss");
      assert.equal(t.value_minor, 7500000);
      await cdp.click("Close");
    },
  );

  await check(
    "Custom category labels and category/assignment/date filters work on Android",
    async () => {
      await cdp.evaluate(
        `document.querySelector('.task-filter-panel summary').click()`,
      );
      await cdp.select(
        'select[aria-label="Category filter"]',
        "Creative projects",
      );
      await cdp.wait(
        `document.querySelectorAll('.task').length===1 && document.querySelector('.task').textContent.includes('Creative projects')`,
      );
      await cdp.select('select[aria-label="Expected impact filter"]', "profit");
      await cdp.wait(`document.querySelectorAll('.task').length===0`);
      await cdp.select(
        'select[aria-label="Expected impact filter"]',
        "avoid_loss",
      );
      await cdp.wait(`document.querySelectorAll('.task').length===1`);
      await cdp.click("Calendar view");
      await cdp.wait(
        `document.querySelector('[aria-label="Filtered task calendar"]')?.textContent.includes('1 filtered tasks')`,
      );
      assert.equal(
        await cdp.evaluate(
          `document.querySelector('[aria-label="Category filter"]').value`,
        ),
        "Creative projects",
      );
      await cdp.click("Priority");
      await cdp.select('select[aria-label="Due date filter"]', "none");
      await cdp.wait(`document.querySelectorAll('.task').length===1`);
      await cdp.select('select[aria-label="Assignment filter"]', "unassigned");
      await cdp.wait(`document.querySelectorAll('.task').length===0`);
      await cdp.click("Clear filters");
      await cdp.wait(`document.querySelectorAll('.task').length>1`);
    },
  );
  await check(
    "Long-press task card moves stage and all four quadrants without opening details",
    async () => {
      await cdp.click("Board");
      const gripSelector =
        "button[aria-label=" +
        JSON.stringify("Open task: " + title + " updated") +
        "]";
      const point = async (selector) =>
        cdp.evaluate(
          `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
        );
      const touch = async (type, p) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints:
            type === "touchEnd" || type === "touchCancel"
              ? []
              : [{ x: p.x, y: p.y, id: 1, radiusX: 3, radiusY: 3 }],
        });
      async function dragTo(zone) {
        const source = ".touch-task-card:has(" + gripSelector + ") .task-copy";
        const start = await point(source);
        await touch("touchStart", start);
        // Hold the card itself; no Move handle and no immediate movement.
        await cdp.wait("!!document.querySelector('.touch-drop-tray')");
        const dest = await point(
          '.touch-drop-tray [data-touch-drop="' + zone + '"]',
        );
        await touch("touchMove", dest);
        await cdp.wait(
          `document.querySelector('.touch-drop-tray .touch-drop-over')?.dataset.touchDrop === ${JSON.stringify(zone)}`,
        );
        await touch("touchEnd");
        await cdp.wait(
          "!document.querySelector('.touch-drop-tray') && !document.querySelector('.touch-drag-ghost')",
        );
      }
      await dragTo("stage:In progress");
      await cdp.wait(
        `document.querySelector('[data-touch-drop="stage:In progress"]')?.textContent.includes(${JSON.stringify(title + " updated")})`,
      );
      await cdp.click("Priority");
      for (const n of [0, 1, 2, 3]) {
        await dragTo("priority:" + n);
        await cdp.wait(
          `document.querySelector('[data-touch-drop="priority:${n}"]')?.textContent.includes(${JSON.stringify(title + " updated")})`,
        );
        const task = (await nativeApi("/api/mobile")).data.tasks.find(
          (t) => t.id === taskId,
        );
        assert.equal(task.stage, "In progress");
        assert.equal(task.important, n < 2 ? 1 : 0);
        assert.equal(task.urgent, n === 0 || n === 2 ? 1 : 0);
      }
      assert.equal(
        await cdp.evaluate("!!document.querySelector('[role=dialog]')"),
        false,
      );
    },
  );
  await check(
    "Create projects/goals and link native tasks to their shared records",
    async () => {
      await cdp.click("Plans");
      await cdp.select('select[aria-label="Add plan"]', "goals");
      await cdp.fill("input[name=title]", "Android QA goal");
      await cdp.fill("input[name=targetDate]", "2027-03-31");
      await cdp.click("Create");
      await cdp.wait(`!document.querySelector('[role=dialog]')`);
      const createdGoal = (await nativeApi("/api/mobile")).data.goals.find(
        (g) => g.title === "Android QA goal",
      );
      await cdp.select('select[aria-label="Add plan"]', "projects");
      await cdp.fill("input[name=title]", "Android QA project");
      await cdp.select("select[name=goalId]", createdGoal.id);
      await cdp.fill("input[name=targetDate]", "2027-02-28");
      await cdp.click("Create");
      await cdp.wait(`!document.querySelector('[role=dialog]')`);
      const state = (await nativeApi("/api/mobile")).data;
      const project = state.projects.find(
          (p) => p.title === "Android QA project",
        ),
        goal = state.goals.find((g) => g.title === "Android QA goal");
      assert.ok(project && goal);
      await cdp.click("Tasks");
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('.task')).find(e=>e.textContent.includes(${JSON.stringify(title + " updated")})).click()`,
      );
      await cdp.wait(
        `Boolean(document.querySelector('select[name=projectId]'))`,
      );
      await cdp.evaluate(
        `Array.from(document.querySelectorAll(".task-detail-group > summary")).find(e=>e.textContent.startsWith("Team & plans")).click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await cdp.select("select[name=projectId]", project.id);
      await cdp.select('select[aria-label="Goal"]', goal.id);
      await cdp.click("Save project & goals");
      await cdp.wait(
        `document.body.innerText.includes('Project links saved.')`,
      );
      assert.ok(
        (await nativeApi("/api/mobile")).data.tasks
          .find((t) => t.id === taskId)
          .goals.some((g) => g.id === goal.id),
      );
      await cdp.select('select[aria-label="Goal"]', "");

      await cdp.click("Save project & goals");
      await cdp.wait(
        `document.body.innerText.includes('Project links saved.')`,
      );
      const linked = (await nativeApi("/api/mobile")).data.tasks.find(
        (t) => t.id === taskId,
      );
      assert.equal(linked.project_id, project.id);
      assert.equal(linked.goals.length, 0);
      await cdp.click("Close");
      await cdp.click("Plans");
      await cdp.click("Goals");
      await cdp.wait(
        `Array.from(document.querySelectorAll('.mobile-plan-card')).some(e=>e.textContent.includes('Android QA goal') && e.textContent.includes('1 linked tasks'))`,
      );
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('.mobile-plan-card .project')).find(e=>e.textContent.includes('Android QA goal')).click()`,
      );
      await cdp.wait(
        `document.querySelector('select[aria-label="Goal filter"]')?.value===${JSON.stringify(goal.id)}`,
      );
      await cdp.evaluate(
        `document.querySelector('.task-filter-panel').open = true`,
      );
      await cdp.click("Clear filters");
      await cdp.wait(
        `Array.from(document.querySelectorAll('.task')).some(e=>e.textContent.includes(${JSON.stringify(title + " updated")}))`,
      );
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('.task')).find(e=>e.textContent.includes(${JSON.stringify(title + " updated")})).click()`,
      );
      await cdp.evaluate(
        `Array.from(document.querySelectorAll(".task-detail-group > summary")).find(e=>e.textContent.startsWith("Team & plans")).click()`,
      );
    },
  );
  await check(
    "Native team assignment persists to shared permissions-controlled endpoint",
    async () => {
      await cdp.wait(`Boolean(document.querySelector('input[name=members]'))`);
      const selected = await cdp.evaluate(
        `(()=>{const e=document.querySelector('input[name=members]');if(!e.checked)e.click();return e.value;})()`,
      );
      await cdp.click("Save team");
      await cdp.wait(
        `document.body.innerText.includes('Team assignment saved.')`,
      );
      const a = await nativeApi(
        "/api/workspace/assignments?type=task&id=" + taskId,
      );
      assert.ok(a.data.userIds.includes(selected));
    },
  );
  await check(
    "Task reminder sync schedules a native device alarm",
    async () => {
      adbRun([
        "shell",
        "pm",
        "grant",
        "com.humeto.tasks.qa",
        "android.permission.POST_NOTIFICATIONS",
      ]);
      const day = await cdp.evaluate(
        `new Date(Date.now()+86400000).toISOString().slice(0,10)`,
      );
      await cdp.evaluate(
        `Array.from(document.querySelectorAll(".task-detail-group > summary")).find(e=>e.textContent.startsWith("Reminders & repeat")).click()`,
      );
      await cdp.fill("input[name=day]", day);
      await cdp.fill("input[name=time]", "09:30");
      await cdp.click("Set reminder");
      await cdp.wait(`document.body.innerText.includes('Reminder saved.')`);
      const schedule = await nativeApi("/api/workspace/scheduling");
      assert.ok(schedule.data.reminders.some((r) => r.task_id === taskId));
      assert.equal(
        await cdp.evaluate(
          `window.Capacitor.Plugins.LocalNotifications.getPending().then(r=>r.notifications.some(n=>n.body===${JSON.stringify(title + " updated")}))`,
        ),
        true,
      );
    },
  );
  await check(
    "Recurring task series can be created and paused on Android",
    async () => {
      const day = await cdp.evaluate(
        `new Date(Date.now()+86400000).toISOString().slice(0,10)`,
      );
      await cdp.select("select[name=frequency]", "weekly");
      await cdp.fill("input[name=firstDay]", day);
      await cdp.click("Create recurring series");
      await cdp.wait(
        `document.body.innerText.includes('Recurring series created.')`,
      );
      assert.ok(
        (await nativeApi("/api/workspace/scheduling")).data.series.some(
          (s) => s.title === title + " updated",
        ),
      );
      await cdp.click("Close");
      await cdp.click("Reminders");
      await cdp.wait(`document.body.innerText.includes('Recurring tasks')`);
      await cdp.click("Pause");
      await cdp.wait(`document.body.innerText.includes('Recurrence updated.')`);
      assert.equal(
        (await nativeApi("/api/workspace/scheduling")).data.series.find(
          (s) => s.title === title + " updated",
        ).status,
        "paused",
      );
      await cdp.click("Close");
    },
  );
  await check(
    "Android keyboard keeps chat composer and Send visible without manual scrolling",
    async () => {
      await cdp.click("Chat");
      adbRun([
        "shell",
        "settings",
        "put",
        "secure",
        "show_ime_with_hard_keyboard",
        "1",
      ]);
      const before = await cdp.evaluate(`window.visualViewport.height`);
      const point = await cdp.evaluate(
        `(()=>{const r=document.querySelector('textarea[aria-label="Message Humeto"]').getBoundingClientRect();return {x:r.x+30,y:r.y+20};})()`,
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.wait(`window.visualViewport.height < ${before} - 100`);
      await cdp.wait(
        `document.documentElement.dataset.chatKeyboard === 'true'`,
      );
      await cdp.fill(
        'textarea[aria-label="Message Humeto"]',
        "Visible keyboard draft",
      );
      const bounds = await cdp.evaluate(
        `(()=>{const v=window.visualViewport;const r=document.querySelector('.composer').getBoundingClientRect();const b=document.querySelector('button[aria-label="Send message"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,sendBottom:b.bottom,height:v.height+v.offsetTop,nav:getComputedStyle(document.querySelector('.bottom')).display};})()`,
      );
      assert.ok(
        bounds.top >= 0 &&
          bounds.bottom <= bounds.height + 2 &&
          bounds.sendBottom <= bounds.height + 2,
        JSON.stringify(bounds),
      );
      assert.equal(bounds.nav, "none");
      adbRun(["shell", "input", "keyevent", "KEYCODE_BACK"]);
      await cdp.wait(`window.visualViewport.height > ${before} - 50`);
      assert.equal(
        await cdp.evaluate(
          `document.querySelector('textarea[aria-label="Message Humeto"]').value`,
        ),
        "Visible keyboard draft",
      );
    },
  );
  await check(
    "Assistant prepares and cancels a proposal without applying it",
    async () => {
      await cdp.click("Chat");
      await cdp.fill(
        'textarea[aria-label="Message Humeto"]',
        "Create a task to check native assistant tomorrow",
      );
      await cdp.click("Send message");
      await cdp.wait(
        `Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Apply')`,
      );
      await cdp.click("Cancel");
      await cdp.wait(`document.body.innerText.includes('cancelled')`);
      assert.ok(
        !(await nativeApi("/api/mobile")).data.tasks.some((t) =>
          t.title.includes("check native assistant"),
        ),
      );
    },
  );
  await check(
    "Android assistant loads older history without jumping to the bottom",
    async () => {
      const state = (await nativeApi("/api/agent")).data;
      const d = database(fixture.url);
      for (let i = 0; i < 65; i++)
        await d
          .prepare(
            "INSERT INTO agent_messages(id,tenant_id,thread_id,role,content,result,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            "northstar",
            state.threadId,
            "user",
            "Android history " + i,
            "{}",
            "2020-01-01 00:00:00",
          );
      await d.close();
      await cdp.click("Today");
      await cdp.click("Chat");
      await cdp.wait(
        "document.querySelectorAll('.messages article').length===30",
      );
      await cdp.evaluate(
        "(()=>{const e=document.querySelector('.messages');e.scrollTop=0;e.dispatchEvent(new Event('scroll'));})()",
      );
      await cdp.wait(
        "document.querySelectorAll('.messages article').length===60",
      );
      assert.ok(
        await cdp.evaluate("document.querySelector('.messages').scrollTop>0"),
      );
      assert.equal(
        await cdp.evaluate("window.Capacitor.isPluginAvailable('Share')"),
        true,
      );
    },
  );
  await check(
    "Native bird's-eye view opens task activity tracking and schedules a separate update",
    async () => {
      await cdp.click("Tasks");
      await cdp.click("Bird’s-eye view");
      await cdp.wait("document.querySelectorAll('.birds-task').length>0");
      await cdp.evaluate(
        `[...document.querySelectorAll('.birds-task')].find(e=>e.textContent.includes(${JSON.stringify(title + " updated")})).click()`,
      );
      await cdp.click("Activity timers & status check-ins");
      await cdp.fill(
        '[aria-label="Task activity tracking"] input[name=label]',
        "Native application worker",
      );
      await cdp.fill(
        '[aria-label="Task activity tracking"] textarea[name=note]',
        "Preparing the application information",
      );
      await cdp.fill(
        '[aria-label="Task activity tracking"] input[name=minutes]',
        "120",
      );
      await cdp.click("Start activity & schedule check-in");
      await cdp.wait(
        "document.querySelector('[aria-label=\"Task activity tracking\"]')?.textContent.includes('Native application worker · running')",
      );
      const activity = (
        await nativeApi("/api/task-activities?taskId=" + taskId)
      ).data.activities[0];
      assert.equal(activity.state, "running");
      assert.ok(Date.parse(activity.check_in_at) > Date.now() + 119 * 60000);
      assert.equal((await nativeApi("/api/workspace/focus")).data.active, null);
      assert.equal(
        await cdp.evaluate("window.Capacitor.isPluginAvailable('Filesystem')"),
        true,
      );
      await cdp.click("Close");
      await cdp.click("Priority");
    },
  );
  await check(
    "Native clean project attachments download with the signed-in session into private cache",
    async () => {
      const d = database(fixture.url),
        fid = randomUUID(),
        bytes = Buffer.from(
          "%PDF-1.7\nFictional native download fixture\n%%EOF",
        );
      await d
        .prepare(
          "INSERT INTO project_attachments(id,tenant_id,project_id,author,name,mime,bytes,size,status) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          fid,
          "northstar",
          "demo-project-intake",
          "QA",
          "native.pdf",
          "application/pdf",
          bytes,
          bytes.length,
          "clean",
        );
      const result = await cdp.evaluate(
        `window.Capacitor.Plugins.CapacitorHttp.request({url:${JSON.stringify(qaOrigin)}+'/api/project-sharing?projectId=demo-project-intake&attachment=${fid}',method:'GET',headers:{Origin:${JSON.stringify(qaOrigin)}},responseType:'blob'}).then(async r=>{if(r.status!==200)throw Error('Download denied '+r.status);await window.Capacitor.Plugins.Filesystem.writeFile({path:'native-download-qa.pdf',directory:'CACHE',data:r.data});const read=await window.Capacitor.Plugins.Filesystem.readFile({path:'native-download-qa.pdf',directory:'CACHE'});await window.Capacitor.Plugins.Filesystem.deleteFile({path:'native-download-qa.pdf',directory:'CACHE'});return read.data;})`,
      );
      assert.equal(result, bytes.toString("base64"));
      await d.prepare("DELETE FROM project_attachments WHERE id=?").run(fid);
      await d.close();
    },
  );
  await check(
    "Focus session starts, pauses, resumes and records completion",
    async () => {
      await cdp.click("Focus");
      await cdp.click("Pick a random task");
      await cdp.wait(
        "[...document.querySelectorAll('button')].some(b=>b.textContent==='Choose this task'&&!b.disabled)",
      );
      assert.equal((await nativeApi("/api/workspace/focus")).data.active, null);
      await cdp.evaluate(
        `(()=>{const e=document.querySelector('select[aria-label="Focus task selector"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,${JSON.stringify(taskId)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await cdp.click("Start");
      await cdp.wait(
        `document.querySelector('.focus-session .pill')?.textContent.includes('Focusing')`,
      );
      await cdp.evaluate(
        `document.querySelector('.focus-transition > summary').click()`,
      );
      await cdp.click("Take a 10-second reset");
      await cdp.wait("!!document.querySelector('[role=timer]')");
      assert.equal(
        (await nativeApi("/api/workspace/focus")).data.active.state,
        "running",
      );
      await cdp.evaluate(
        "[...document.querySelectorAll('.focus-rest summary')].find(e=>e.textContent==='Take a break').click()",
      );
      await cdp.click("Start break");
      const onBreak = (await nativeApi("/api/workspace/focus")).data.active;
      assert.equal(onBreak.state, "paused");
      assert.ok(onBreak.break_until);
      await cdp.click("Start");
      await cdp.click("Pause");
      await cdp.wait(
        `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Start'&&!e.disabled)`,
      );
      await cdp.click("Start");
      await cdp.wait(
        `document.querySelector('.focus-session .pill')?.textContent.includes('Focusing')`,
      );
      await cdp.click("Today");
      await cdp.wait(
        `document.querySelector('.focus-hero h2')?.textContent===${JSON.stringify(title + " updated")}`,
      );
      const other = (await nativeApi("/api/mobile")).data.tasks.find(
        (t) => t.id !== taskId && t.stage !== "Done",
      );
      const pick = async (name) => {
        await cdp.click("Switch focus task");
        await cdp.fill('input[aria-label="Find focus task"]', name);
        await cdp.wait(
          `document.querySelectorAll('.focus-picker-list .task').length===1`,
        );
        await cdp.evaluate(
          `document.querySelector('.focus-picker-list .task').click()`,
        );
        await cdp.wait(
          `!document.querySelector('[role=dialog]') && document.querySelector('select[aria-label="Focus task selector"]')?.selectedOptions[0]?.textContent===${JSON.stringify(name)}`,
        );
      };
      await pick(other.title);
      await cdp.click("Today");
      await cdp.wait(
        `document.querySelector('.focus-hero h2')?.textContent===${JSON.stringify(other.title)}`,
      );
      let f = (await nativeApi("/api/workspace/focus")).data;
      assert.equal(f.active.task_id, other.id);
      assert.ok(
        f.history.some((h) => h.task_id === taskId && h.state === "stopped"),
      );
      assert.notEqual(
        (await nativeApi("/api/mobile")).data.tasks.find((t) => t.id === taskId)
          .stage,
        "Done",
      );
      await pick(title + " updated");
      await cdp.click("Mark task complete");
      await cdp.click("Confirm");
      await cdp.wait(
        `document.querySelector('.focus-session h2')?.textContent==='Choose a task'`,
      );
      assert.equal(
        (await nativeApi("/api/mobile")).data.tasks.find((t) => t.id === taskId)
          .stage,
        "Done",
      );
    },
  );

  await check(
    "Completion updates project/goal history and cancels the device task reminder",
    async () => {
      const report = await nativeApi("/api/workspace/task-history");
      assert.equal(
        report.data.projects.find((p) => p.title === "Android QA project")
          .count,
        1,
      );
      assert.equal(
        report.data.goals.find((g) => g.title === "Android QA goal").count,
        1,
      );
      assert.equal(
        await cdp.evaluate(
          `window.Capacitor.Plugins.LocalNotifications.getPending().then(r=>r.notifications.some(n=>n.body===${JSON.stringify(title + " updated")}))`,
        ),
        false,
      );
    },
  );
  await check(
    "Assistant Apply writes once and repeated approval is replay-safe",
    async () => {
      await cdp.click("Chat");
      await cdp.fill(
        'textarea[aria-label="Message Humeto"]',
        "Create a task to review native approvals tomorrow",
      );
      await cdp.click("Send message");
      await cdp.wait(
        `Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Apply')`,
      );
      const state = await nativeApi("/api/agent?timezone=Asia%2FKarachi");
      const action = state.data.messages.at(-1).result.action;
      assert.ok(action.id);
      await cdp.click("Apply");
      await cdp.wait(`document.body.innerText.includes('applied')`);
      await nativeApi("/api/agent", {
        operation: "action",
        actionId: action.id,
        decision: "apply",
        timezone: "Asia/Karachi",
      });
      assert.equal(
        (await nativeApi("/api/mobile")).data.tasks.filter(
          (t) => t.title === "review native approvals",
        ).length,
        1,
      );
    },
  );
  await check("Cookie session survives native app restart", async () => {
    cdp.close();
    cdp = null;
    adbRun(["shell", "am", "force-stop", "com.humeto.tasks.qa"]);
    adbRun([
      "shell",
      "am",
      "start",
      "-n",
      "com.humeto.tasks.qa/com.humeto.tasks.MainActivity",
    ]);
    for (let i = 0; i < 100; i++) {
      try {
        pid = adbRun(["shell", "pidof", "com.humeto.tasks.qa"]);
        adbRun([
          "forward",
          `tcp:${forward}`,
          `localabstract:webview_devtools_remote_${pid}`,
        ]);
        cdp = await connectWebView(forward);
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    await cdp.wait(`document.body.innerText.includes('What matters today?')`);
  });
  await check(
    "Native notification permission, scheduling and Android delivery",
    async () => {
      adbRun([
        "shell",
        "pm",
        "grant",
        "com.humeto.tasks.qa",
        "android.permission.POST_NOTIFICATIONS",
      ]);
      await cdp.evaluate(
        `window.Capacitor.Plugins.LocalNotifications.schedule({notifications:[{id:8971,title:'Humeto QA notification',isExactNotification:false,body:'Native delivery test'}]})`,
      );
      const delivered = await cdp.wait(
        `window.Capacitor.Plugins.LocalNotifications.getDeliveredNotifications().then(r=>r.notifications.some(n=>n.id===8971))`,
      );
      assert.equal(delivered, true);
      await cdp.evaluate(
        `window.Capacitor.Plugins.LocalNotifications.schedule({notifications:[{id:8972,title:'Humeto QA scheduled',body:'Future alarm test',isExactNotification:false,schedule:{at:new Date(Date.now()+600000).toISOString()}}]})`,
      );
      assert.equal(
        await cdp.evaluate(
          `window.Capacitor.Plugins.LocalNotifications.getPending().then(r=>r.notifications.some(n=>n.id===8972))`,
        ),
        true,
      );
    },
  );

  await check(
    "100-task native priority view stays bounded and scrollable",
    async () => {
      const d = database(fixture.url);
      for (let i = 0; i < 100; i++)
        await d
          .prepare(
            "INSERT INTO tasks(id,tenant_id,title,important,urgent) VALUES(?,?,?,?,?)",
          )
          .run(
            "android-load-" + i,
            "northstar",
            "Android load task " + i,
            1,
            1,
          );
      await d.close();
      await cdp.click("Account settings");
      await cdp.click("Sync now");
      await cdp.wait(`document.body.innerText.includes('Workspace access')`);
      await cdp.click("Close");
      await cdp.click("Tasks");
      await cdp.wait(`document.querySelectorAll('.task').length>=100`);
      const m = await cdp.evaluate(
        `(()=>{const e=document.querySelector('.quadrant-scroll');return {height:e.clientHeight,scroll:e.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth};})()`,
      );
      assert.ok(m.height <= 280);
      assert.ok(m.scroll > m.height);
      assert.equal(m.overflow, false);
      writeFileSync(
        join(out, "100-tasks.png"),
        execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
      );
    },
  );

  await check(
    "Task-only API rejects cross-workspace changes and expired access is read-only",
    async () => {
      const d = database(fixture.url);
      const foreign = await d
        .prepare(
          "SELECT id,revision,stage FROM tasks WHERE tenant_id='brightpath' LIMIT 1",
        )
        .get();
      if (foreign)
        assert.equal(
          (
            await nativeApi(
              "/api/workspace/tasks/" + foreign.id,
              { stage: foreign.stage, revision: foreign.revision },
              "PATCH",
            )
          ).status,
          404,
        );
      const subscription = await d
        .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
        .get();
      await d
        .prepare(
          "UPDATE subscriptions SET status='expired' WHERE tenant_id='northstar'",
        )
        .run();
      assert.equal((await nativeApi("/api/mobile")).data.writable, false);
      assert.equal(
        (
          await nativeApi("/api/workspace/tasks", {
            title: "Blocked QA write",
            important: false,
            urgent: false,
          })
        ).status,
        403,
      );
      await d
        .prepare(
          "UPDATE subscriptions SET status=? WHERE tenant_id='northstar'",
        )
        .run(subscription.status);
      await d.close();
    },
  );
  if (process.env.HUMETO_ANDROID_LIVE_AI === "1")
    await check(
      "Live GPT-5.4 mini responds through native Android assistant",
      async () => {
        backend.kill("SIGTERM");
        await new Promise((r) => backend.once("exit", r));
        backend = start(
          process.execPath,
          [
            "node_modules/next/dist/bin/next",
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(p),
          ],
          { ...env, HUMETO_AGENT_PROVIDER: "openai" },
          "live-backend",
        );
        for (let i = 0; i < 100; i++) {
          try {
            if ((await fetch(`http://127.0.0.1:${p}/login`)).ok) break;
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }
        await cdp.click("Chat");
        await cdp.click("New conversation");
        await cdp.fill(
          'textarea[aria-label="Message Humeto"]',
          "Create a task to review the Android release tomorrow",
        );
        await cdp.click("Send message");
        await cdp.wait(
          `window.Capacitor.Plugins.CapacitorHttp.request({url:${JSON.stringify(qaOrigin)}+'/api/agent?timezone=Asia%2FKarachi',method:'GET',headers:{Origin:${JSON.stringify(qaOrigin)}},responseType:'json'}).then(r=>r.data.messages.at(-1)?.result?.engine==='OpenAI'&&r.data.messages.at(-1)?.result?.action?.payload?.title.toLowerCase().includes('android release'))`,
          40000,
        );
        const state = await nativeApi("/api/agent?timezone=Asia%2FKarachi");
        assert.equal(state.data.engine, "OpenAI");
        assert.equal(state.data.modelConfigured, true);
        assert.equal(
          state.data.messages.at(-1).result.action.payload.kind,
          "create",
        );
        await cdp.click("Cancel");
        await cdp.wait(`document.body.innerText.includes('cancelled')`);
        const routine = await nativeApi("/api/workspace/planning", {
          action: "routine",
          title: "Review pending enquiries",
          kind: "operations",
          frequency: "daily",
          firstDay: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          time: "09:00",
          timezone: "UTC",
        });
        assert.equal(routine.status, 200);
        const wording = await nativeApi("/api/workspace/planning", {
          action: "wording-generate",
          id: routine.data.id,
        });
        assert.equal(wording.status, 200, JSON.stringify(wording.data));
        assert.equal(wording.data.model, "gpt-5.4-mini");
        assert.ok(wording.data.variants.length >= 2);
        const planning = (await nativeApi("/api/workspace/planning")).data;
        assert.equal(
          planning.routines.find((r) => r.id === routine.data.id)
            .wording_enabled,
          false,
        );
      },
    );
  await check(
    "Phone layout has no horizontal overflow; native screenshot captured",
    async () => {
      await cdp.click("Plans");
      await cdp.wait(`document.querySelector('h1')?.textContent==='Plans'`);
      assert.equal(
        await cdp.evaluate("document.documentElement.scrollWidth>innerWidth"),
        false,
      );
      writeFileSync(
        join(out, "goals.png"),
        execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
      );
      await cdp.click("Today");
      writeFileSync(
        join(out, "today.png"),
        execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
      );
    },
  );
  await check(
    "Android alert preferences configure tone/vibration channels, inspect device settings and deliver a timed test",
    async () => {
      await cdp.click("Reminders");
      await cdp.wait(
        `Boolean(document.querySelector('select[aria-label="Reminder tone"]'))`,
      );
      const health = await cdp.evaluate(
        `window.Capacitor.Plugins.HumetoDevice.status()`,
      );
      assert.equal(health.platform, "Android");
      assert.equal(typeof health.notificationVolume, "number");
      await cdp.select('select[aria-label="Reminder tone"]', "bell");
      await cdp.evaluate(
        `(()=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('Vibrate when supported'));const e=l.querySelector('input');if(e.checked)e.click();})()`,
      );
      await cdp.click("Save alert preferences");
      await cdp.wait(
        `document.body.innerText.includes('Alert preferences saved.')`,
      );
      const p = (await nativeApi("/api/workspace/scheduling")).data.preferences;
      assert.equal(p.tone, "bell");
      assert.equal(p.vibration, false);
      await cdp.click("Send test alert");
      await cdp.wait(
        `window.Capacitor.Plugins.LocalNotifications.getDeliveredNotifications().then(r=>r.notifications.some(n=>n.id===2000000001))`,
        20000,
      );
      const channels = await cdp.evaluate(
        `window.Capacitor.Plugins.LocalNotifications.listChannels()`,
      );
      assert.ok(
        channels.channels.some(
          (c) => c.id.startsWith("humeto-quiet-") && !c.sound,
        ),
        "Gentle channels must have no Android sound",
      );
      assert.ok(
        channels.channels.some(
          (c) => c.id === "humeto-bell-still-v1" && c.vibration === false,
        ),
      );
      await cdp.click("Close");
    },
  );
  await check(
    "Native calendar preserves repeating history while Later routines remain quiet",
    async () => {
      await cdp.click("Plans");
      await cdp.wait(`document.querySelector('h1')?.textContent==='Plans'`);
      assert.ok(
        (await nativeApi("/api/mobile")).data.goals.find(
          (g) => g.title === "Android QA goal",
        ).target_date,
      );
      assert.equal(
        await cdp.evaluate(
          `Array.from(document.querySelectorAll('.plan-sections button')).some(b=>b.textContent==='Routines')`,
        ),
        false,
      );
      assert.equal(
        await cdp.evaluate(
          `!!document.querySelector('select[aria-label="Add plan"] option[value="routines"]')`,
        ),
        false,
      );
      await cdp.click("Today");
      await cdp.wait(
        `!!document.querySelector('[aria-label="Daily task tracking"]')`,
      );
      await cdp.click("Add task from Today");
      await cdp.fill('input[name="title"]', "Android daily task");
      await cdp.select('select[name="repeat"]', "daily");
      await cdp.click("Create task");
      await cdp.wait(`!document.querySelector('[role=dialog]')`);
      await cdp.wait(
        `Array.from(document.querySelectorAll('.daily-title')).some(e=>e.textContent.includes('Android daily task'))`,
      );
      await cdp.click("Mark Android daily task done");
      await cdp.wait(
        `Array.from(document.querySelectorAll('.daily-done')).some(e=>e.textContent.includes('Android daily task'))`,
      );
      const series = (
        await nativeApi("/api/workspace/planning")
      ).data.routines.find((r) => r.title === "Android daily task");
      assert.ok(
        series &&
          series.frequency === "daily" &&
          series.next_day > series.first_day,
      );
      const annual = await nativeApi("/api/workspace/planning", {
        action: "routine",
        title: "Android annual renewal",
        kind: "subscription",
        frequency: "yearly",
        firstDay: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Karachi",
        }).format(new Date()),
        time: "00:00",
        timezone: "Asia/Karachi",
      });
      assert.equal(annual.status, 200);
      await cdp.evaluate(`window.dispatchEvent(new Event('online'))`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal(
        await cdp.evaluate(
          `window.Capacitor.Plugins.LocalNotifications.getPending().then(r=>r.notifications.some(n=>n.body==='Android annual renewal'))`,
        ),
        false,
      );
      const planning = (await nativeApi("/api/workspace/planning")).data;
      assert.ok(
        planning.routines.some(
          (r) =>
            r.title === "Android annual renewal" &&
            r.frequency === "yearly" &&
            r.routine_kind === "subscription",
        ),
      );
      await cdp.click("Today");
      await cdp.click("Calendar");
      assert.equal(
        await cdp.evaluate("document.documentElement.scrollWidth>innerWidth"),
        false,
      );
      writeFileSync(
        join(out, "calendar.png"),
        execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
      );
    },
  );
  await check(
    "Native project chat records audio and break chat stays text-only with anonymous aliases",
    async () => {
      await cdp.click("Chat");
      await cdp.click("Project chats");
      await cdp.wait(
        `!!document.querySelector('select[aria-label="Project chat"] option[value="demo-project-intake"]')`,
      );
      await cdp.select(
        'select[aria-label="Project chat"]',
        "demo-project-intake",
      );
      await cdp.wait(`document.body.innerText.includes('Record voice note')`);
      adbRun([
        "shell",
        "pm",
        "grant",
        "com.humeto.tasks.qa",
        "android.permission.RECORD_AUDIO",
      ]);
      await cdp.click("Record voice note");
      await cdp.wait(`document.body.innerText.includes('Send voice note')`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await cdp.click("Send voice note");
      await cdp.wait(`document.body.innerText.includes('Play voice note')`);
      await cdp.click("Play voice note");
      await cdp.wait(`!!document.querySelector('audio[controls]')`);
      await cdp.wait(`document.querySelector('audio')?.readyState>=1`);
      assert.ok(
        await cdp.evaluate(`document.querySelector('audio').duration<=60`),
      );
      const imageReply = await nativeApi(
        "/api/project-sharing?projectId=demo-project-intake",
        {
          operation: "upload",
          name: "native-preview.webp",
          bytes: readFileSync(join(root, "public/assets/campus.webp")).toString(
            "base64",
          ),
        },
      );
      assert.equal(imageReply.status, 200);
      await cdp.wait(`document.body.innerText.includes('View image')`);
      await cdp.click("View image");
      await cdp.wait(
        `!![...document.querySelectorAll('img')].find(i=>i.alt==='Shared project attachment' && i.naturalWidth>0)`,
      );

      await cdp.click("Break chat");
      await cdp.wait(
        `document.body.innerText.includes('Keep this a kind place')`,
      );
      await cdp.evaluate(
        `document.querySelector('.break-rules input[type=checkbox]').click()`,
      );
      await cdp.evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Join as ')).click()`,
      );
      await cdp.wait(
        `!!document.querySelector('textarea[aria-label="Break chat message"]')`,
      );
      assert.equal(
        await cdp.evaluate(
          `document.querySelector('[aria-label="Anonymous break chat"]').querySelectorAll('input[type=file],audio').length`,
        ),
        0,
      );
      await cdp.fill(
        'textarea[aria-label="Break chat message"]',
        "f.u.c.k off",
      );
      await cdp.click("Send message");
      await cdp.wait(
        `document.body.innerText.includes('Please use respectful language')`,
      );
      await cdp.click("Humeto AI");
    },
  );
  await check(
    "Logout revokes native cookie session and clears notifications",
    async () => {
      await cdp.click("Account settings");
      await cdp.click("Sign out");
      await cdp.wait(`Boolean(document.querySelector('input[name=email]'))`);
      assert.equal((await nativeApi("/api/mobile")).status, 401);
      assert.equal(
        await cdp.evaluate(
          `window.Capacitor.Plugins.LocalNotifications.getPending().then(r=>r.notifications.length)`,
        ),
        0,
      );
    },
  );

  await check(
    "Android signup and password reset reuse email verification without real mail",
    async () => {
      await cdp.click("New to Humeto? Create an account");
      await cdp.fill("input[name=name]", "Android New User");
      await cdp.fill("input[name=email]", "android-new-user@example.test");
      await cdp.fill("input[name=password]", "Android signup QA password!");
      await cdp.click("Start free trial");
      await cdp.wait(
        `document.body.innerText.includes('Check your email to verify your account')`,
      );
      assert.equal(
        (
          await nativeApi("/api/auth/login", {
            email: "android-new-user@example.test",
            password: "Android signup QA password!",
          })
        ).status,
        403,
      );
      await cdp.click("Forgot password?");
      await cdp.fill("input[name=email]", "android-new-user@example.test");
      await cdp.click("Send reset link");
      await cdp.wait(
        `document.body.innerText.includes('Check your email for the password reset link')`,
      );
    },
  );
  success = true;
  console.log(`Android acceptance: ${results.length} checks passed.`);
} catch (e) {
  results.push({ name: "Failure", status: "failed", error: e.message });
  writeFileSync(join(out, "report.json"), JSON.stringify({ results }, null, 2));
  console.error(e.message);
  if (cdp)
    try {
      writeFileSync(
        join(out, "failure-ui.txt"),
        await cdp.evaluate("document.body.innerText"),
      );
      writeFileSync(
        join(out, "failure.png"),
        execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
      );
    } catch {}
  process.exitCode = 1;
} finally {
  cdp?.close();
  try {
    if (serial) {
      adbRun(["shell", "am", "force-stop", "com.humeto.tasks.qa"]);
      adbRun(["forward", "--remove", `tcp:${forward}`]);
    }
  } catch {}
  if (backend && backend.exitCode === null) {
    backend.kill("SIGTERM");
    await new Promise((r) => backend.once("exit", r));
  }
  if (fixture) {
    if (success) await fixture.cleanup();
    else await fixture.disconnect();
  }
  if (emu && !process.env.HUMETO_ANDROID_KEEP_EMULATOR)
    try {
      adbRun(["emu", "kill"]);
    } catch {}
  for (const fd of logs) closeSync(fd);
  // Always restore production assets and the normal package ID after QA.
  try {
    await run(
      "npm",
      ["run", "build"],
      process.env,
      "restore-web",
      join(root, "mobile"),
    );
    await run(
      "npx",
      ["cap", "sync", "android"],
      process.env,
      "restore-sync",
      join(root, "mobile"),
    );
    await run(
      "./gradlew",
      ["assembleDebug"],
      process.env,
      "restore-apk",
      join(root, "mobile/android"),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  if (!success && fixture)
    console.error("Isolated failure database retained: " + fixture.name);
}
