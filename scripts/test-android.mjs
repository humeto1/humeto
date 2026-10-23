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
import { randomBytes, scryptSync } from "node:crypto";
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
      await cdp.click("Create task");
      await cdp.wait(`!document.querySelector('[role=dialog]')`);
      const r = await nativeApi("/api/mobile");
      const t = r.data.tasks.find((t) => t.title === title);
      assert.ok(t);
      taskId = t.id;
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
    "Create projects/goals and link native tasks to their shared records",
    async () => {
      await cdp.click("Goals");
      await cdp.click("Create project or goal");
      await cdp.select("select[name=kind]", "goals");
      await cdp.fill("input[name=title]", "Android QA goal");
      await cdp.fill("input[name=targetDate]", "2027-03-31");
      await cdp.click("Create");
      await cdp.wait(`!document.querySelector('[role=dialog]')`);
      await cdp.click("Create project or goal");
      await cdp.fill("input[name=title]", "Android QA project");
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
      await cdp.select("select[name=projectId]", project.id);
      await cdp.evaluate(
        `document.querySelector('input[name=goalIds][value="${goal.id}"]').click()`,
      );
      await cdp.click("Save project & goals");
      await cdp.wait(
        `document.body.innerText.includes('Project links saved.')`,
      );
      const linked = (await nativeApi("/api/mobile")).data.tasks.find(
        (t) => t.id === taskId,
      );
      assert.equal(linked.project_id, project.id);
      assert.ok(linked.goals.some((g) => g.id === goal.id));
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
    "Assistant prepares and cancels a proposal without applying it",
    async () => {
      await cdp.click("Assistant");
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
    "Focus session starts, pauses, resumes and records completion",
    async () => {
      await cdp.click("Focus");
      await cdp.wait(
        `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes(${JSON.stringify(title + " updated")})&&!e.disabled)`,
      );
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes(${JSON.stringify(title + " updated")})&&!e.disabled).click()`,
      );
      await cdp.wait(`document.body.innerText.includes('Time spent')`);
      await cdp.click("Pause");
      await cdp.wait(
        `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Resume')`,
      );
      await cdp.click("Resume");
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
          `!document.querySelector('[role=dialog]') && document.querySelector('.focus-session h2')?.textContent===${JSON.stringify(name)}`,
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
      await cdp.click("Finished");
      await cdp.wait(
        `document.body.innerText.includes('What would you like to move forward?')`,
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
      await cdp.click("Assistant");
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
        await cdp.click("Assistant");
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
      await cdp.click("Goals");
      await cdp.wait(`document.body.innerText.includes('Projects & goals')`);
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
          (c) => c.id === "humeto-bell-still-v1" && c.vibration === false,
        ),
      );
      await cdp.click("Close");
    },
  );
  await check(
    "Native calendar has shared goal deadlines and yearly subscription routines schedule device alerts",
    async () => {
      await cdp.click("Goals");
      await cdp.wait(
        `document.body.innerText.includes('Goals, projects & routines')`,
      );
      assert.ok(
        (await nativeApi("/api/mobile")).data.goals.find(
          (g) => g.title === "Android QA goal",
        ).target_date,
      );
      await cdp.click("Routines & operations");
      await cdp.click("Add routine");
      await cdp.fill(
        "form.planning-form input[name=title]",
        "Android annual renewal",
      );
      await cdp.select('select[aria-label="Routine kind"]', "subscription");
      await cdp.select('select[aria-label="Routine frequency"]', "yearly");
      const tomorrow = new Date(Date.now() + 86400000)
        .toISOString()
        .slice(0, 10);
      await cdp.fill("input[name=firstDay]", tomorrow);
      await cdp.click("Save routine");
      await cdp.wait(`document.body.innerText.includes('Routine saved.')`);
      await cdp.wait(
        `window.Capacitor.Plugins.LocalNotifications.getPending().then(r=>r.notifications.some(n=>n.body==='Android annual renewal'))`,
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
