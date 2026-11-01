// Builds an AAB for review or signed upload. Never uploads to Play Console.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  mobile = resolve(root, "mobile");
const unsigned = process.argv.includes("--unsigned");
const keys = [
  "HUMETO_UPLOAD_KEYSTORE",
  "HUMETO_UPLOAD_STORE_PASSWORD",
  "HUMETO_UPLOAD_KEY_ALIAS",
  "HUMETO_UPLOAD_KEY_PASSWORD",
];
if (!unsigned) {
  for (const k of keys)
    if (!process.env[k])
      throw Error(
        `Set ${k} for an upload-signed bundle, or use android:bundle:unsigned for review only.`,
      );
  if (!isAbsolute(process.env.HUMETO_UPLOAD_KEYSTORE))
    throw Error("Use an absolute upload keystore path.");
  if (!existsSync(process.env.HUMETO_UPLOAD_KEYSTORE))
    throw Error("Upload keystore file not found.");
  if (
    /androiddebugkey/i.test(process.env.HUMETO_UPLOAD_KEY_ALIAS) ||
    /debug\.keystore$/i.test(process.env.HUMETO_UPLOAD_KEYSTORE)
  )
    throw Error("A Play upload must not use the Android debug key.");
} else if (keys.some((k) => process.env[k]))
  throw Error(
    "Unset upload-signing variables for an explicitly unsigned review build.",
  );
const env = { ...process.env };
delete env.VITE_HUMETO_QA_API;
delete env.ORG_GRADLE_PROJECT_humetoQa;
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (r.status !== 0)
    throw Error(`${cmd} failed (${r.status ?? r.error?.code})`);
}
run("npm", ["run", "build"], mobile);
const html = readFileSync(resolve(mobile, "dist/index.html"), "utf8");
if (!html.includes("assets/")) throw Error("Mobile production assets missing.");
run("npx", ["cap", "sync", "android"], mobile);
run("./gradlew", ["bundleRelease"], resolve(mobile, "android"));
console.log(
  unsigned
    ? "UNSIGNED REVIEW ONLY — not upload-ready."
    : "Upload-signed AAB built. Play Console checks and policy gates still apply.",
);
console.log(
  resolve(mobile, "android/app/build/outputs/bundle/release/app-release.aab"),
);
