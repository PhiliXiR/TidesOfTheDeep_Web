"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/ui/components/Card";
import { Button } from "@/ui/components/Button";
import type { ContentBundle } from "@/game/types";
import { validateContentBundle, type ContentBundleValidationResult } from "@/lib/validateContentBundle";
import { loadContent, saveContent } from "@/lib/api";

type Mode = "VIEW" | "EDIT";

function tryParseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

export default function ContentEditor() {
  const [mode, setMode] = useState<Mode>("VIEW");
  const [status, setStatus] = useState<string>("");

  const [raw, setRaw] = useState<string>("");
  const initialRawRef = useRef<string>("");

  const [validation, setValidation] = useState<ContentBundleValidationResult | null>(null);
  const [parseError, setParseError] = useState<string>("");

  const [writeAllowed, setWriteAllowed] = useState<boolean>(true);
  const [writeMode, setWriteMode] = useState<string>("open");

  const dirty = raw !== initialRawRef.current;

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    const parsed = tryParseJson(raw);
    if (!parsed.ok) return null;
    return parsed.value as ContentBundle;
  }, [raw]);

  const canSave = useMemo(() => {
    return !!writeAllowed && !!validation?.ok && dirty;
  }, [writeAllowed, validation?.ok, dirty]);

  async function load() {
    setStatus("Loading content_bundle...");
    setParseError("");

    const result = await loadContent(["content_bundle"], { includeMeta: true });
    const bundle = result.content.content_bundle as ContentBundle | undefined;

    if (!bundle) {
      setStatus("Missing content_bundle in Supabase content table.");
      setRaw("");
      initialRawRef.current = "";
      setValidation(null);
      return;
    }

    const pretty = JSON.stringify(bundle, null, 2);
    setRaw(pretty);
    initialRawRef.current = pretty;
    setValidation(validateContentBundle(bundle));

    if (result.meta?.writeAllowed !== undefined) setWriteAllowed(!!result.meta.writeAllowed);
    if (result.meta?.writeMode) setWriteMode(result.meta.writeMode);

    setStatus("Loaded.");
  }

  useEffect(() => {
    load().catch((e: any) => setStatus(e?.message ?? "Load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Block navigation when dirty (best-effort for App Router)
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }

    function onClickCapture(e: MouseEvent) {
      if (!dirty) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a) return;

      const href = a.getAttribute("href") || "";
      if (!href) return;

      // Only guard internal navigations
      const isInternal = href.startsWith("/") && !href.startsWith("//");
      if (!isInternal) return;

      const ok = window.confirm("You have unsaved changes. Leave this page?");
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty]);

  function prettify() {
    setParseError("");
    const parsed = tryParseJson(raw);
    if (!parsed.ok) {
      setParseError(parsed.error);
      setStatus("Fix JSON before prettifying.");
      return;
    }
    setRaw(JSON.stringify(parsed.value, null, 2));
    setStatus("Prettified.");
  }

  function validateNow() {
    setParseError("");
    const parsed = tryParseJson(raw);
    if (!parsed.ok) {
      setParseError(parsed.error);
      setValidation({ ok: false, errors: [{ path: "$", message: parsed.error }], warnings: [] });
      setStatus("Invalid JSON.");
      return;
    }

    const next = validateContentBundle(parsed.value);
    setValidation(next);
    setStatus(next.ok ? "Validation passed." : "Validation failed.");
  }

  async function save() {
    setStatus("");
    setParseError("");

    const parsed = tryParseJson(raw);
    if (!parsed.ok) {
      setParseError(parsed.error);
      setStatus("Invalid JSON.");
      return;
    }

    const checked = validateContentBundle(parsed.value);
    setValidation(checked);
    if (!checked.ok) {
      setStatus("Fix validation errors before saving.");
      return;
    }

    const bundle = parsed.value as ContentBundle;
    if (!bundle.contentVersion) bundle.contentVersion = "0.1.0";

    setStatus("Saving...");
    await saveContent("content_bundle", bundle);

    const pretty = JSON.stringify(bundle, null, 2);
    setRaw(pretty);
    initialRawRef.current = pretty;
    setStatus("Saved.");

    // re-fetch meta (writeAllowed may be environment-dependent)
    try {
      const meta = await loadContent(["content_bundle"], { includeMeta: true });
      if (meta.meta?.writeAllowed !== undefined) setWriteAllowed(!!meta.meta.writeAllowed);
      if (meta.meta?.writeMode) setWriteMode(meta.meta.writeMode);
    } catch {
      // ignore
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="game-title">Creator Mode</div>
          <div className="text-sm text-white/70 -mt-1">Content Bundle Editor</div>
          <div className="text-sm text-white/60">Edits Supabase content.key = <span className="text-neon-300 font-semibold">content_bundle</span></div>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant={mode === "VIEW" ? "hot" : "soft"} onClick={() => setMode("VIEW")}>View</Button>
          <Button variant={mode === "EDIT" ? "hot" : "soft"} onClick={() => setMode("EDIT")}>Edit</Button>
          <Button variant="soft" onClick={prettify} disabled={mode !== "EDIT"}>Prettify</Button>
          <Button variant="soft" onClick={validateNow}>Validate</Button>
          <Button variant="hot" onClick={save} disabled={!canSave}>Save</Button>
        </div>
      </div>

      {!writeAllowed ? (
        <div className="mb-3 text-sm text-white/80">
          <Card className="p-4">
            <div className="text-white/90 font-semibold">Writes disabled</div>
            <div className="text-white/70 mt-1">
              This environment is in <span className="text-neon-300 font-semibold">{writeMode}</span> write mode. Saving is disabled for your account.
              Set <span className="text-neon-300 font-semibold">CONTENT_WRITE_MODE=open</span> or add your email to <span className="text-neon-300 font-semibold">CONTENT_ADMIN_EMAILS</span>.
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="text-sm text-white/70">{status || ""}</div>
        <div className="ml-auto text-sm">
          {dirty ? <span className="text-amber-200">Unsaved changes</span> : <span className="text-white/50">No changes</span>}
        </div>
      </div>

      {parseError ? (
        <Card className="p-4 mb-3">
          <div className="text-white/90 font-semibold">JSON parse error</div>
          <div className="mt-1 text-white/70 font-mono text-sm whitespace-pre-wrap">{parseError}</div>
        </Card>
      ) : null}

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.2fr 0.8fr" }}>
        <Card className="p-4" >
          <div className="text-sm text-white/70 mb-2">{mode === "VIEW" ? "Read-only view" : "Edit JSON"}</div>
          {mode === "VIEW" ? (
            <pre className="text-xs text-white/85 whitespace-pre-wrap font-mono leading-relaxed">{raw || "(empty)"}</pre>
          ) : (
            <textarea
              className="w-full min-h-[70vh] rounded-2xl border border-neon-500/18 bg-black/25 px-4 py-3 text-white/90 font-mono text-xs leading-relaxed focus:border-neon-300/45 focus:bg-black/35 transition"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
            />
          )}
        </Card>

        <div className="grid gap-3">
          <Card className="p-4">
            <div className="text-white/90 font-semibold">Validation</div>
            <div className="mt-1 text-sm text-white/60">
              Save is enabled only when validation passes and changes are present.
            </div>

            <div className="mt-3">
              {validation ? (
                <div className="text-sm">
                  <div className={validation.ok ? "text-emerald-200" : "text-rose-200"}>
                    {validation.ok ? "OK" : `${validation.errors.length} error(s)`}
                  </div>

                  {validation.errors.length ? (
                    <div className="mt-3">
                      <div className="text-white/80 font-semibold mb-2">Errors</div>
                      <div className="grid gap-2">
                        {validation.errors.map((e, idx) => (
                          <div key={idx} className="text-xs">
                            <div className="text-white/85 font-mono">{e.path}</div>
                            <div className="text-white/60">{e.message}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {validation.warnings.length ? (
                    <div className="mt-3">
                      <div className="text-white/80 font-semibold mb-2">Warnings</div>
                      <div className="grid gap-2">
                        {validation.warnings.map((w, idx) => (
                          <div key={idx} className="text-xs">
                            <div className="text-white/85 font-mono">{w.path}</div>
                            <div className="text-white/60">{w.message}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-white/60">Not validated yet.</div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-white/90 font-semibold">Tips</div>
            <div className="mt-2 text-sm text-white/70 grid gap-2">
              <div>• Prefer editing in Edit mode, then Prettify.</div>
              <div>• Use Validate often; errors include JSON paths.</div>
              <div>• Creator Mode uses the same auth as runs.</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
