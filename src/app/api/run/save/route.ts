import { NextResponse } from "next/server";
import { supabaseFromToken } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const sb = supabaseFromToken(token);

  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const runId = body.runId;
  const state = body.state;

  if (!runId || typeof runId !== "string") {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  const { error: sErr } = await sb
    .from("run_state")
    .update({ state_json: state })
    .eq("run_id", runId);

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  await sb.from("runs").update({}).eq("id", runId);

  return NextResponse.json({ ok: true });
}
