import { NextResponse } from "next/server";
import { z } from "zod";
import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import {
  AgentError,
  agentState,
  sendMessage,
  decide,
  dismissReminder,
} from "@/lib/agent/service";
export const runtime = "nodejs";
const timezone = z.string().min(1).max(100);
const input = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("message"),
    threadId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(2000),
    clientKey: z.string().uuid(),
    timezone,
  }),
  z.object({
    operation: z.literal("action"),
    actionId: z.string().uuid(),
    decision: z.enum(["apply", "cancel"]),
    timezone,
  }),
  z.object({
    operation: z.literal("dismiss"),
    reminderId: z.string().uuid(),
    timezone,
  }),
]);
async function route(req: Request) {
  try {
    const a = await actor();
    if (!a)
      return NextResponse.json(
        { error: "Sign in to use your assistant." },
        { status: 401 },
      );
    if (!isStaff(a))
      return NextResponse.json(
        { error: "Task assistant access is not permitted for this role." },
        { status: 403 },
      );
    if (req.method === "GET") {
      const params = new URL(req.url).searchParams;
      return NextResponse.json(
        await agentState(
          a,
          params.get("threadId"),
          timezone.parse(params.get("timezone") || "Asia/Karachi"),
          params.get("summary") === "1",
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return NextResponse.json(
        { error: "This workspace is read-only." },
        { status: 403 },
      );
    if (Number(req.headers.get("content-length") || 0) > 12000)
      return NextResponse.json(
        { error: "Message is too long." },
        { status: 413 },
      );
    const data = input.parse(await req.json());
    if (data.operation === "message")
      return NextResponse.json(await sendMessage(a, data));
    if (data.operation === "action")
      return NextResponse.json(
        await decide(a, data.actionId, data.decision, data.timezone),
      );
    await dismissReminder(a, data.reminderId);
    return NextResponse.json(await agentState(a, null, data.timezone));
  } catch (e) {
    if (e instanceof AgentError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: "Check your message, conversation and timezone." },
        { status: 400 },
      );
    if (e instanceof Error && e.message === "ORIGIN")
      return NextResponse.json(
        { error: "Origin not allowed." },
        { status: 403 },
      );
    // Provider errors never include credentials or upstream response bodies.
    const message =
      e instanceof Error ? e.message : "Unable to complete this request.";
    if (/timezone|AI provider|Live AI|reminder|date and time/.test(message))
      return NextResponse.json({ error: message }, { status: 400 });
    console.error(
      "Assistant request failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return NextResponse.json(
      {
        error:
          "Unable to complete that request. No task action was applied. Please retry.",
      },
      { status: 500 },
    );
  }
}
export const GET = route,
  POST = route;
