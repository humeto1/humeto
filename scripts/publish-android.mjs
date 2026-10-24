// Publish only the normal signed package; never ship the QA emulator build.
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, "mobile/android/app/build/outputs/apk/debug/app-debug.apk");
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(homedir(), "Library/Android/sdk");
const tools = join(
  sdk,
  "build-tools",
  readdirSync(join(sdk, "build-tools"))
    .filter((v) => /^\d+(\.\d+)*$/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1),
);
const info = execFileSync(join(tools, "aapt"), ["dump", "badging", source], {
  encoding: "utf8",
});
const pkg = info.match(
  /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/,
);
const expected = JSON.parse(
  readFileSync(join(root, "mobile/package.json"), "utf8"),
).version;
if (!pkg || pkg[1] !== "com.humeto.tasks" || pkg[3] !== expected)
  throw Error(
    "APK must be the normal Humeto package and match mobile/package.json version.",
  );
execFileSync(join(tools, "apksigner"), ["verify", source]);
const bytes = readFileSync(source);
if (bytes.length < 1_000_000 || bytes.length > 50_000_000)
  throw Error("Unexpected APK size.");
const manifest = {
  version: pkg[3],
  versionCode: Number(pkg[2]),
  packageId: pkg[1],
  filename: "humeto-android.apk",
  url: "/downloads/humeto-android.apk",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  channel: "testing",
};
const target = join(root, "public/downloads");
mkdirSync(target, { recursive: true });
copyFileSync(source, join(target, manifest.filename));
writeFileSync(
  join(target, "android-release.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Website Android download updated: ${manifest.version} (build ${manifest.versionCode}), SHA256 ${manifest.sha256}`,
);
