import { hasFeature } from "@/lib/feature-guard";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actor, ensureOrigin } from "@/lib/auth";
import { InboxError, readInbox, mutateInbox } from "@/lib/update-inbox";
export const runtime = "nodejs";
const response = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function route(req: Request) {
  try {
    const a = await actor();
    if (a && !(await hasFeature(a.tenantId, "crm")))
      return Response.json(
        { error: "This feature is not included in your workspace access." },
        { status: 403 },
      );
    if (!a) return response({ error: "Sign in to continue." }, 401);
    if (req.method === "GET") {
      const query = new URL(req.url).searchParams;
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(query.get("offset") || 0);
      return response(await readInbox(a, query.get("id") || undefined, offset));
    }
    ensureOrigin(req);
    return response(await mutateInbox(a, await req.json()));
  } catch (e) {
    if (e instanceof InboxError)
      return response({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return response({ error: e.issues[0]?.message || "Invalid input." }, 400);
    if (e instanceof SyntaxError)
      return response({ error: "Use a valid JSON request." }, 400);
    if (e instanceof Error && e.message === "ORIGIN")
      return response({ error: "Origin not allowed." }, 403);
    console.error(
      "Inbox request failed",
      e instanceof Error ? e.message : "unknown",
    );
    return response({ error: "Unable to complete the inbox request." }, 500);
  }
}
export const GET = route,
  POST = route;
