import type { Database } from "./postgres.mjs";
import { withTransaction } from "./db";
export async function seedTaskProgress(d: Database) {
  if (!(await d.prepare("SELECT id FROM tenants WHERE id='northstar'").get()))
    return;
  if (
    await d
      .prepare("SELECT name FROM demo_migrations WHERE name='task-progress-v1'")
      .get()
  )
    return;
  try {
    const transactionResult = await withTransaction(async () => {
      for (const [pid, title, desc, date] of [
        [
          "demo-project-intake",
          "UK September intake",
          "Prepare a complete, calm application journey for the next intake.",
          "2027-06-30",
        ],
        [
          "demo-project-partners",
          "Build our partner network",
          "Turn useful conversations into long-term education partnerships.",
          "2026-12-31",
        ],
      ])
        await d
          .prepare(
            "INSERT INTO projects(id,tenant_id,title,description,target_date,created_by) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(pid, "northstar", title, desc, date, "ayesha");
      for (const [gid, title, desc] of [
        [
          "demo-goal-ready",
          "Make every application ready to review",
          "Improve document completeness and make the handoff easier for applicants and consultants.",
        ],
        [
          "demo-goal-partners",
          "Grow dependable partnerships",
          "Build a smaller network of engaged partners with clear next steps.",
        ],
      ])
        await d
          .prepare(
            "INSERT INTO goals(id,tenant_id,title,description,created_by) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(gid, "northstar", title, desc, "ayesha");
      const items = [
        [
          "demo-progress-checklist",
          "Prepare the shared document checklist",
          "demo-project-intake",
          "demo-goal-ready",
          "Done",
        ],
        [
          "demo-progress-dates",
          "Confirm UK intake deadlines",
          "demo-project-intake",
          "demo-goal-ready",
          "Done",
        ],
        [
          "demo-progress-passports",
          "Follow up on pending passports",
          "demo-project-intake",
          "demo-goal-ready",
          "In progress",
        ],
        [
          "demo-progress-offers",
          "Review the next offer-letter batch",
          "demo-project-intake",
          "demo-goal-ready",
          "Review",
        ],
        [
          "demo-progress-partners",
          "Schedule a welcome call with new partners",
          "demo-project-partners",
          "demo-goal-partners",
          "To do",
        ],
      ];
      for (const [tid, title, pid, gid, stage] of items) {
        await d
          .prepare(
            "INSERT INTO tasks(id,tenant_id,title,project_id,assignee,important,due_date,last_actor_id) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING",
          )
          .run(
            tid,
            "northstar",
            title,
            pid,
            "Ayesha Khan",
            "2026-10-22",
            "ayesha",
          );
        await d
          .prepare(
            "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
          )
          .run("northstar", tid, gid);
        if (stage !== "To do")
          await d
            .prepare("UPDATE tasks SET stage=?,revision=revision+1 WHERE id=?")
            .run(stage, tid);
      }
      await d
        .prepare("INSERT INTO demo_migrations(name) VALUES('task-progress-v1')")
        .run();
    });
    if (transactionResult !== undefined) return transactionResult;
  } catch (e) {
    throw e;
  }
}
