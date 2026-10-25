import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { actor, ensureOrigin } from "./auth";
import { db, id, withTransaction } from "./db";
import { moderateBreakText } from "./break-moderation";
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), agree: z.literal(true) }).strict(),
  z
    .object({
      action: z.literal("send"),
      text: z.string().trim().min(1).max(500),
      clientId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("report"),
      messageId: z.string().uuid(),
      reason: z.enum(["abuse", "personal_information", "spam", "other"]),
    })
    .strict(),
  z
    .object({ action: z.literal("block"), memberId: z.string().uuid() })
    .strict(),
  z
    .object({ action: z.literal("delete"), messageId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("moderate"),
      messageId: z.string().uuid(),
      decision: z.enum(["dismiss", "remove", "ban"]),
    })
    .strict(),
]);
class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
async function limit(
  user: string,
  purpose: string,
  max: number,
  window = 60000,
) {
  const r = await db()
    .prepare(
      "INSERT INTO auth_email_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_email_limits.window_start=excluded.window_start THEN auth_email_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
    )
    .get("break:" + purpose + ":" + user, Math.floor(Date.now() / window));
  if (Number(r?.count) > max)
    throw new ChatError(
      "Slow down and take a breather. Please try again later.",
      429,
    );
}
async function member(user: string) {
  let m = await db()
    .prepare("SELECT * FROM break_members WHERE user_id=?")
    .get(user);
  if (m) return m;
  const adjectives = [
    "Sunny",
    "Curious",
    "Gentle",
    "Jolly",
    "Brave",
    "Cosmic",
    "Merry",
    "Kind",
    "Bouncy",
    "Clever",
  ];
  const animals = [
    "Otter",
    "Panda",
    "Dolphin",
    "Koala",
    "Penguin",
    "Owl",
    "Butterfly",
    "Turtle",
    "Deer",
    "Rabbit",
    "Squirrel",
    "Lynx",
  ];
  const alias =
    adjectives[randomInt(adjectives.length)] +
    " " +
    animals[randomInt(animals.length)] +
    " " +
    randomBytes(4).toString("hex");
  await db()
    .prepare(
      "INSERT INTO break_members(id,user_id,alias) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING",
    )
    .run(id(), user, alias);
  return (await db()
    .prepare("SELECT * FROM break_members WHERE user_id=?")
    .get(user))!;
}
async function strike(memberId: string) {
  await db()
    .prepare(
      "UPDATE break_members SET strikes=strikes+1,banned_until=CASE WHEN strikes+1>=6 THEN ? WHEN strikes+1>=3 THEN ? ELSE banned_until END WHERE id=?",
    )
    .run(Date.now() + 86400000, Date.now() + 3600000, memberId);
}
export async function breakChat(req: Request) {
  try {
    const a = await actor();
    if (!a) throw new ChatError("Sign in to join break chat.", 401);
    if (req.method === "GET") await limit(a.id, "reads", 60);
    const m = await member(a.id);
    if (req.method === "GET") {
      const messages = m.accepted
        ? await db()
            .prepare(
              "SELECT msg.id,msg.member_id AS member,mb.alias,msg.content,msg.created_at,(msg.member_id=?) AS mine FROM break_messages msg JOIN break_members mb ON mb.id=msg.member_id WHERE NOT msg.hidden AND msg.created_at>now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM break_blocks b WHERE b.member_id=? AND b.blocked_id=msg.member_id) AND NOT EXISTS(SELECT 1 FROM break_reports r WHERE r.reporter_id=? AND r.message_id=msg.id) ORDER BY msg.created_at DESC,msg.id DESC LIMIT 100",
            )
            .all(m.id, m.id, m.id)
        : [];
      const review =
        a.role === "platform_admin"
          ? await db()
              .prepare(
                "SELECT msg.id,mb.alias,msg.content,r.reason,r.created_at FROM break_reports r JOIN break_messages msg ON msg.id=r.message_id JOIN break_members mb ON mb.id=msg.member_id WHERE NOT r.reviewed ORDER BY r.created_at LIMIT 100",
              )
              .all()
          : undefined;
      return Response.json(
        {
          alias: m.alias,
          joined: !!m.accepted,
          bannedUntil: Number(m.banned_until),
          messages: messages.reverse(),
          review,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    ensureOrigin(req);
    const reader = req.body?.getReader();
    if (!reader) throw new ChatError("Missing message.");
    let raw = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.length > 4000) {
        await reader.cancel();
        throw new ChatError("Text only, up to 500 characters.", 413);
      }
    }
    const v = action.parse(JSON.parse(raw));
    await limit(a.id, "actions", 30);
    if (v.action === "join") {
      await db()
        .prepare("UPDATE break_members SET accepted=1 WHERE id=?")
        .run(m.id);
      return Response.json({ ok: true });
    }
    if (!m.accepted)
      throw new ChatError("Accept the break-chat rules first.", 403);
    if (v.action === "moderate") {
      if (a.role !== "platform_admin")
        throw new ChatError("Moderator access required.", 403);
      await withTransaction(async () => {
        if (v.decision !== "dismiss")
          await db()
            .prepare("UPDATE break_messages SET hidden=true WHERE id=?")
            .run(v.messageId);
        if (v.decision === "ban")
          await db()
            .prepare(
              "UPDATE break_members SET banned_until=? WHERE id=(SELECT member_id FROM break_messages WHERE id=?)",
            )
            .run(Date.now() + 30 * 86400000, v.messageId);
        await db()
          .prepare("UPDATE break_reports SET reviewed=true WHERE message_id=?")
          .run(v.messageId);
      });
      return Response.json({ ok: true });
    }
    if (v.action === "delete") {
      await db()
        .prepare(
          "UPDATE break_messages SET hidden=true WHERE id=? AND member_id=?",
        )
        .run(v.messageId, m.id);
      return Response.json({ ok: true });
    }
    if (v.action === "block") {
      if (v.memberId === m.id)
        throw new ChatError("Choose another participant.");
      if (
        !(await db()
          .prepare("SELECT id FROM break_members WHERE id=?")
          .get(v.memberId))
      )
        throw new ChatError("Participant unavailable.", 404);
      await db()
        .prepare(
          "INSERT INTO break_blocks(member_id,blocked_id) VALUES(?,?) ON CONFLICT DO NOTHING",
        )
        .run(m.id, v.memberId);
      return Response.json({ ok: true });
    }
    if (v.action === "report") {
      await limit(a.id, "reports", 20, 86400000);
      const msg = await db()
        .prepare(
          "SELECT id FROM break_messages WHERE id=? AND member_id<>? AND NOT hidden",
        )
        .get(v.messageId, m.id);
      if (!msg) throw new ChatError("Message unavailable.", 404);
      await db()
        .prepare(
          "INSERT INTO break_reports(message_id,reporter_id,reason) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(v.messageId, m.id, v.reason);
      return Response.json({ ok: true });
    }
    if (Number(m.banned_until) > Date.now())
      throw new ChatError(
        "Break chat is paused for this account after repeated rule violations.",
        403,
      );
    await limit(a.id, "messages", 8);
    await limit(a.id, "daily", 100, 86400000);
    await limit("global", "capacity", 10000, 86400000);
    const old = await db()
      .prepare(
        "SELECT id FROM break_messages WHERE member_id=? AND client_id=?",
      )
      .get(m.id, v.clientId);
    if (old) return Response.json({ ok: true, id: old.id });
    const verdict = await moderateBreakText(v.text);
    if (!verdict.allowed) {
      await strike(String(m.id));
      throw new ChatError(verdict.reason, 422);
    }
    // Serialize the final permission check with sanctions so an in-flight message cannot bypass a ban.
    const messageId = id();
    await withTransaction(async () => {
      const current = await db()
        .prepare("SELECT banned_until FROM break_members WHERE id=? FOR UPDATE")
        .get(m.id);
      if (Number(current?.banned_until) > Date.now())
        throw new ChatError("Break chat is paused for this account.", 403);
      await db()
        .prepare(
          "INSERT INTO break_messages(id,member_id,client_id,content) VALUES(?,?,?,?) ON CONFLICT(member_id,client_id) DO NOTHING",
        )
        .run(messageId, m.id, v.clientId, v.text);
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "ORIGIN")
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    if (e instanceof ChatError)
      return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return Response.json(
        {
          error:
            "Use text only, up to 500 characters. Voice, images and files are not supported.",
        },
        { status: 400 },
      );
    return Response.json(
      {
        error:
          "Chat or language moderation is temporarily unavailable. Please try later.",
      },
      { status: 503 },
    );
  }
}
