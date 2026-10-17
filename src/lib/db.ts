import { initializeUpdateInbox, seedUpdateInbox } from "./update-inbox-schema";
import {
  initializeRequestWorkflow,
  seedRequestWorkflow,
} from "./request-schema";
import { initializeCrmAgent } from "./crm-agent-schema";
import { initializeTaskProgress, seedTaskProgress } from "./task-schema";
import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
export const dataDir = resolve(
  /*turbopackIgnore: true*/ process.env.HUMETO_DATA_DIR || ".data",
);
const globalDb = globalThis as unknown as { humetoDb?: DatabaseSync };
export function db() {
  if (globalDb.humetoDb) return globalDb.humetoDb;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const d = new DatabaseSync(resolve(dataDir, "humeto.sqlite"));
  d.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),role TEXT NOT NULL,person_id TEXT,PRIMARY KEY(user_id,tenant_id));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,tenant_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_start INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,email TEXT NOT NULL,destination TEXT NOT NULL DEFAULT '',course TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'In progress',initials TEXT NOT NULL,color TEXT NOT NULL DEFAULT 'sage',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS intake(tenant_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),section_key TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}',state TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,person_id,section_key));
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),kind TEXT NOT NULL,country TEXT NOT NULL,institution TEXT NOT NULL,program TEXT NOT NULL,intake TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Draft',revision INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS application_snapshots(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,payload TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,person_id TEXT REFERENCES people(id),title TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'To do',important INTEGER NOT NULL DEFAULT 0,urgent INTEGER NOT NULL DEFAULT 0,due_date TEXT NOT NULL DEFAULT '',assignee TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),title TEXT NOT NULL,category TEXT NOT NULL,section_key TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Received',current_version INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS document_versions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),version INTEGER NOT NULL,original_name TEXT NOT NULL,stored_name TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(document_id,version));
CREATE TABLE IF NOT EXISTS import_runs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,person_id TEXT NOT NULL,name TEXT NOT NULL,expected_count INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'In progress',created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS import_items(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,run_id TEXT NOT NULL,source_path TEXT NOT NULL,document_id TEXT,status TEXT NOT NULL,UNIQUE(run_id,source_path));
CREATE TABLE IF NOT EXISTS requirements(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,label TEXT NOT NULL,section_key TEXT NOT NULL DEFAULT '',required INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'Pending',note TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),section_key TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Open',created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),plan TEXT NOT NULL DEFAULT 'Institute',status TEXT NOT NULL DEFAULT 'trial',seats INTEGER NOT NULL DEFAULT 5,case_limit INTEGER NOT NULL DEFAULT 100,storage_mb INTEGER NOT NULL DEFAULT 1024,expires_at TEXT NOT NULL DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS assist_tokens(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,person_id TEXT NOT NULL,section_keys TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS agent_threads(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS agent_messages(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,thread_id TEXT NOT NULL REFERENCES agent_threads(id),role TEXT NOT NULL,content TEXT NOT NULL,result TEXT NOT NULL DEFAULT '{}',client_key TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(thread_id,client_key));
CREATE TABLE IF NOT EXISTS agent_actions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,thread_id TEXT NOT NULL REFERENCES agent_threads(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',task_id TEXT,expires_at INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_reminders(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),remind_at TEXT NOT NULL,timezone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_agent_threads_scope ON agent_threads(tenant_id,user_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id,created_at);
CREATE INDEX IF NOT EXISTS idx_reminders_scope ON task_reminders(tenant_id,user_id,status,remind_at);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_people_tenant ON people(tenant_id);CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit(tenant_id,created_at);`);
  const versionCols = d
    .prepare("PRAGMA table_info(document_versions)")
    .all()
    .map((c) => c.name);
  if (!versionCols.includes("source_path"))
    d.exec(
      "ALTER TABLE document_versions ADD COLUMN source_path TEXT NOT NULL DEFAULT ''",
    );
  const appCols = d
    .prepare("PRAGMA table_info(applications)")
    .all()
    .map((c) => c.name);
  if (!appCols.includes("submission_reference"))
    d.exec(
      "ALTER TABLE applications ADD COLUMN submission_reference TEXT NOT NULL DEFAULT '';ALTER TABLE applications ADD COLUMN submitted_at TEXT NOT NULL DEFAULT ''",
    );
  d.exec(`CREATE TABLE IF NOT EXISTS application_events(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,from_status TEXT NOT NULL,to_status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',document_id TEXT NOT NULL DEFAULT '',document_version INTEGER NOT NULL DEFAULT 0,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inquiry_links(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),token_hash TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inquiry_limits(link_id TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT 'Manual',stage TEXT NOT NULL DEFAULT 'New',destination TEXT NOT NULL DEFAULT '',course TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',follow_up TEXT NOT NULL DEFAULT '',timeline TEXT NOT NULL DEFAULT '',expected_fee INTEGER NOT NULL DEFAULT 0,upfront_fee INTEGER NOT NULL DEFAULT 0,incentive INTEGER NOT NULL DEFAULT 0,extras TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1,person_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_email ON leads(tenant_id,email COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS case_finance(person_id TEXT PRIMARY KEY REFERENCES people(id),tenant_id TEXT NOT NULL,expected_fee INTEGER NOT NULL DEFAULT 0,upfront_fee INTEGER NOT NULL DEFAULT 0,incentive INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'PKR',timeline TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),amount INTEGER NOT NULL CHECK(amount>0),reference TEXT NOT NULL,client_key TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,client_key));`);
  const personCols = d
    .prepare("PRAGMA table_info(people)")
    .all()
    .map((c) => c.name);
  if (!personCols.includes("revision"))
    d.exec(
      "ALTER TABLE people ADD COLUMN revision INTEGER NOT NULL DEFAULT 1; ALTER TABLE people ADD COLUMN journey_stage TEXT NOT NULL DEFAULT 'Planning'",
    );
  initializeTaskProgress(d);
  initializeCrmAgent(d);
  initializeRequestWorkflow(d);
  initializeUpdateInbox(d);
  globalDb.humetoDb = d;
  if (process.env.HUMETO_LOCAL_DEMO === "true") {
    seed(d);
    seedCRM(d);
    seedTaskProgress(d);
    seedRequestWorkflow(d);
    seedUpdateInbox(d);
  }
  initializeChecklists(d);
  return d;
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function id() {
  return randomUUID();
}
export function audit(
  tenant: string,
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  db()
    .prepare(
      "INSERT INTO audit(id,tenant_id,actor_id,action,entity_type,entity_id,summary) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id(), tenant, actor, action, entityType, entityId, summary);
}
function seed(d: DatabaseSync) {
  if (d.prepare("SELECT id FROM tenants LIMIT 1").get()) return;
  d.exec("BEGIN");
  try {
    for (const [tid, name, type] of [
      ["northstar", "Northstar Education", "institute"],
      ["brightpath", "Brightpath Global", "institute"],
      ["individual", "Amira’s workspace", "individual"],
    ]) {
      d.prepare("INSERT INTO tenants(id,name,type) VALUES(?,?,?)").run(
        tid,
        name,
        type,
      );
      d.prepare(
        "INSERT INTO subscriptions(tenant_id,plan,status,seats,case_limit,storage_mb) VALUES(?,?,?,?,?,?)",
      ).run(
        tid,
        type === "individual" ? "Individual" : "Institute",
        "active",
        type === "individual" ? 1 : 5,
        type === "individual" ? 1 : 100,
        1024,
      );
    }
    const demoPass = hashPassword(randomBytes(32).toString("hex"));
    for (const [uid, name, email, tenant, role, pid] of [
      [
        "admin",
        "Platform Admin",
        "admin@humeto.example",
        "northstar",
        "platform_admin",
        null,
      ],
      [
        "ayesha",
        "Ayesha Khan",
        "ayesha@northstar.example",
        "northstar",
        "owner",
        null,
      ],
      [
        "consultant",
        "Leila Morgan",
        "leila@northstar.example",
        "northstar",
        "consultant",
        null,
      ],
      [
        "amira",
        "Amira Shah",
        "amira.shah@example.com",
        "northstar",
        "student",
        "amira",
      ],
      [
        "bright-owner",
        "Sam Green",
        "sam@brightpath.example",
        "brightpath",
        "owner",
        null,
      ],
      ["solo", "Amira Solo", "solo@example.com", "individual", "owner", null],
    ]) {
      d.prepare(
        "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
      ).run(uid, name, email, demoPass);
      d.prepare(
        "INSERT INTO memberships(user_id,tenant_id,role,person_id) VALUES(?,?,?,?)",
      ).run(uid, tenant, role, pid);
    }
    const students = [
      [
        "amira",
        "Amira Shah",
        "United Kingdom",
        "MSc Environmental Planning",
        "peach",
      ],
      ["omar", "Omar Farooq", "Canada", "Master of Data Science", "sage"],
      [
        "sofia",
        "Sofia Martinez",
        "Germany",
        "MSc Sustainable Design",
        "lavender",
      ],
      ["james", "James Tan", "New Zealand", "Master of Public Health", "sky"],
      [
        "fatima",
        "Fatima Ahmed",
        "United States",
        "MS Computer Science",
        "sand",
      ],
      ["daniel", "Daniel Mensah", "Ireland", "MSc Business Analytics", "rose"],
    ];
    for (const [pid, name, country, course, color] of students) {
      d.prepare(
        "INSERT INTO people(id,tenant_id,name,email,destination,course,initials,color) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        pid,
        "northstar",
        name,
        name.toLowerCase().replace(" ", ".") + "@example.com",
        country,
        course,
        name
          .split(" ")
          .map((x) => x[0])
          .join(""),
        color,
      );
      const data = {
        givenNames: name.split(" ")[0],
        familyName: name.split(" ")[1],
        birthDate: "2001-09-12",
        citizenship: "Pakistan",
      };
      d.prepare(
        "INSERT INTO intake(tenant_id,person_id,section_key,data,state) VALUES(?,?,?,?,?)",
      ).run("northstar", pid, "identity", JSON.stringify(data), "draft");
      d.prepare(
        "INSERT INTO intake(tenant_id,person_id,section_key,data,state) VALUES(?,?,?,?,?)",
      ).run(
        "northstar",
        pid,
        "education",
        JSON.stringify({
          items: [
            {
              _id: id(),
              institution: "Crescent College",
              country: "Pakistan",
              qualification: "Bachelor of Science",
              subject: "Sciences",
              completion: "Completed",
              startDate: "2019-09-01",
              endDate: "2023-06-30",
              grade: "3.4",
              maximumGrade: "4.0",
              language: "English",
            },
          ],
        }),
        "draft",
      );
      d.prepare(
        "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        "app-" + pid,
        "northstar",
        pid,
        "Admission",
        country,
        "Sample " + country + " University",
        course,
        "September 2027",
        "Draft",
      );
    }
    d.prepare(
      "INSERT INTO people(id,tenant_id,name,email,destination,course,initials,color) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      "bright-student",
      "brightpath",
      "Robin Davis",
      "robin@example.com",
      "Germany",
      "MSc Design",
      "RD",
      "sage",
    );
    d.prepare(
      "INSERT INTO people(id,tenant_id,name,email,destination,course,initials,color) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      "solo-student",
      "individual",
      "Amira Solo",
      "solo@example.com",
      "United Kingdom",
      "MSc Planning",
      "AS",
      "peach",
    );
    for (const [i, title, pid, stage, important, urgent, due] of [
      [1, "Review Amira’s transcript", "amira", "To do", 1, 1, "2026-10-19"],
      [2, "Request English test evidence", "omar", "To do", 1, 0, "2026-10-21"],
      [
        3,
        "Prepare study document bundle",
        "sofia",
        "In progress",
        1,
        1,
        "2026-10-20",
      ],
      [4, "Confirm provider details", "james", "Waiting", 0, 1, "2026-10-22"],
      [5, "Send funding checklist", "fatima", "Done", 1, 0, "2026-10-16"],
      [6, "Organize older certificates", "daniel", "To do", 0, 0, ""],
    ])
      d.prepare(
        "INSERT INTO tasks(id,tenant_id,person_id,title,stage,important,urgent,due_date,assignee) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        "task-" + i,
        "northstar",
        pid,
        title,
        stage,
        important,
        urgent,
        due,
        "Ayesha Khan",
      );
    d.prepare(
      "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "visa-amira",
      "northstar",
      "amira",
      "Study visa",
      "United Kingdom",
      "UK Student route",
      "Study visa preparation",
      "August 2027",
      "Collecting",
    );
    d.prepare(
      "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "visa-sofia",
      "northstar",
      "sofia",
      "Study visa",
      "Germany",
      "Germany Study route",
      "Study visa preparation",
      "September 2027",
      "Collecting",
    );
    d.prepare(
      "INSERT INTO requests(id,tenant_id,person_id,section_key,title,message,created_by) VALUES(?,?,?,?,?,?,?)",
    ).run(
      "request-amira",
      "northstar",
      "amira",
      "education",
      "Add your latest transcript",
      "Please upload your final transcript or let us know when it will be available.",
      "ayesha",
    );
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function createChecklist(
  applicationId: string,
  tenantId: string,
  kind: string,
) {
  const d = db();
  const items =
    kind === "Admission" || kind === "Scholarship"
      ? [
          ["Confirm identity details", "identity"],
          ["Review education evidence", "education"],
          ["Review program-specific requirements", "study-goals"],
        ]
      : [
          ["Confirm passport and identity details", "passports"],
          ["Review trip / study purpose", "trip-plans"],
          ["Review applicable funding and supporting evidence", "funding"],
        ];
  for (const [label, section] of items)
    d.prepare(
      "INSERT INTO requirements(id,tenant_id,application_id,label,section_key) VALUES(?,?,?,?,?)",
    ).run(id(), tenantId, applicationId, label, section);
}
function initializeChecklists(d: DatabaseSync) {
  const apps = d
    .prepare(
      "SELECT id,tenant_id,kind FROM applications a WHERE NOT EXISTS(SELECT 1 FROM requirements r WHERE r.application_id=a.id)",
    )
    .all();
  for (const app of apps)
    createChecklist(String(app.id), String(app.tenant_id), String(app.kind));
}

function seedCRM(d: DatabaseSync) {
  d.exec("CREATE TABLE IF NOT EXISTS demo_migrations(name TEXT PRIMARY KEY)");
  if (
    !d
      .prepare("SELECT name FROM demo_migrations WHERE name='crm-journeys-v1'")
      .get()
  ) {
    for (const [pid, stage] of [
      ["amira", "Documents"],
      ["daniel", "Offers"],
      ["james", "Applying"],
      ["sofia", "Visa"],
    ])
      d.prepare(
        "UPDATE people SET journey_stage=? WHERE id=? AND tenant_id='northstar' AND journey_stage='Planning' AND revision=1",
      ).run(stage, pid);
    d.prepare(
      "INSERT INTO demo_migrations(name) VALUES('crm-journeys-v1')",
    ).run();
  }
  if (d.prepare("SELECT name FROM demo_migrations WHERE name='crm-v1'").get())
    return;
  d.exec("BEGIN IMMEDIATE");
  try {
    const leads = [
      [
        "demo-lead-noor",
        "Noor Ahmed",
        "noor.ahmed@example.com",
        "New",
        "Inquiry",
        "United Kingdom",
        100000,
        50000,
        25000,
      ],
      [
        "demo-lead-zain",
        "Zain Ali",
        "zain.ali@example.com",
        "Counselling",
        "WhatsApp",
        "Canada",
        150000,
        50000,
        40000,
      ],
      [
        "demo-lead-hana",
        "Hana Yusuf",
        "hana.yusuf@example.com",
        "Awaiting registration",
        "Email",
        "Germany",
        80000,
        40000,
        20000,
      ],
      [
        "demo-lead-maya",
        "Maya Tan",
        "maya.tan@example.com",
        "Qualified",
        "CSV",
        "Ireland",
        120000,
        60000,
        30000,
      ],
    ];
    for (const [
      lid,
      name,
      email,
      stage,
      source,
      country,
      fee,
      upfront,
      incentive,
    ] of leads)
      d.prepare(
        "INSERT OR IGNORE INTO leads(id,tenant_id,name,email,stage,source,destination,course,expected_fee,upfront_fee,incentive,timeline,notes,follow_up) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        lid,
        "northstar",
        name,
        email,
        stage,
        source,
        country,
        "Masters · interest to discuss",
        fee,
        upfront,
        incentive,
        "Target intake: September 2027",
        "Fictional demo lead. Source illustrates a channel; no email or WhatsApp integration is active.",
        "2026-10-20",
      );
    if (
      d
        .prepare(
          "SELECT id FROM people WHERE id='fatima' AND tenant_id='northstar'",
        )
        .get()
    ) {
      for (const [aid, kind, country, institution, status] of [
        [
          "demo-usa-refused",
          "Study visa",
          "United States",
          "Sample US student visa case",
          "Failed",
        ],
        [
          "demo-uk-restart",
          "Admission",
          "United Kingdom",
          "Sample UK University",
          "Draft",
        ],
        [
          "demo-uk-offer",
          "Admission",
          "United Kingdom",
          "Sample London Institute",
          "Offer received",
        ],
      ])
        d.prepare(
          "INSERT OR IGNORE INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          aid,
          "northstar",
          "fatima",
          kind,
          country,
          institution,
          "MS Computer Science",
          "September 2027",
          status,
        );
      d.prepare(
        "INSERT OR IGNORE INTO case_finance(person_id,tenant_id,expected_fee,upfront_fee,incentive,timeline) VALUES('fatima','northstar',100000,50000,25000,'USA refusal retained; preparing UK alternatives')",
      ).run();
      d.prepare(
        "INSERT OR IGNORE INTO payments(id,tenant_id,person_id,amount,reference,client_key,created_by) VALUES('demo-payment-fatima','northstar','fatima',25000,'DEMO receipt 001','demo-receipt-fatima','ayesha')",
      ).run();
    }
    d.prepare("INSERT INTO demo_migrations(name) VALUES('crm-v1')").run();
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
