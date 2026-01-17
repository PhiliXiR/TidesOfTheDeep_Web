import { NextResponse } from "next/server";
import { supabaseFromToken } from "@/lib/supabaseServer";

function parseEmailList(s: string | undefined | null): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function getWriteMode(): "open" | "admin" {
  const raw = (process.env.CONTENT_WRITE_MODE ?? "open").toLowerCase();
  return raw === "admin" ? "admin" : "open";
}

async function getWriteAllowed(sb: ReturnType<typeof supabaseFromToken>): Promise<{ allowed: boolean; mode: "open" | "admin"; email?: string | null }> {
  const mode = getWriteMode();
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return { allowed: false, mode, email: null };

  if (mode === "open") return { allowed: true, mode, email: u.user.email ?? null };

  const email = (u.user.email ?? "").toLowerCase();
  const admins = parseEmailList(process.env.CONTENT_ADMIN_EMAILS);
  return { allowed: admins.includes(email), mode, email: u.user.email ?? null };
}

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

  const meta = await getWriteAllowed(sb);
  return NextResponse.json({ content: map, meta: { writeAllowed: meta.allowed, writeMode: meta.mode } });
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const sb = supabaseFromToken(token);

  const meta = await getWriteAllowed(sb);
  if (!meta.allowed) {
    return NextResponse.json(
      { error: meta.mode === "admin" ? "Content writes are admin-only." : "Content writes disabled." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : null;
  const json = body.json;

  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const { error } = await sb.from("content").upsert({ key, json });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
