import { NextResponse } from "next/server";
import { supabaseFromToken } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const sb = supabaseFromToken(token);

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "Untitled Run";
  const initialState = body.initialState ?? {};

  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = u.user.id;

  const { data: run, error: rErr } = await sb
    .from("runs")
    .insert({ user_id: userId, title, status: "active" })
    .select()
    .single();

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });

  const { error: sErr } = await sb.from("run_state").insert({
    run_id: run.id,
    state_json: initialState
  });

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  return NextResponse.json({ run });
}
