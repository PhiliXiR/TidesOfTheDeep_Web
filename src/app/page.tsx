"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { createRun, loadLatestRun, loadContent, saveRun } from "@/lib/api";
import type { ContentBundle, GameState } from "@/game/types";
import * as Engine from "@/game/engine";
import CombatMenu from "@/ui/CombatMenu";

import { Card } from "@/ui/components/Card";
import { Button } from "@/ui/components/Button";

export default function HomePage () {
  const [session, setSession] = useState<any>(null);

if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log("COMPONENTS:", { Card, Button, CombatMenu });
}


  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<string>("");

  const [content, setContent] = useState<ContentBundle | null>(null);
  const [run, setRun] = useState<any>(null);
  const [state, setState] = useState<GameState | null>(null);

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
    setState(Engine.normalizeState(bundle, latest.state));
    setMsg("Ready.");
  }

  async function newRun() {
    setMsg("Creating new run...");
    const bundle = content ?? (await loadBundle());
    setContent(bundle);

    const initial = Engine.makeNewRunState(bundle);
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

  return (
    <div className="min-h-screen bg-ink-950">
      <div className="noise" />

      {/* Stage */}
      <div className="mx-auto max-w-6xl p-6">
        {/* Top bar */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div>
            <div className="game-title game-title--animated">Tides of the Deep</div>
            <div className="text-sm text-white/70 -mt-1">Menu Lab</div>
            <div className="text-sm text-white/60">
              Early Access Build • Supabase Saves Enabled
            </div>
          </div>

          <div className="ml-auto flex flex-wrap gap-2">
            <Link href="/content" className="btn btn--soft">Creator Mode</Link>
            {session ? (
              <>
                <Button variant="soft" onClick={boot}>Load Latest Run</Button>
                <Button variant="hot" onClick={newRun}>Create New Run</Button>
                <Button variant="soft" onClick={signOut}>Sign out</Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Toast / status */}
        {msg ? (
          <div className="mb-3 text-sm text-white/75">{msg}</div>
        ) : null}
        {toast ? (
          <div className="mb-3 text-sm text-white/90">{toast}</div>
        ) : null}

        {/* Auth */}
        {!session ? (
          <div className="grid place-items-center py-10">
            <div className="w-full max-w-md">
              <Card className="p-5 ocean-bg">
                <div className="text-xl font-extrabold tracking-tight">Sign in</div>
                <div className="mt-1 text-sm text-white/70">
                  Use Supabase Auth to load/save runs.
                </div>

                <div className="mt-4 grid gap-3">
                  <input
                    className="w-full rounded-2xl border border-neon-500/20 bg-black/30 px-4 py-3 text-white/90 placeholder:text-white/35 focus:border-neon-300/45 focus:bg-black/40 transition"
                    placeholder="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <input
                    className="w-full rounded-2xl border border-neon-500/20 bg-black/30 px-4 py-3 text-white/90 placeholder:text-white/35 focus:border-neon-300/45 focus:bg-black/40 transition"
                    placeholder="password"
                    type="password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />

                  <div className="mt-1 flex gap-2 flex-wrap">
                    <Button variant="hot" onClick={signIn}>Sign In</Button>
                    <Button variant="soft" onClick={signUp}>Sign Up</Button>
                  </div>

                  {msg ? (
                    <div className="text-sm text-white/75">{msg}</div>
                  ) : (
                    <div className="text-sm text-white/50">
                      Tip: if you don’t get in, check your email confirmation.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : (
          /* App */
          <div className="mt-4">
            {!content ? (
              <Card className="p-5">
                <div className="text-white/80">
                  No content loaded. Click <span className="font-semibold text-neon-300">Load Latest Run</span> or{" "}
                  <span className="font-semibold text-neon-300">Create New Run</span>.
                </div>
              </Card>
            ) : !run || !state ? (
              <Card className="p-5">
                <div className="text-white/80">
                  No run loaded yet. Click <span className="font-semibold text-neon-300">Create New Run</span>.
                </div>
              </Card>
            ) : (
              <CombatMenu content={content} state={state} onCommit={commit} onSoftToast={softToast} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
