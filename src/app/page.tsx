"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { createRun, loadLatestRun, saveRun, loadContent } from "@/lib/api";

export default function HomePage() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  const [run, setRun] = useState<any>(null);
  const [state, setState] = useState<any>(null);
  const [content, setContent] = useState<any>(null);

  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) setMsg(error.message);
  }

  async function signUp() {
    setMsg("");
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) setMsg(error.message);
    else setMsg("Signed up. Now sign in.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setRun(null);
    setState(null);
    setContent(null);
    setMsg("");
  }

  async function boot() {
    setMsg("Loading latest run...");
    const latest = await loadLatestRun();
    if (!latest.run) {
      setMsg("No active run found. Create a new run.");
      setRun(null);
      setState(null);
      return;
    }
    setRun(latest.run);
    setState(latest.state);

    setMsg("Loading content...");
    const c = await loadContent(["combat_core"]);
    setContent(c.content.combat_core ?? null);
    setMsg("Ready.");
  }

  async function newRun() {
    const initialState = {
      meta: { startedAt: new Date().toISOString(), playtimeSeconds: 0 },
      progress: { nodeId: "intro" },
      player: { hp: 72, focus: 60, tension: 45 },
      combat: { turn: 1, phase: "PLAYER" }
    };
    const created = await createRun("Test Run", initialState);
    setRun(created.run);
    setState(initialState);

    const c = await loadContent(["combat_core"]);
    setContent(c.content.combat_core ?? null);
    setMsg("Created new run.");
  }

  async function advanceTurnAndSave() {
    if (!run) return;
    const next = {
      ...state,
      combat: { ...(state?.combat ?? {}), turn: ((state?.combat?.turn ?? 1) + 1) }
    };
    setState(next);
    await saveRun(run.id, next);
    setMsg("Saved.");
  }

  const boxStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(80,110,190,0.35)",
    borderRadius: 14,
    padding: 12,
    overflow: "auto",
    maxHeight: 260,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
    fontSize: 12,
    lineHeight: 1.45
  };

  const inputStyle: React.CSSProperties = {
    padding: 10,
    borderRadius: 10,
    border: "1px solid rgba(80,110,190,0.35)",
    background: "rgba(0,0,0,0.25)",
    color: "#eaf0ff"
  };

  if (!session) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ marginTop: 0 }}>Menu RPG Web Lab</h2>
        <p>Sign in to load/save runs (Supabase Auth).</p>

        <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          <input placeholder="password" type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={inputStyle} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={signIn}>Sign In</button>
            <button onClick={signUp}>Sign Up</button>
          </div>

          <div style={{ opacity: 0.85 }}>{msg}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Menu RPG Web Lab</h2>
        <button onClick={signOut}>Sign out</button>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={boot}>Load Latest Run</button>
        <button onClick={newRun}>Create New Run</button>
        <button disabled={!run} onClick={advanceTurnAndSave}>Test Save (advance turn)</button>
      </div>

      <p style={{ marginTop: 10, opacity: 0.9 }}>{msg}</p>

      <hr style={{ borderColor: "rgba(80,110,190,0.25)" }} />

      <h3>Run</h3>
      <pre style={boxStyle}>{JSON.stringify(run, null, 2)}</pre>

      <h3>State</h3>
      <pre style={boxStyle}>{JSON.stringify(state, null, 2)}</pre>

      <h3>Content (combat_core)</h3>
      <pre style={boxStyle}>{JSON.stringify(content, null, 2)}</pre>

      <p style={{ opacity: 0.8 }}>
        Next: Replace this page with the CombatMenu UI and call <code>saveRun(run.id, newState)</code> after every action.
      </p>
    </div>
  );
}
