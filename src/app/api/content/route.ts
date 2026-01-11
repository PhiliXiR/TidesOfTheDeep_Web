import { NextResponse } from "next/server";
import { supabaseFromToken } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const sb = supabaseFromToken(token);

  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const keys = (url.searchParams.get("keys") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    return NextResponse.json({ error: "Provide keys=..." }, { status: 400 });
  }

  const { data, error } = await sb.from("content").select("key,json,updated_at").in("key", keys);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const map: Record<string, any> = {};
  for (const row of data ?? []) map[row.key] = row.json;

  return NextResponse.json({ content: map });
}
