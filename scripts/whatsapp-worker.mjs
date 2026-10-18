import makeWASocket, {
  BufferJSON,
  initAuthCreds,
  proto,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import pg from "pg";
import { database } from "../src/lib/postgres.mjs";
const key = Buffer.from(process.env.HUMETO_WHATSAPP_KEY || "", "base64");
if (key.length !== 32)
  throw new Error("HUMETO_WHATSAPP_KEY must be a base64 encoded 32 byte key");
const d = database(),
  logger = pino({ level: "silent" }),
  sockets = new Map();
// A dedicated PostgreSQL session holds a global advisory lock for the worker lifetime.
// Losing it terminates the process, so two workers never share a linked-device session.
const lock = new pg.Client({ connectionString: process.env.DATABASE_URL });
await lock.connect();
lock.on("error", () => process.exit(1));
if (
  !(await lock.query("SELECT pg_try_advisory_lock(781340120) AS acquired"))
    .rows[0].acquired
)
  throw new Error("Another WhatsApp worker is running");
function seal(value, tenant, name) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(tenant + ":" + name));
  const bytes = Buffer.concat([
    c.update(JSON.stringify(value, BufferJSON.replacer)),
    c.final(),
  ]);
  return Buffer.concat([iv, c.getAuthTag(), bytes]).toString("base64");
}
function unseal(value, tenant, name) {
  const b = Buffer.from(value, "base64"),
    c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  c.setAAD(Buffer.from(tenant + ":" + name));
  c.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(),
    BufferJSON.reviver,
  );
}
async function start(tenant) {
  const read = async (name) => {
    const r = await d
      .prepare("SELECT sealed FROM whatsapp_auth WHERE tenant_id=? AND key=?")
      .get(tenant, name);
    return r ? unseal(r.sealed, tenant, name) : null;
  };
  const write = async (name, value) => {
    if (value == null)
      await d
        .prepare("DELETE FROM whatsapp_auth WHERE tenant_id=? AND key=?")
        .run(tenant, name);
    else
      await d
        .prepare(
          "INSERT INTO whatsapp_auth(tenant_id,key,sealed) VALUES(?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET sealed=excluded.sealed",
        )
        .run(tenant, name, seal(value, tenant, name));
  };
  const creds = (await read("creds")) || initAuthCreds();
  const sock = makeWASocket({
    logger,
    auth: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            let value = await read(type + ":" + id);
            if (type === "app-state-sync-key" && value)
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          for (const type in data)
            for (const id in data[type])
              await write(type + ":" + id, data[type][id]);
        },
      },
    },
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  sockets.set(tenant, sock);
  sock.ev.on("creds.update", () =>
    write("creds", creds).catch(() => stop(tenant, "Session storage failed")),
  );
  sock.ev.on("connection.update", async (u) => {
    try {
      if (sockets.get(tenant) !== sock) return;
      if (u.qr)
        await d
          .prepare(
            "UPDATE whatsapp_connections SET status='pairing',qr=?,qr_expires=?,error=NULL WHERE tenant_id=? AND desired='on'",
          )
          .run(await QRCode.toDataURL(u.qr), Date.now() + 55000, tenant);
      if (u.connection === "open") {
        const phone = sock.user.id.split(":")[0].split("@")[0];
        await d
          .prepare(
            "UPDATE whatsapp_connections SET status='connected',phone=?,qr=NULL,error=NULL WHERE tenant_id=? AND desired='on'",
          )
          .run(phone, tenant);
      }
      if (u.connection === "close") {
        sockets.delete(tenant);
        const loggedOut =
          u.lastDisconnect?.error?.output?.statusCode ===
          DisconnectReason.loggedOut;
        await d
          .prepare(
            "UPDATE whatsapp_connections SET status='disconnected',qr=NULL,desired=CASE WHEN ? THEN 'off' ELSE desired END WHERE tenant_id=?",
          )
          .run(loggedOut, tenant);
        if (loggedOut)
          await d
            .prepare("DELETE FROM whatsapp_auth WHERE tenant_id=?")
            .run(tenant);
      }
    } catch {
      await stop(
        tenant,
        "Connection could not be stored; check number ownership and worker configuration",
      );
    }
  });
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || sockets.get(tenant) !== sock) return;
    try {
      for (const m of messages) {
        const remote = m.key.remoteJid,
          body =
            m.message?.conversation || m.message?.extendedTextMessage?.text;
        if (m.key.fromMe || !remote?.endsWith("@s.whatsapp.net") || !body)
          continue;
        await d
          .prepare(
            "INSERT INTO whatsapp_messages(id,tenant_id,remote,body,direction,status,created_at,provider_id) VALUES(?,?,?,?,'in','received',?,?) ON CONFLICT(tenant_id,provider_id) DO NOTHING",
          )
          .run(
            randomUUID(),
            tenant,
            remote,
            body.slice(0, 4000),
            Date.now(),
            m.key.id,
          );
      }
    } catch {
      console.error("Incoming WhatsApp message storage failed.");
    }
  });
}
async function stop(tenant, error = null) {
  const s = sockets.get(tenant);
  sockets.delete(tenant);
  if (s) s.end(new Error("Company connection stopped"));
  await d
    .prepare(
      "UPDATE whatsapp_connections SET status='disconnected',qr=NULL,error=? WHERE tenant_id=?",
    )
    .run(error, tenant);
}
console.log(
  "Humeto company WhatsApp worker started. No message bodies or pairing credentials are logged.",
);
await d
  .prepare(
    "UPDATE whatsapp_messages SET status='unknown' WHERE status='sending'",
  )
  .run();
while (true) {
  await lock.query("SELECT 1").catch(() => process.exit(1));
  try {
    const companies = await d
      .prepare("SELECT * FROM whatsapp_connections")
      .all();
    for (const c of companies) {
      if (c.desired === "off") {
        if (sockets.has(c.tenant_id)) {
          await sockets
            .get(c.tenant_id)
            .logout()
            .catch(() => {});
          await stop(c.tenant_id);
        }
        await d
          .prepare("DELETE FROM whatsapp_auth WHERE tenant_id=?")
          .run(c.tenant_id);
        await d
          .prepare(
            "UPDATE whatsapp_connections SET status='disconnected',phone=NULL,qr=NULL WHERE tenant_id=?",
          )
          .run(c.tenant_id);
        continue;
      }
      await d
        .prepare(
          "UPDATE whatsapp_connections SET heartbeat=? WHERE tenant_id=?",
        )
        .run(Date.now(), c.tenant_id);
      if (!sockets.has(c.tenant_id)) {
        await start(c.tenant_id);
        continue;
      }
      if (c.status !== "connected") continue;
      const messages = await d
        .prepare(
          "SELECT * FROM whatsapp_messages WHERE tenant_id=? AND status='queued' ORDER BY created_at LIMIT 1",
        )
        .all(c.tenant_id);
      for (const m of messages) {
        await d
          .prepare(
            "UPDATE whatsapp_messages SET status='sending' WHERE id=? AND status='queued'",
          )
          .run(m.id);
        try {
          const sent = await sockets
            .get(c.tenant_id)
            .sendMessage(m.remote, { text: m.body });
          await d
            .prepare(
              "UPDATE whatsapp_messages SET status='sent',provider_id=? WHERE id=?",
            )
            .run(sent.key.id, m.id);
        } catch {
          await d
            .prepare("UPDATE whatsapp_messages SET status='unknown' WHERE id=?")
            .run(m.id);
        }
      }
    }
  } catch {
    console.error(
      "WhatsApp worker cycle failed; check database and connection configuration.",
    );
  }
  await new Promise((r) => setTimeout(r, 3000));
}
