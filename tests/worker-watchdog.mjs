import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const moduleUrl = new URL("../scripts/lib/worker-watchdog.mjs", import.meta.url)
  .href;
function child(code) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    p.stderr.on("data", (v) => (errors += v));
    const deadline = setTimeout(() => {
      p.kill();
      reject(Error("Worker watchdog did not terminate the stalled process"));
    }, 5000);
    p.once("error", reject);
    p.once("exit", (code) => {
      clearTimeout(deadline);
      resolve({ code, errors });
    });
  });
}
test("stalled worker exits for supervisor recovery even while its event loop remains alive", async () => {
  const result = await child(
    `import {workerWatchdog} from ${JSON.stringify(moduleUrl)}; workerWatchdog({timeoutMs:60,checkMs:10}); setInterval(()=>{},1000);`,
  );
  assert.equal(result.code, 1);
  assert.match(result.errors, /restarting to recover stalled I\/O/);
});
test("worker making progress stays alive and watchdog can be stopped", async () => {
  const result = await child(
    `import {workerWatchdog} from ${JSON.stringify(moduleUrl)}; const w=workerWatchdog({timeoutMs:100,checkMs:10}); const progress=setInterval(()=>w.touch(),20); setTimeout(()=>{w.stop();clearInterval(progress)},250);`,
  );
  assert.equal(result.code, 0);
});
