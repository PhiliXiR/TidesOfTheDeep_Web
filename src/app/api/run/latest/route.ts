import { NextResponse } from "next/server";
import { supabaseFromToken } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const sb = supabaseFromToken(token);

  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = u.user.id;

  const { data: run, error: rErr } = await sb
    .from("runs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });
  if (!run) return NextResponse.json({ run: null, state: null });

  const { data: stateRow, error: sErr } = await sb
    .from("run_state")
    .select("*")
    .eq("run_id", run.id)
    .single();

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  return NextResponse.json({ run, state: stateRow.state_json });
}
