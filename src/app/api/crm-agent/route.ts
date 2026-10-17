import { NextResponse } from "next/server";
import { z } from "zod";
import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { crmState, crmMessage, crmDecide, CrmError } from "@/lib/crm-agent";
export const runtime = "nodejs";
const input = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("message"),
    message: z.string().trim().min(1).max(2000),
    clientKey: z.uuid(),
  }),
  z.object({
    operation: z.literal("action"),
    actionId: z.uuid(),
    decision: z.enum(["apply", "cancel"]),
  }),
]);
async function route(req: Request) {
  try {
    const a = await actor();
    if (!a)
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 },
      );
    if (!isStaff(a))
      return NextResponse.json(
        { error: "CRM chat access is not permitted." },
        { status: 403 },
      );
    if (req.method === "GET") return NextResponse.json(await crmState(a));
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return NextResponse.json(
        { error: "This workspace is read-only." },
        { status: 403 },
      );
    if (Number(req.headers.get("content-length") || 0) > 12000)
      return NextResponse.json(
        { error: "Command is too long." },
        { status: 413 },
      );
    const v = input.parse(await req.json());
    return NextResponse.json(
      v.operation === "message"
        ? await crmMessage(a, v.message, v.clientKey)
        : await crmDecide(a, v.actionId, v.decision),
    );
  } catch (e) {
    if (e instanceof CrmError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: "Check the command and review action." },
        { status: 400 },
      );
    if (e instanceof Error && e.message === "ORIGIN")
      return NextResponse.json(
        { error: "Origin not allowed." },
        { status: 403 },
      );
    console.error(
      "CRM chat failed",
      e instanceof Error ? e.message : "Unknown",
    );
    return NextResponse.json(
      { error: "Unable to complete this command. Please try again." },
      { status: 500 },
    );
  }
}
export const GET = route,
  POST = route;
