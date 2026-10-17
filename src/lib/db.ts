import "server-only";
import { resolve } from "node:path";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import { database, type Database } from "./postgres.mjs";
export const dataDir = resolve(
  /*turbopackIgnore: true*/ process.env.HUMETO_DATA_DIR || ".data",
);
export function db() {
  return database();
}
export function withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
  return db().transaction(fn);
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function id() {
  return randomUUID();
}
export async function audit(
  tenant: string,
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  await db()
    .prepare(
      "INSERT INTO audit(id,tenant_id,actor_id,action,entity_type,entity_id,summary) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id(), tenant, actor, action, entityType, entityId, summary);
}
export async function seed(d: Database) {
  if (await d.prepare("SELECT id FROM tenants LIMIT 1").get()) return;
  try {
    const transactionResult = await withTransaction(async () => {
      for (const [tid, name, type] of [
        ["northstar", "Northstar Education", "institute"],
        ["brightpath", "Brightpath Global", "institute"],
        ["individual", "Amira’s workspace", "individual"],
      ]) {
        await d
          .prepare("INSERT INTO tenants(id,name,type) VALUES(?,?,?)")
          .run(tid, name, type);
        await d
          .prepare(
            "INSERT INTO subscriptions(tenant_id,plan,status,seats,case_limit,storage_mb) VALUES(?,?,?,?,?,?)",
          )
          .run(
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
        await d
          .prepare(
            "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
          )
          .run(uid, name, email, demoPass);
        await d
          .prepare(
            "INSERT INTO memberships(user_id,tenant_id,role,person_id) VALUES(?,?,?,?)",
          )
          .run(uid, tenant, role, pid);
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
        [
          "daniel",
          "Daniel Mensah",
          "Ireland",
          "MSc Business Analytics",
          "rose",
        ],
      ];
      for (const [pid, name, country, course, color] of students) {
        await d
          .prepare(
            "INSERT INTO people(id,tenant_id,name,email,destination,course,initials,color) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
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
        await d
          .prepare(
            "INSERT INTO intake(tenant_id,person_id,section_key,data,state) VALUES(?,?,?,?,?)",
          )
          .run("northstar", pid, "identity", JSON.stringify(data), "draft");
        await d
          .prepare(
            "INSERT INTO intake(tenant_id,person_id,section_key,data,state) VALUES(?,?,?,?,?)",
          )
          .run(
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
        await d
          .prepare(
            "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
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
      await d
        .prepare(
          "INSERT INTO people(id,tenant_id,name,email,destination,course,initials,color) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          "bright-student",
          "brightpath",
          "Robin Davis",
          "robin@example.com",
          "Germany",
          "MSc Design",
          "RD",
          "sage",
        );
      await d
        .prepare(
          "INSERT INTO people(id,tenant_id,name,email,destination,course,initials,color) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
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
        [
          2,
          "Request English test evidence",
          "omar",
          "To do",
          1,
          0,
          "2026-10-21",
        ],
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
        await d
          .prepare(
            "INSERT INTO tasks(id,tenant_id,person_id,title,stage,important,urgent,due_date,assignee) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
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
      await d
        .prepare(
          "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
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
      await d
        .prepare(
          "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
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
      await d
        .prepare(
          "INSERT INTO requests(id,tenant_id,person_id,section_key,title,message,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          "request-amira",
          "northstar",
          "amira",
          "education",
          "Add your latest transcript",
          "Please upload your final transcript or let us know when it will be available.",
          "ayesha",
        );
    });
    if (transactionResult !== undefined) return transactionResult;
  } catch (e) {
    throw e;
  }
}
export async function createChecklist(
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
    await d
      .prepare(
        "INSERT INTO requirements(id,tenant_id,application_id,label,section_key) VALUES(?,?,?,?,?)",
      )
      .run(id(), tenantId, applicationId, label, section);
}
export async function initializeChecklists(d: Database) {
  const apps = await d
    .prepare(
      "SELECT id,tenant_id,kind FROM applications a WHERE NOT EXISTS(SELECT 1 FROM requirements r WHERE r.application_id=a.id)",
    )
    .all();
  for (const app of apps)
    await createChecklist(
      String(app.id),
      String(app.tenant_id),
      String(app.kind),
    );
}
export async function seedCRM(d: Database) {
  if (
    !(await d
      .prepare("SELECT name FROM demo_migrations WHERE name='crm-journeys-v1'")
      .get())
  ) {
    for (const [pid, stage] of [
      ["amira", "Documents"],
      ["daniel", "Offers"],
      ["james", "Applying"],
      ["sofia", "Visa"],
    ])
      await d
        .prepare(
          "UPDATE people SET journey_stage=? WHERE id=? AND tenant_id='northstar' AND journey_stage='Planning' AND revision=1",
        )
        .run(stage, pid);
    await d
      .prepare("INSERT INTO demo_migrations(name) VALUES('crm-journeys-v1')")
      .run();
  }
  if (
    await d
      .prepare("SELECT name FROM demo_migrations WHERE name='crm-v1'")
      .get()
  )
    return;
  try {
    const transactionResult = await withTransaction(async () => {
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
        await d
          .prepare(
            "INSERT INTO leads(id,tenant_id,name,email,stage,source,destination,course,expected_fee,upfront_fee,incentive,timeline,notes,follow_up) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(
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
        await d
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
          await d
            .prepare(
              "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake,status) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            )
            .run(
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
        await d
          .prepare(
            "INSERT INTO case_finance(person_id,tenant_id,expected_fee,upfront_fee,incentive,timeline) VALUES('fatima','northstar',100000,50000,25000,'USA refusal retained; preparing UK alternatives') ON CONFLICT DO NOTHING",
          )
          .run();
        await d
          .prepare(
            "INSERT INTO payments(id,tenant_id,person_id,amount,reference,client_key,created_by) VALUES('demo-payment-fatima','northstar','fatima',25000,'DEMO receipt 001','demo-receipt-fatima','ayesha') ON CONFLICT DO NOTHING",
          )
          .run();
      }
      await d
        .prepare("INSERT INTO demo_migrations(name) VALUES('crm-v1')")
        .run();
    });
    if (transactionResult !== undefined) return transactionResult;
  } catch (e) {
    throw e;
  }
}
