import { actor, ensureOrigin, setSessionContext } from "@/lib/auth";
import { z } from "zod";
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await actor();
    if (!a?.platformAdmin)
      return Response.json(
        { error: "Superadmin access required." },
        { status: 403 },
      );
    const v = z
      .object({ context: z.enum(["platform", "workspace"]) })
      .strict()
      .parse(await req.json());
    await setSessionContext(a, v.context);
    return Response.json({ ok: true, context: v.context });
  } catch (e) {
    return Response.json(
      { error: "Unable to switch workspace context." },
      { status: e instanceof Error && e.message === "ORIGIN" ? 403 : 400 },
    );
  }
}
