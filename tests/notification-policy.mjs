import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  priorityTier,
  notificationCandidates,
  selectNotifications,
} from "../shared/notification-policy.mjs";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const now = new Date("2026-10-25T10:00:00Z"),
  prefs = {
    enabled: true,
    timezone: "UTC",
    quiet_enabled: true,
    quiet_start: "22:00",
    quiet_end: "08:00",
    daily_limit: 3,
    focus_alerts: false,
  };
const automatic = (n, important = 1, urgent = 1) => ({
  key: "auto:" + n,
  kind: "automatic",
  title: "Task " + n,
  taskIds: ["t" + n],
  at: `2026-10-25T10:0${n}:00Z`,
  day: "2026-10-25",
  tier: priorityTier({ important, urgent }),
});
test("priority alerts batch automatic work, cap at three and one sound, leaving explicit reminders outside the budget", () => {
  assert.deepEqual(
    [
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0],
    ].map(([important, urgent]) => priorityTier({ important, urgent })),
    ["audible", "gentle", "gentle", "silent"],
  );
  const auto = [1, 2, 3, 4, 5].map((n) => automatic(n));
  const manual = { ...automatic(6), key: "manual:6", kind: "manual" };
  const out = selectNotifications([...auto, manual], [], prefs, now);
  assert.equal(out.filter((r) => r.kind === "automatic").length, 3);
  assert.equal(
    out.filter((r) => r.kind === "automatic" && r.tier === "audible").length,
    1,
  );
  assert.ok(out.some((r) => r.kind === "manual"));
  const batched = selectNotifications(
    [
      automatic(1),
      {
        ...automatic(1),
        key: "auto:other",
        title: "Other",
        taskIds: ["other"],
      },
    ],
    [],
    prefs,
    now,
  );
  assert.equal(batched.length, 1);
  assert.equal(batched[0].taskIds.length, 2);
});
test("reopening batches overdue automatic work and leaves old deliberate reminders in-app", () => {
  const overdue = [1, 2, 3].map((n) => ({
    ...automatic(n),
    at: `2026-10-25T09:0${n}:00Z`,
  }));
  const out = selectNotifications(overdue, [], prefs, now);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceKeys.length, 3);
  const history = [{ ...out[0], device_id: "phone", payload: out[0] }];
  assert.equal(
    selectNotifications(
      [...overdue, { ...automatic(4), at: "2026-10-25T09:04:00Z" }],
      history,
      prefs,
      now,
    ).length,
    0,
  );
  assert.equal(
    notificationCandidates({
      prefs,
      now,
      reminders: [
        {
          id: "missed",
          task_id: "t",
          origin: "manual",
          title: "Missed",
          remind_at: "2026-10-25T09:00:00Z",
          important: 1,
          urgent: 1,
        },
      ],
    }).length,
    0,
  );
});
test("quiet hours postpone automatic nudges, retain explicitly chosen times silently, and exclude Later and optional focus by default", () => {
  const reminders = [
    {
      id: "a",
      task_id: "t1",
      title: "Automatic",
      origin: "automatic",
      remind_at: "2026-10-25T23:00:00Z",
      important: 1,
      urgent: 1,
    },
    {
      id: "b",
      task_id: "t2",
      title: "Explicit",
      origin: "manual",
      remind_at: "2026-10-25T23:00:00Z",
      important: 1,
      urgent: 1,
    },
    {
      id: "c",
      task_id: "t3",
      title: "Later",
      origin: "automatic",
      remind_at: "2026-10-25T12:00:00Z",
      important: 0,
      urgent: 0,
    },
  ];
  const out = notificationCandidates({
    reminders,
    prefs,
    now: new Date("2026-10-25T20:00:00Z"),
    focus: {
      id: "f",
      task_id: "t",
      state: "running",
      check_in_at: "2026-10-25T23:00:00Z",
    },
  });
  assert.equal(out.length, 2);
  assert.equal(
    out.find((r) => r.kind === "automatic").at,
    "2026-10-26T08:00:00.000Z",
  );
  assert.equal(out.find((r) => r.kind === "manual").at, "2026-10-25T23:00:00Z");
  assert.equal(out.find((r) => r.kind === "manual").tier, "silent");
  assert.equal(
    notificationCandidates({
      prefs: { ...prefs, focus_alerts: true },
      focus: {
        id: "f",
        task_id: "t",
        state: "running",
        check_in_at: "2026-10-25T12:00:00Z",
      },
      now,
    }).length,
    1,
  );
});
test("delivered automatic occurrences never repeat after a scheduler timestamp changes; spent budgets survive refresh", () => {
  const first = selectNotifications([automatic(1)], [], prefs, now)[0];
  const history = [
    {
      ...first,
      device_id: "phone",
      at: "2026-10-25T09:00:00Z",
      payload: first,
    },
  ];
  assert.equal(
    selectNotifications(
      [{ ...automatic(1), at: "2026-10-25T10:30:00Z" }],
      history,
      prefs,
      now,
    ).length,
    0,
  );
  const spent = [1, 2, 3].map((n) => ({
    ...automatic(n),
    device_id: "phone",
    at: "2026-10-25T09:00:00Z",
  }));
  assert.equal(
    selectNotifications([automatic(4)], spent, prefs, now).length,
    0,
  );
});
const base = process.env.HUMETO_TEST_URL;
if (base) {
  const d = database(),
    tasks = [],
    contexts = [];
  let original;
  async function ctx(user = "consultant") {
    const c = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
    contexts.push(c);
    await c.post("/api/auth/demo", { data: { userId: user } });
    return c;
  }
  after(async () => {
    for (const id of tasks)
      await d.query("DELETE FROM tasks WHERE id=$1", [id]);
    await d.query(
      "DELETE FROM notification_dispatches WHERE tenant_id='northstar' AND user_id='consultant'",
    );
    if (original)
      await d.query(
        "UPDATE task_followup_preferences SET quiet_enabled=$1,timezone=$2,daily_limit=$3,focus_alerts=$4 WHERE tenant_id='northstar' AND user_id='consultant'",
        [
          original.quiet_enabled,
          original.timezone,
          original.daily_limit,
          original.focus_alerts,
        ],
      );
    else
      await d.query(
        "DELETE FROM task_followup_preferences WHERE tenant_id='northstar' AND user_id='consultant'",
      );
    for (const c of contexts) await c.dispose();
    await d.close();
  });
  test("server plans enforce one recipient device, share caps, retain explicit reminders, and cancel completed tasks", async () => {
    const c = await ctx();
    original = (
      await d.query(
        "SELECT * FROM task_followup_preferences WHERE tenant_id='northstar' AND user_id='consultant'",
      )
    ).rows[0];
    await d.query(
      "INSERT INTO task_followup_preferences(tenant_id,user_id,quiet_enabled,timezone,daily_limit) VALUES('northstar','consultant',false,'UTC',3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET quiet_enabled=false,timezone='UTC',daily_limit=3",
    );
    for (let n = 0; n < 8; n++) {
      const id = randomUUID();
      tasks.push(id);
      await d.query(
        "INSERT INTO tasks(id,tenant_id,title,important,urgent) VALUES($1,'northstar',$2,1,1)",
        [id, "Notification QA " + n],
      );
      await d.query(
        "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone,origin,source_key) VALUES($1,'northstar','consultant',$2,$3,'UTC',$4,$5)",
        [
          randomUUID(),
          id,
          new Date(
            Date.parse(
              new Date(Date.now() + 86400000).toISOString().slice(0, 10) +
                "T12:00:00Z",
            ) +
              n * 120000,
          ).toISOString(),
          n < 4 ? "automatic" : "manual",
          "qa:" + id,
        ],
      );
    }
    const deviceId = randomUUID();
    let r = await c.post("/api/notification-plan", {
      data: { deviceId, platform: "native" },
    });
    assert.equal(r.status(), 200, await r.text());
    const plan = await r.json();
    assert.equal(plan.events.filter((e) => e.kind === "automatic").length, 3);
    assert.equal(
      plan.events.filter((e) => e.kind === "automatic" && e.tier === "audible")
        .length,
      1,
    );
    assert.equal(plan.events.filter((e) => e.kind === "manual").length, 4);
    assert.equal(
      (
        await (
          await c.post("/api/notification-plan", {
            data: { deviceId: randomUUID(), platform: "native" },
          })
        ).json()
      ).events.length,
      0,
    );
    assert.equal(
      (
        await (
          await c.post("/api/notification-plan", {
            data: { deviceId: randomUUID(), platform: "web" },
          })
        ).json()
      ).events.length,
      0,
    );
    for (const id of tasks)
      await d.query("UPDATE tasks SET stage='Done' WHERE id=$1", [id]);
    assert.equal(
      (
        await (
          await c.post("/api/notification-plan", {
            data: { deviceId, platform: "native" },
          })
        ).json()
      ).events.length,
      0,
    );
    const foreign = await ctx("bright-owner");
    assert.equal(
      (
        await (
          await foreign.post("/api/notification-plan", {
            data: { deviceId, platform: "native" },
          })
        ).json()
      ).events.some((e) => e.taskIds.some((t) => tasks.includes(t))),
      false,
    );
  });
  test("project alerts are muted by default, opt in gently, and stay quiet while reading the project", async () => {
    const c = await ctx(),
      owner = await ctx("ayesha"),
      project = randomUUID(),
      deviceId = randomUUID();
    try {
      await d.query(
        "INSERT INTO projects(id,tenant_id,title,status,created_by) VALUES($1,'northstar','Quiet chat QA','To do','Ayesha Khan')",
        [project],
      );
      await d.query(
        "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES('northstar','project',$1,'consultant','ayesha')",
        [project],
      );
      const path = "/api/project-sharing?projectId=" + project;
      assert.equal((await (await c.get(path)).json()).chatMuted, true);
      assert.equal(
        (
          await c.post(path, {
            data: { operation: "chat-alerts", muted: false },
          })
        ).status(),
        200,
      );
      await owner.post(path, {
        data: {
          operation: "comment",
          content: "A fictional new project message",
        },
      });
      const r = await c.post("/api/notification-plan", {
        data: { deviceId, platform: "native" },
      });
      assert.equal(r.status(), 200, await r.text());
      const p = await r.json();
      const update = p.events.find((e) => e.kind === "project");
      assert.ok(update);
      assert.equal(update.tier, "gentle");
      const preserved = await (
        await c.post("/api/notification-plan", {
          data: { deviceId, platform: "native" },
        })
      ).json();
      assert.ok(
        preserved.events.some((e) => e.key === update.key),
        "an early refresh must not cancel a pending chat alert",
      );
      const reading = await (
        await c.post("/api/notification-plan", {
          data: { deviceId, platform: "native", activeProjectId: project },
        })
      ).json();
      assert.ok(!reading.events.some((e) => e.kind === "project"));
      await c.post(path, { data: { operation: "chat-alerts", muted: true } });
      assert.equal((await (await c.get(path)).json()).chatMuted, true);
    } finally {
      await d.query("DELETE FROM projects WHERE id=$1", [project]);
      await d.query("DELETE FROM work_assignments WHERE entity_id=$1", [
        project,
      ]);
    }
  });
}
