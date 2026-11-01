// Source/build evidence only; this cannot certify legal or Play Console compliance.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const facts = [];
const check = (name, passed, evidence) =>
  facts.push({ name, status: passed ? "pass" : "blocked", evidence });
check(
  "Target SDK 36",
  /targetSdkVersion\s*=\s*36/.test(read("mobile/android/variables.gradle")),
  "mobile/android/variables.gradle",
);
const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
check(
  "Backups disabled",
  manifest.includes('android:allowBackup="false"'),
  "Android manifest",
);
check(
  "Release debuggable disabled",
  read("mobile/android/app/build.gradle").includes("debuggable false"),
  "release build type",
);
check(
  "No broad FileProvider storage exposure",
  !/<(?:root-path|external-path)\b|path="\."/.test(
    read("mobile/android/app/src/main/res/xml/file_paths.xml"),
  ),
  "Only humeto-share cache directory",
);
check(
  "Native bridge logging disabled",
  read("mobile/capacitor.config.ts").includes('loggingBehavior: "none"'),
  "Capacitor config",
);
check(
  "Privacy/deletion/terms pages exist",
  ["privacy", "terms", "delete-account"].every((p) =>
    existsSync(resolve(root, `src/app/${p}/page.tsx`)),
  ),
  "Public route sources; live URL must also be verified",
);
check(
  "Signup requires adult/policy affirmation",
  /adult: z.literal\(true/.test(read("src/app/api/auth/[action]/route.ts")) &&
    /acceptPolicies: z.literal\(true/.test(
      read("src/app/api/auth/[action]/route.ts"),
    ),
  "Server validation, not age verification",
);
check(
  "Dedicated upload signing supplied",
  [
    "HUMETO_UPLOAD_KEYSTORE",
    "HUMETO_UPLOAD_STORE_PASSWORD",
    "HUMETO_UPLOAD_KEY_ALIAS",
    "HUMETO_UPLOAD_KEY_PASSWORD",
  ].every((k) => Boolean(process.env[k])),
  "Environment presence only; key/certificate and bundle must be verified",
);
const external = [
  "Play Console identity/account verification and developer legal entity/country",
  "Support mailbox receipt test and account-deletion fulfilment/backup erasure drill",
  "Data safety answers, vendor contracts and retention periods signed off",
  "UGC project-chat reporting/blocking and moderation operational review",
  "AI reporting policy applicability and in-app reporting route",
  "Billing route, countries and any required Play Billing integration",
  "Store screenshots/assets, IARC content rating, app-access reviewer credentials",
  "Signed AAB, Play App Signing, internal/pre-launch/closed testing and physical devices",
];
for (const name of external)
  check(
    name,
    false,
    "Requires recorded human/operational or Play Console evidence; source checks cannot approve this.",
  );
const out = {
  checkedAt: new Date().toISOString(),
  audience: "18+",
  readyForPlayUpload: false,
  checks: facts,
};
mkdirSync(resolve(root, ".data/play-readiness"), { recursive: true });
writeFileSync(
  resolve(root, ".data/play-readiness/preflight.json"),
  JSON.stringify(out, null, 2),
);
for (const f of facts) console.log(`${f.status.toUpperCase()} ${f.name}`);
console.log(
  "NOT PLAY-READY: resolve the checklist gates; this report never grants approval.",
);
if (process.argv.includes("--strict")) process.exitCode = 1;
