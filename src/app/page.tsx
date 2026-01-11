"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { createRun, loadLatestRun, loadContent, saveRun } from "@/lib/api";
import type { ContentBundle, GameState } from "@/game/types";
import * as Engine from "@/game/engine";
import CombatMenu from "@/ui/CombatMenu";

export default function HomePage() {
  const [session, setSession] = useState<any>(null);

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<string>("");

  const [content, setContent] = useState<ContentBundle | null>(null);
  const [run, setRun] = useState<any>(null);
  const [state, setState] = useState<GameState | null>(null);

  // small toast line for quick feedback
  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  function softToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(""), 1200);
  }

  async function signIn() {
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) setMsg(error.message);
  }

  async function signUp() {
    setMsg("");
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) setMsg(error.message);
    else setMsg("Signed up. Confirm your email if required, then sign in.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setRun(null);
    setState(null);
    setContent(null);
    setMsg("");
  }

  async function loadBundle(): Promise<ContentBundle> {
    const c = await loadContent(["content_bundle"]);
    const bundle = c.content.content_bundle as ContentBundle | undefined;
    if (!bundle) throw new Error("Missing content_bundle in Supabase content table.");
    return bundle;
  }

  async function boot() {
    setMsg("Loading content + latest run...");
    const bundle = await loadBundle();
    setContent(bundle);

    const latest = await loadLatestRun();
    if (!latest.run || !latest.state) {
      setMsg("No active run found. Create a new run.");
      setRun(null);
      setState(null);
      return;
    }

    setRun(latest.run);
    setState(latest.state as GameState);
    setMsg("Ready.");
  }

  async function newRun() {
    setMsg("Creating new run...");
    const bundle = content ?? (await loadBundle());
    setContent(bundle);

    const initial = Engine.restartRun(bundle);
    const created = await createRun("Test Run", initial);

    setRun(created.run);
    setState(initial);
    setMsg("Created.");
  }

  async function commit(next: GameState) {
    if (!run) throw new Error("No run to save.");
    setState(next);
    await saveRun(run.id, next);
  }

  const inputStyle: React.CSSProperties = useMemo(
    () => ({
      padding: 10,
      borderRadius: 10,
      border: "1px solid rgba(80,110,190,0.35)",
      background: "rgba(0,0,0,0.25)",
      color: "#eaf0ff"
    }),
    []
  );

  const btn: React.CSSProperties = useMemo(
    () => ({
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(120,160,255,0.22)",
      background: "rgba(0,0,0,0.35)",
      color: "#eaf0ff",
      cursor: "pointer"
    }),
    []
  );

  if (!session) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ marginTop: 0 }}>Menu RPG Web Lab</h2>
        <p style={{ opacity: 0.85 }}>
          Sign in to load/save runs (Supabase Auth).
        </p>

        <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          <input placeholder="password" type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={inputStyle} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btn} onClick={signIn}>Sign In</button>
            <button style={btn} onClick={signUp}>Sign Up</button>
          </div>

          <div style={{ opacity: 0.85 }}>{msg}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Menu RPG Web Lab</h2>
        <button style={btn} onClick={signOut}>Sign out</button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={btn} onClick={boot}>Load Latest Run</button>
          <button style={btn} onClick={newRun}>Create New Run</button>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>{msg}</div>
      {toast ? <div style={{ marginTop: 8, opacity: 0.95 }}>{toast}</div> : null}

      <div style={{ marginTop: 18 }}>
        {!content ? (
          <div style={{ opacity: 0.8 }}>
            No content loaded. Click <b>Load Latest Run</b> or <b>Create New Run</b>.
          </div>
        ) : !run || !state ? (
          <div style={{ opacity: 0.8 }}>
            No run loaded yet. Click <b>Create New Run</b>.
          </div>
        ) : (
          <CombatMenu
            content={content}
            state={state}
            onCommit={commit}
            onSoftToast={softToast}
          />
        )}
      </div>
    </div>
  );
}
