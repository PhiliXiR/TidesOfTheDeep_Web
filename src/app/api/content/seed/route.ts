import { NextResponse } from "next/server";
import { supabaseFromToken } from "@/lib/supabaseServer";
import fs from "node:fs/promises";
import path from "node:path";

export async function GET(req: Request) {
  // Dev-only helper: load Content/game_config.json from the repo.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seed endpoint is disabled in production." }, { status: 404 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const sb = supabaseFromToken(token);

  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filePath = path.join(process.cwd(), "Content", "game_config.json");
  try {
    const text = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(text);
    return NextResponse.json({ ok: true, json });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Failed to read ${filePath}: ${e?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }
}
