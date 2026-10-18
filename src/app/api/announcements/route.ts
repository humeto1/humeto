import { actor, ensureOrigin } from "@/lib/auth";
import { announcementsRead, announcementsWrite } from "@/lib/announcements";
import { z } from "zod";
export const runtime = "nodejs";
async function handle(req: Request) {
  try {
    const a = await actor();
    if (!a) return Response.json({ error: "Sign in first." }, { status: 401 });
    if (req.method === "GET") return await announcementsRead(a);
    ensureOrigin(req);
    if (Number(req.headers.get("content-length") || 0) > 160000)
      return Response.json(
        { error: "Announcement is too large." },
        { status: 413 },
      );
    return await announcementsWrite(a, await req.json());
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Check the title, audience, dates and internal link." },
        { status: 400 },
      );
    if (e instanceof Error && e.message === "ORIGIN")
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    console.error("Announcement request failed");
    return Response.json(
      { error: "Could not update announcements." },
      { status: 500 },
    );
  }
}
export const GET = handle,
  POST = handle;
