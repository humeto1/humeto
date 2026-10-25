import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from("Bearer " + (secret || ""));
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await db().query("SELECT humeto_purge_task_bin() AS removed");
  const breakChat = await db().query("SELECT humeto_purge_break_chat() AS removed");
  return Response.json({ removed: result.rows[0].removed, breakMessagesRemoved: breakChat.rows[0].removed });
}
