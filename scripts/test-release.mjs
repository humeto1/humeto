// Compiled release QA uses a disposable PostgreSQL database and upload directory.
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createTestDatabase } from "./lib/test-database.mjs";
const directory = mkdtempSync(join(tmpdir(), "humeto-pg-qa-"));
const fixture = await createTestDatabase();
const reserve = createServer();
await new Promise((r, j) => {
  reserve.once("error", j);
  reserve.listen(0, "127.0.0.1", r);
});
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const url = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: fixture.url,
  DATABASE_URL_UNPOOLED: fixture.url,
  HUMETO_TEST_DATABASE_URL: fixture.url,
  HUMETO_DATA_DIR: directory,
  HUMETO_LOCAL_DEMO: "true",
  HUMETO_AGENT_PROVIDER: "local",
  HUMETO_TEST_URL: url,
  HUMETO_ISOLATED_QA: "true",
  HUMETO_EMAIL_MODE: "capture",
  HUMETO_SUPER_ADMIN_EMAIL: "designated-admin@example.com",
  HUMETO_PUBLIC_APP_URL: url,
  HUMETO_OCR_ENABLED: "true",
};
const run = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const c = spawn(process.execPath, args, {
      env,
      stdio: "inherit",
      ...options,
    });
    c.once("error", reject);
    c.once("exit", (code) => resolve(code ?? 1));
  });
let server,
  worker,
  workerFd,
  fd,
  result = 1;
try {
  const seed = await run([
    "--conditions=react-server",
    "--import",
    "tsx",
    "scripts/seed-demo.mts",
  ]);
  if (seed !== 0) throw new Error("PostgreSQL QA seed failed.");
  fd = openSync(join(directory, "server.log"), "w");
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env, stdio: ["ignore", fd, fd] },
  );
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error("QA server exited.");
    try {
      if ((await fetch(url + "/login")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("QA server did not become ready.");
  workerFd = openSync(join(directory, "ocr-worker.log"), "w");
  worker = spawn(process.execPath, ["scripts/ocr-worker.mjs"], {
    env,
    stdio: ["ignore", workerFd, workerFd],
  });
  console.log("Testing isolated PostgreSQL release at " + url);
  const files = readdirSync("tests")
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => "tests/" + f);
  result = await run(["--test", "--test-concurrency=1", ...files]);
} catch (e) {
  console.error(e.message);
  try {
    console.error(
      readFileSync(join(directory, "server.log"), "utf8").slice(-6000),
    );
  } catch {}
} finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const done = new Promise((r) => worker.once("exit", r));
    worker.kill("SIGTERM");
    await done;
  }
  if (workerFd !== undefined) closeSync(workerFd);
  if (server && server.exitCode === null && server.signalCode === null) {
    const done = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await done;
  }
  if (fd !== undefined) closeSync(fd);
  if (result === 0) {
    await fixture.cleanup();
    rmSync(directory, { recursive: true, force: true });
  } else {
    await fixture.disconnect();
    console.error(
      "Failed QA database retained: " + fixture.name + "; logs: " + directory,
    );
  }
}
process.exitCode = result;
