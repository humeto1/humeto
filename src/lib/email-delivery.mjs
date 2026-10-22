import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { database } from "./postgres.mjs";
export const tokenHash = (value) =>
  createHash("sha256").update(value).digest("hex");
export function publicAppUrl(env = process.env) {
  const u = new URL(env.HUMETO_PUBLIC_APP_URL || "https://www.humeto.com");
  if (
    u.protocol !== "https:" &&
    !(
      env.HUMETO_ISOLATED_QA === "true" &&
      ["127.0.0.1", "localhost"].includes(u.hostname)
    )
  )
    throw Error("A secure public app URL is required");
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw Error("Use an origin for HUMETO_PUBLIC_APP_URL");
  return u.origin;
}
function capture() {
  return (
    process.env.HUMETO_ISOLATED_QA === "true" &&
    process.env.HUMETO_EMAIL_MODE === "capture"
  );
}
export function emailConfigured() {
  return (
    capture() ||
    (!!process.env.RESEND_API_KEY &&
      /^[^\r\n]*@[^\s<>]+\.[^\s<>]+>?$/.test(
        process.env.HUMETO_EMAIL_FROM || "",
      ))
  );
}
export async function sendEmail(
  { to, subject, text, category = "account", key = String(randomUUID()) },
  d = database(),
) {
  if (!["account", "optional", "marketing"].includes(category))
    throw Error("Unknown email category");
  let headers;
  if (category !== "account") {
    await d
      .prepare(
        "INSERT INTO email_preferences(email,updated_at) VALUES(?,?) ON CONFLICT(email) DO NOTHING",
      )
      .run(to.toLowerCase(), Date.now());
    const p = await d
      .prepare("SELECT * FROM email_preferences WHERE email=?")
      .get(to.toLowerCase());
    if (
      !p ||
      !Number(category === "marketing" ? p.marketing : p.optional_notifications)
    )
      return { suppressed: true };
    const token = randomBytes(32).toString("base64url"),
      link = publicAppUrl() + "/unsubscribe?token=" + token;
    await d
      .prepare(
        "INSERT INTO email_unsubscribe_tokens(token_hash,email,created_at) VALUES(?,?,?)",
      )
      .run(tokenHash(token), to.toLowerCase(), Date.now());
    headers = {
      "List-Unsubscribe": `<${publicAppUrl()}/api/email/unsubscribe?token=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
    text += "\n\nYou receive optional emails from Humeto. Unsubscribe: " + link;
  }
  const message = {
    from: process.env.HUMETO_EMAIL_FROM || "Humeto <test@example.invalid>",
    to,
    subject,
    text,
    ...(headers ? { headers } : {}),
  };
  if (capture()) {
    const dir = resolve(
      process.env.HUMETO_DATA_DIR || ".data",
      "email-capture",
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(
      resolve(dir, randomUUID() + ".json"),
      JSON.stringify(message),
      { mode: 0o600 },
    );
    return { captured: true };
  }
  if (!emailConfigured()) throw Error("Email delivery is not configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("Email provider rejected delivery");
  return { accepted: true };
}
