// Test the compiled app in a disposable database, never against the user's preview records.
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
const directory = mkdtempSync(join(tmpdir(), "humeto-release-qa-"));
const reserve = createServer();
await new Promise((resolve, reject) => {
  reserve.once("error", reject);
  reserve.listen(0, "127.0.0.1", resolve);
});
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const url = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  HUMETO_DATA_DIR: directory,
  HUMETO_LOCAL_DEMO: "true",
  HUMETO_AGENT_PROVIDER: "local",
  HUMETO_TEST_URL: url,
  HUMETO_ISOLATED_QA: "true",
};
const log = join(directory, "server.log"),
  fd = openSync(log, "w");
const server = spawn(
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
let result = 1;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error("QA server exited before startup.");
    try {
      if ((await fetch(url + "/login")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("QA server did not become ready.");
  console.log("Testing isolated compiled release at " + url);
  const files = readdirSync("tests")
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => "tests/" + f);
  const tests = spawn(
    process.execPath,
    ["--test", "--test-concurrency=1", ...files],
    { env, stdio: "inherit" },
  );
  result = await new Promise((resolve) => {
    tests.once("error", () => resolve(1));
    tests.once("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
  console.error(readFileSync(log, "utf8").slice(-4000));
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
  closeSync(fd);
  if (result === 0) rmSync(directory, { recursive: true, force: true });
  else console.error("Failed-run diagnostics retained at " + directory);
}
process.exitCode = result;
