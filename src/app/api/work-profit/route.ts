import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { workSummary, recordProfit } from "@/lib/work-profit";
import { z } from "zod";
export async function GET(req: Request) {
  try {
    const a = await actor();
    if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    const u = new URL(req.url),
      v = z
        .object({
          type: z.enum(["task", "project", "goal"]),
          id: z.string().min(1).max(100),
        })
        .parse({
          type: u.searchParams.get("type"),
          id: u.searchParams.get("id"),
        });
    return Response.json(await workSummary(a.tenantId, v.type, v.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "Unable to load work totals." },
      { status: 404 },
    );
  }
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await actor();
    if (
      !a ||
      !isStaff(a) ||
      !(await canMutate(a)) ||
      !(await hasFeature(a.tenantId, "tasks"))
    )
      return Response.json({ error: "Not permitted." }, { status: 403 });
    return Response.json(await recordProfit(a, await req.json()));
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the receipt details."
            : e instanceof Error
              ? e.message
              : "Unable to save receipt.",
      },
      { status: e instanceof Error && e.message === "ORIGIN" ? 403 : 400 },
    );
  }
}
