import type { DatabaseSync } from "node:sqlite";
export function initializeTaskProgress(d: DatabaseSync) {
  const cols = d
    .prepare("PRAGMA table_info(tasks)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("project_id"))
    d.exec(
      "ALTER TABLE tasks ADD COLUMN project_id TEXT NOT NULL DEFAULT ''; ALTER TABLE tasks ADD COLUMN completed_at TEXT; ALTER TABLE tasks ADD COLUMN last_actor_id TEXT NOT NULL DEFAULT ''",
    );
  d.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Active',target_date TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Active',target_date TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS task_goals(tenant_id TEXT NOT NULL,task_id TEXT NOT NULL,goal_id TEXT NOT NULL,PRIMARY KEY(task_id,goal_id));
 CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,task_id TEXT NOT NULL,event TEXT NOT NULL,from_stage TEXT NOT NULL,to_stage TEXT NOT NULL,title TEXT NOT NULL,project_id TEXT NOT NULL,project_title TEXT NOT NULL,goals_json TEXT NOT NULL DEFAULT '[]',actor_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE INDEX IF NOT EXISTS idx_task_events_scope ON task_events(tenant_id,created_at,task_id);
 CREATE TABLE IF NOT EXISTS lead_followups(tenant_id TEXT NOT NULL,lead_id TEXT NOT NULL,follow_up TEXT NOT NULL,task_id TEXT NOT NULL,PRIMARY KEY(lead_id,follow_up));
 CREATE TRIGGER IF NOT EXISTS task_created_event AFTER INSERT ON tasks BEGIN
 INSERT INTO task_events(id,tenant_id,task_id,event,from_stage,to_stage,title,project_id,project_title,actor_id) VALUES(lower(hex(randomblob(16))),NEW.tenant_id,NEW.id,'created','',NEW.stage,NEW.title,NEW.project_id,COALESCE((SELECT title FROM projects WHERE id=NEW.project_id AND tenant_id=NEW.tenant_id),''),NEW.last_actor_id);
 END;
 CREATE TRIGGER IF NOT EXISTS task_stage_event AFTER UPDATE OF stage ON tasks WHEN OLD.stage<>NEW.stage BEGIN
 UPDATE tasks SET completed_at=CASE WHEN NEW.stage='Done' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id=NEW.id;
 INSERT INTO task_events(id,tenant_id,task_id,event,from_stage,to_stage,title,project_id,project_title,goals_json,actor_id)
 VALUES(lower(hex(randomblob(16))),NEW.tenant_id,NEW.id,CASE WHEN NEW.stage='Done' THEN 'completed' WHEN OLD.stage='Done' THEN 'reopened' ELSE 'stage_changed' END,OLD.stage,NEW.stage,NEW.title,NEW.project_id,COALESCE((SELECT title FROM projects WHERE id=NEW.project_id AND tenant_id=NEW.tenant_id),''),COALESCE((SELECT json_group_array(json_object('id',g.id,'title',g.title)) FROM task_goals l JOIN goals g ON g.id=l.goal_id AND g.tenant_id=l.tenant_id WHERE l.task_id=NEW.id AND l.tenant_id=NEW.tenant_id),'[]'),NEW.last_actor_id);
 UPDATE task_reminders SET status='completed' WHERE task_id=NEW.id AND tenant_id=NEW.tenant_id AND status='scheduled' AND NEW.stage='Done';
 END;`);
}

export function seedTaskProgress(d: DatabaseSync) {
  if (!d.prepare("SELECT id FROM tenants WHERE id='northstar'").get()) return;
  if (
    d
      .prepare("SELECT name FROM demo_migrations WHERE name='task-progress-v1'")
      .get()
  )
    return;
  d.exec("BEGIN IMMEDIATE");
  try {
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
      d.prepare(
        "INSERT OR IGNORE INTO projects(id,tenant_id,title,description,target_date,created_by) VALUES(?,?,?,?,?,?)",
      ).run(pid, "northstar", title, desc, date, "ayesha");
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
      d.prepare(
        "INSERT OR IGNORE INTO goals(id,tenant_id,title,description,created_by) VALUES(?,?,?,?,?)",
      ).run(gid, "northstar", title, desc, "ayesha");
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
      d.prepare(
        "INSERT OR IGNORE INTO tasks(id,tenant_id,title,project_id,assignee,important,due_date,last_actor_id) VALUES(?,?,?,?,?,1,?,?)",
      ).run(
        tid,
        "northstar",
        title,
        pid,
        "Ayesha Khan",
        "2026-10-22",
        "ayesha",
      );
      d.prepare(
        "INSERT OR IGNORE INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
      ).run("northstar", tid, gid);
      if (stage !== "To do")
        d.prepare(
          "UPDATE tasks SET stage=?,revision=revision+1 WHERE id=?",
        ).run(stage, tid);
    }
    d.prepare(
      "INSERT INTO demo_migrations(name) VALUES('task-progress-v1')",
    ).run();
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
