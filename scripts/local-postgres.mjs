// Local-only convenience control for the app's dedicated PostgreSQL cluster.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const action = process.argv[2] || "start";
if (!["start", "stop", "status"].includes(action))
  throw new Error("Use start, stop or status.");
const candidates = [
  "/opt/homebrew/opt/postgresql@18/bin",
  "/usr/local/opt/postgresql@18/bin",
];
const bin =
  process.env.HUMETO_PG_BIN ||
  candidates.find((p) => existsSync(p + "/pg_ctl"));
if (!bin)
  throw new Error("Set HUMETO_PG_BIN to your PostgreSQL bin directory.");
const data = resolve(".data/postgres"),
  socket = resolve(".data/postgres-socket");
mkdirSync(socket, { recursive: true, mode: 0o700 });
chmodSync(socket, 0o700);
function run(program, args) {
  const r = spawnSync(bin + "/" + program, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(program + " failed.");
}
const status = () =>
  spawnSync(bin + "/pg_ctl", ["-D", data, "status"], { stdio: "ignore" })
    .status === 0;
if (action === "status") {
  console.log(
    status() ? "Local PostgreSQL is running." : "Local PostgreSQL is stopped.",
  );
} else if (action === "stop") {
  if (status()) run("pg_ctl", ["-D", data, "stop", "-m", "fast"]);
  else console.log("Already stopped.");
} else {
  if (!existsSync(data + "/PG_VERSION"))
    run("initdb", [
      "-D",
      data,
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      "--username=humeto_local",
    ]);
  if (status()) console.log("Local PostgreSQL is already running.");
  else
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      resolve(".data/postgres-server.log"),
      "-o",
      `-h 127.0.0.1 -p 55432 -k '${socket}'`,
      "start",
    ]);
}
