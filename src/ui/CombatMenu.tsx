"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ContentBundle, GameState, Id } from "@/game/types";
import * as Engine from "@/game/engine";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/ui/components/Button";
import { Progress } from "@/ui/components/Progress";
import { Modal } from "@/ui/components/Modal";

type Props = {
  content: ContentBundle;
  state: GameState;
  onCommit: (next: GameState) => Promise<void>;
  onSoftToast?: (text: string) => void;
};

type Tab = "MAIN" | "FIGHT" | "ITEMS" | "TECHNIQUES";

type FloatText = {
  id: string;
  text: string;
  kind: "damage" | "heal" | "xp" | "info";
};

type TimelineItem = {
  id: string;
  text: string;
  tone: "neutral" | "good" | "bad";
};

function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function TabIcon({ tab }: { tab: Tab }) {
  // simple crisp glyphs (no deps)
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none" as const };
  switch (tab) {
    case "MAIN":
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "FIGHT":
      return (
        <svg {...common}>
          <path d="M6 18h12M8 18V6l4-2 4 2v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M10 10h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "ITEMS":
      return (
        <svg {...common}>
          <path d="M7 7h10v14H7V7Z" stroke="currentColor" strokeWidth="2" />
          <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" />
          <path d="M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "TECHNIQUES":
      return (
        <svg {...common}>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 8a4 4 0 1 0 0 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function CombatMenu({ content, state, onCommit, onSoftToast }: Props) {
  const [tab, setTab] = useState<Tab>("MAIN");
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);

  const inCombat = !!state.combat;
  const enemy = state.combat ? content.enemies[state.combat.enemyId] : null;

  const regionList = useMemo(() => Object.values(content.regions), [content.regions]);
  const region = content.regions[state.progress.regionId];

  // keep selectedRegionIndex synced to current regionId (on load/run changes)
  useEffect(() => {
    const idx = Math.max(0, regionList.findIndex((r) => r.id === state.progress.regionId));
    setSelectedRegionIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.progress.regionId, regionList.length]);

  const selectedRegion = regionList[selectedRegionIndex] ?? regionList[0];

  const fightActions = useMemo(() => {
    const ids = state.player.knownActions ?? [];
    return ids.map((id) => content.actions[id]).filter(Boolean);
  }, [state.player.knownActions, content.actions]);

  const inventoryList = useMemo(() => {
    const out: { id: Id; label: string; count: number; heal: number }[] = [];
    for (const [id, count] of Object.entries(state.player.inventory || {})) {
      if (count <= 0) continue;
      const item = content.items[id];
      if (!item) continue;
      out.push({ id, label: item.label, count, heal: item.heal });
    }
    return out;
  }, [state.player.inventory, content.items]);

  async function safeCommit(next: GameState) {
    try {
      await onCommit(next);
    } catch (e: any) {
      onSoftToast?.(e?.message ?? "Commit failed");
    }
  }

  function pushTimelineFrom(next: GameState) {
    const e = next.lastEvent;
    if (!e) return;

    let text = "";
    let tone: TimelineItem["tone"] = "neutral";

    if (e.type === "LOG") text = e.text;
    else if (e.type === "SPAWN") text = `Hooked a fish • ${e.regionId}`;
    else if (e.type === "DAMAGE") {
      text = `${e.who === "enemy" ? "Enemy" : "You"} took ${e.amount} dmg`;
      tone = e.who === "enemy" ? "good" : "bad";
    } else if (e.type === "HEAL") {
      text = `Recovered ${e.amount}`;
      tone = "good";
    } else if (e.type === "XP") {
      text = `+${e.amount} XP`;
      tone = "good";
    } else if (e.type === "LEVEL_UP") {
      text = `LEVEL UP → ${e.level}`;
      tone = "good";
    } else if (e.type === "FLEE") {
      text = "Fled.";
      tone = "neutral";
    } else if (e.type === "DEFEAT_PROMPT") {
      text = "Defeated…";
      tone = "bad";
    }

    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const item: TimelineItem = { id, text, tone };

    setTimeline((prev) => [item, ...prev].slice(0, 6));
  }

  function spawnFloatFrom(next: GameState) {
    const e = next.lastEvent;
    if (!e) return;

    let text = "";
    let kind: FloatText["kind"] = "info";

    if (e.type === "DAMAGE") { text = `-${e.amount}`; kind = "damage"; }
    else if (e.type === "HEAL") { text = `+${e.amount}`; kind = "heal"; }
    else if (e.type === "XP") { text = `+${e.amount} XP`; kind = "xp"; }
    else if (e.type === "LEVEL_UP") { text = `LEVEL UP`; kind = "info"; }
    else if (e.type === "SPAWN") { text = `HOOKED`; kind = "info"; }
    else if (e.type === "FLEE") { text = `FLED`; kind = "info"; }
    else if (e.type === "DEFEAT_PROMPT") { text = `DEFEATED`; kind = "info"; }
    else return;

    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setFloats((prev) => [{ id, text, kind }, ...prev].slice(0, 3));
    window.setTimeout(() => setFloats((prev) => prev.filter((x) => x.id !== id)), 900);
  }

  async function act(fn: () => GameState) {
    const next = fn();
    pushTimelineFrom(next);
    spawnFloatFrom(next);
    await safeCommit(next);
  }

  const defeatPromptOpen = state.combat?.outcome === "DEFEAT_PROMPT";

  const tabs: { id: Tab; label: string; enabled: boolean }[] = [
    { id: "MAIN", label: "Main", enabled: true },
    { id: "FIGHT", label: "Fight", enabled: inCombat },
    { id: "ITEMS", label: "Items", enabled: true },
    { id: "TECHNIQUES", label: "Techniques", enabled: inCombat }
  ];

  const activeTabIndex = useMemo(() => Math.max(0, tabs.findIndex((t) => t.id === tab)), [tab]);

  // ---------- Keyboard controls ----------
  const lastKeyTimeRef = useRef(0);

  function moveRegionSelection(delta: number) {
    if (regionList.length <= 1) return;

    // skip locked regions automatically
    const start = selectedRegionIndex;
    let idx = start;

    for (let i = 0; i < regionList.length; i++) {
      idx = (idx + delta + regionList.length) % regionList.length;
      const r = regionList[idx];
      const locked = state.player.level < r.requiredLevel;
      if (!locked) {
        setSelectedRegionIndex(idx);
        return;
      }
    }
    // if everything is locked (shouldn't happen), just clamp to existing
    setSelectedRegionIndex(start);
  }

  function confirmEnter() {
    // If defeat prompt, Enter = Retry (feels natural)
    if (defeatPromptOpen) {
      act(() => Engine.retryFight(content, state));
      return;
    }

    if (tab === "MAIN") {
      const r = selectedRegion;
      if (!r) return;

      const locked = state.player.level < r.requiredLevel;
      if (locked) {
        onSoftToast?.("Locked region.");
        return;
      }

      // If selection != current -> select region
      if (r.id !== state.progress.regionId) {
        act(() => Engine.setRegion(content, state, r.id));
        return;
      }

      // If selection == current -> start fight
      if (!state.combat) {
        act(() => Engine.startFight(content, state));
        return;
      }

      // If already in combat, jump to Fight
      setTab("FIGHT");
      return;
    }

    // In combat tabs: keep Enter non-destructive by default
    // (You can later map Enter to "default action" if you want.)
  }

  function handleEsc() {
    if (defeatPromptOpen) {
      act(() => Engine.flee(state));
      return;
    }

    if (tab !== "MAIN") {
      setTab("MAIN");
      return;
    }

    // If you're in combat and on MAIN, Esc goes to Fight (prevents "stuck" feel)
    if (inCombat) {
      setTab("FIGHT");
      return;
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // basic throttle to avoid accidental key-repeat spam
      const now = Date.now();
      if (now - lastKeyTimeRef.current < 35) return;
      lastKeyTimeRef.current = now;

      if (e.key === "Escape") {
        e.preventDefault();
        handleEsc();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        confirmEnter();
        return;
      }

      // Allow region navigation only on MAIN tab (this keeps it predictable)
      if (tab === "MAIN" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        moveRegionSelection(e.key === "ArrowUp" ? -1 : 1);
        return;
      }

      // Optional: number keys to tabs (very JRPG)
      if (e.key === "1") setTab("MAIN");
      if (e.key === "2" && inCombat) setTab("FIGHT");
      if (e.key === "3") setTab("ITEMS");
      if (e.key === "4" && inCombat) setTab("TECHNIQUES");
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, inCombat, defeatPromptOpen, selectedRegionIndex, regionList, state]);

  // ---------- UI helpers ----------
  function TabsRow() {
    return (
      <div className="tabs">
        <motion.div
          className="tab-indicator"
          initial={false}
          animate={{ x: activeTabIndex * (92 + 6) }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        />
        {tabs.map((t) => (
          <button
            key={t.id}
            className="tab"
            disabled={!t.enabled}
            onClick={() => t.enabled && setTab(t.id)}
            title={t.label}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <span style={{ opacity: 0.92 }}>
                <TabIcon tab={t.id} />
              </span>
              <span>{t.label}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  function TurnChip() {
    if (!inCombat) return null;
    const phase = state.combat?.phase;
    const isPlayer = phase === "PLAYER";
    const cls = ["turn-chip", isPlayer ? "turn-chip--player" : "turn-chip--enemy"].join(" ");
    return (
      <motion.div
        className={cls}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        title="Esc = back • Enter = confirm"
      >
        <span className="turn-chip-dot" />
        {isPlayer ? "YOUR TURN" : "ENEMY TURN"}
      </motion.div>
    );
  }

  function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
    return (
      <AnimatePresence mode="wait">
        {show ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 220, damping: 24 }}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    );
  }

  function Timeline() {
    return (
      <div style={{ minWidth: 260, maxWidth: 360 }}>
        <div className="label" style={{ marginBottom: 6 }}>Timeline</div>
        <div
          className="panel"
          style={{
            padding: 10,
            borderRadius: 14,
            background: "linear-gradient(180deg, rgba(0,0,0,.20), rgba(0,0,0,.10))"
          }}
        >
          <AnimatePresence initial={false}>
            {timeline.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.7 }}
                exit={{ opacity: 0 }}
                className="dim mono"
              >
                Actions will appear here…
              </motion.div>
            ) : (
              timeline.map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(255,255,255,.06)"
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      opacity: 0.7,
                      width: 16,
                      textAlign: "center",
                      color:
                        t.tone === "good"
                          ? "rgba(70,255,230,.85)"
                          : t.tone === "bad"
                          ? "rgba(255,140,210,.85)"
                          : "rgba(120,170,255,.85)"
                    }}
                  >
                    ●
                  </span>
                  <span className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,.78)" }}>
                    {t.text}
                  </span>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        <div className="dim mono" style={{ marginTop: 8 }}>
          ↑/↓ choose • Enter confirm • Esc back
        </div>
      </div>
    );
  }

  function OverworldPanel() {
    return (
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <div className="label">Select Destination</div>
          <div className="subtle">↑/↓ selects • Enter confirms • Enter again starts fight</div>
        </div>

        <div className="list">
          {regionList.map((r, idx) => {
            const locked = state.player.level < r.requiredLevel;
            const active = r.id === state.progress.regionId;
            const selected = idx === selectedRegionIndex;

            return (
              <motion.button
                key={r.id}
                disabled={locked}
                onClick={() => {
                  setSelectedRegionIndex(idx);
                  if (!locked) act(() => Engine.setRegion(content, state, r.id));
                }}
                className={["row", active ? "row--active" : ""].join(" ")}
                initial={false}
                animate={selected ? { scale: 1 } : { scale: 1 }}
                whileHover={locked ? undefined : { scale: 1.005 }}
                whileTap={locked ? undefined : { scale: 0.995 }}
              >
                <div className="row-left">
                  <motion.span
                    className="cursor mono"
                    initial={false}
                    animate={{ opacity: selected ? 1 : 0, x: selected ? 0 : -6 }}
                    transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  >
                    ▶
                  </motion.span>

                  <div style={{ minWidth: 0 }}>
                    <div className="row-title">
                      {r.name} {locked ? <span className="dim mono" style={{ marginLeft: 8 }}>🔒</span> : null}
                    </div>
                    <div className="row-sub mono">{r.id}</div>
                  </div>
                </div>

                <div className="mono subtle">Lv {r.requiredLevel}+</div>
              </motion.button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="hot" disabled={!!state.combat} onClick={() => act(() => Engine.startFight(content, state))}>
            Start Fight
          </Button>
          <Button variant="soft" onClick={() => act(() => Engine.makeNewRunState(content))}>
            Soft Reset
          </Button>
        </div>

        <div className="label">
          Current <span className="mono subtle">• {region?.name ?? state.progress.regionId}</span>
        </div>
      </div>
    );
  }

  function FightPanel() {
    if (!inCombat || !enemy) return <div className="subtle">No combat right now.</div>;
    const lockedByPrompt = defeatPromptOpen;

    return (
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <div className="label">Commands</div>
          <div className="subtle">Choose an action.</div>
        </div>

        <div className="grid" style={{ gap: 8 }}>
          {fightActions.map((a) => {
            const cost = a.focusCost ?? 0;
            const disabled = lockedByPrompt || state.combat?.phase !== "PLAYER" || state.player.focus < cost;

            const subtitle =
              a.kind === "attack"
                ? `DMG ${a.damage ?? 0}${cost ? ` • Focus -${cost}` : ""}`
                : `Heal ${a.heal ?? 0} • Focus +${a.focusGain ?? 0}${cost ? ` • Cost ${cost}` : ""}`;

            return (
              <Button
                key={a.id}
                variant="hot"
                disabled={disabled}
                onClick={() => act(() => Engine.applyAction(content, state, a.id))}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12 }}
              >
                <span className="value">{a.label}</span>
                <span className="mono subtle">{subtitle}</span>
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  function ItemsPanel() {
    return (
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <div className="label">Items</div>
          <div className="subtle">Use an item at any time.</div>
        </div>

        {inventoryList.length === 0 ? (
          <div className="subtle">No items.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {inventoryList.map((it) => (
              <Button
                key={it.id}
                variant="soft"
                onClick={() => act(() => Engine.useItem(content, state, it.id))}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12 }}
              >
                <span className="value">{it.label}</span>
                <span className="mono subtle">x{it.count} • Heal {it.heal}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function TechniquesPanel() {
    if (!inCombat) return <div className="subtle">No combat right now.</div>;
    return (
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <div className="label">Techniques</div>
          <div className="subtle">Placeholder (same list as Fight).</div>
        </div>
        <FightPanel />
      </div>
    );
  }

  const enemyFlashKey = state.combat ? `enemyhp_${state.combat.enemyHp}` : "enemyhp_none";
  const hitEnemy = state.lastEvent?.type === "DAMAGE" && state.lastEvent.who === "enemy";

  return (
    <>
      {/* background layers */}
      <div className="ocean-drift" />
      <div className="noise" />

      <div className="frame pad-lg" style={{ position: "relative" }}>
        {/* float numbers */}
        <div className="float-layer">
          <AnimatePresence>
            {floats.map((f, idx) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: -10 - idx * 16, scale: 1 }}
                exit={{ opacity: 0, y: -22 - idx * 18, scale: 0.98 }}
                transition={{ duration: 0.55 }}
                className={[
                  "float",
                  f.kind === "damage"
                    ? "float--dmg"
                    : f.kind === "heal"
                    ? "float--heal"
                    : f.kind === "xp"
                    ? "float--xp"
                    : "float--info"
                ].join(" ")}
              >
                {f.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Header + Timeline row */}
        <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6, minWidth: 280, flex: "1 1 420px" }}>
              <div className="title">Tides of the Deep</div>
              <div className="label">
                Region{" "}
                <span className="mono" style={{ color: "rgba(255,255,255,.72)" }}>
                  {state.progress.regionId}
                </span>
                {inCombat ? (
                  <>
                    <span style={{ margin: "0 8px", color: "rgba(255,255,255,.22)" }}>•</span>
                    Turn{" "}
                    <span className="mono" style={{ color: "rgba(255,255,255,.72)" }}>
                      {state.combat?.turn}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="dim mono" style={{ lineHeight: 1.35 }}>
                {state.lastEvent?.type === "LOG" ? state.lastEvent.text : " "}
              </div>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <TurnChip />
              <TabsRow />
            </div>

            <div style={{ flex: "0 1 360px", marginLeft: "auto" }}>
              <Timeline />
            </div>
          </div>
        </div>

        {/* HUD */}
        <div className="grid-2" style={{ marginBottom: 10 }}>
          {/* Player */}
          <div className="panel" style={{ padding: 12 }}>
            <div className="panel-head">
              <div className="badge">
                <span className="badge-dot" />
                <span className="label">Player</span>
              </div>
              <div className="mono subtle">Lv {state.player.level}</div>
            </div>

            <div className="grid" style={{ gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="label">Experience</span>
                <span className="mono subtle">{state.player.xp}/{state.player.xpToNext}</span>
              </div>
              <div className="bar">
                <motion.div
                  className="bar-fill bar-fill--neon"
                  initial={{ width: 0 }}
                  animate={{
                    width:
                      state.player.xpToNext <= 0
                        ? "0%"
                        : `${Math.max(0, Math.min(100, (state.player.xp / state.player.xpToNext) * 100))}%`
                  }}
                  transition={{ type: "spring", stiffness: 140, damping: 20 }}
                />
              </div>

              <Progress label="HP" value={state.player.hp} max={state.player.maxHp} tone="neon" />
              <Progress label="Focus" value={state.player.focus} max={state.player.maxFocus} tone="aqua" />
            </div>
          </div>

          {/* Enemy */}
          <div className="panel" style={{ padding: 12, position: "relative", overflow: "hidden" }}>
            <AnimatePresence>
              {hitEnemy ? (
                <motion.div
                  key="ripple"
                  initial={{ opacity: 0.0, scale: 0.8 }}
                  animate={{ opacity: 0.24, scale: 1.35 }}
                  exit={{ opacity: 0.0 }}
                  transition={{ duration: 0.35 }}
                  style={{
                    position: "absolute",
                    right: -80,
                    top: -90,
                    width: 260,
                    height: 260,
                    borderRadius: 999,
                    background:
                      "radial-gradient(circle, rgba(70,255,230,.22), rgba(120,170,255,.10), transparent 65%)",
                    pointerEvents: "none"
                  }}
                />
              ) : null}
            </AnimatePresence>

            <div className="panel-head">
              <div className="badge">
                <span className="badge-dot" style={{ background: "rgba(70,255,230,.72)" }} />
                <span className="label">Enemy</span>
              </div>
              <div className="mono subtle">{enemy ? `HP ${state.combat?.enemyHp}/${enemy.maxHp}` : ""}</div>
            </div>

            {inCombat && enemy ? (
              <div className="grid" style={{ gap: 10 }}>
                <motion.div
                  key={enemyFlashKey}
                  initial={{ x: 0 }}
                  animate={{ x: hitEnemy ? [0, -2, 2, -1, 1, 0] : 0 }}
                  transition={{ duration: 0.22 }}
                  className="value"
                  style={{ fontSize: 16 }}
                >
                  {enemy.name}
                </motion.div>

                <Progress label="HP" value={state.combat!.enemyHp} max={enemy.maxHp} tone="neon" />

                <div className="label">
                  <span className="mono subtle">ATK {enemy.attack}</span>
                  <span style={{ margin: "0 8px", color: "rgba(255,255,255,.22)" }}>•</span>
                  <span className="mono subtle">XP {enemy.xp}</span>
                </div>
              </div>
            ) : (
              <div className="subtle">No enemy engaged.</div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="panel" style={{ padding: 12 }}>
          <Panel show={tab === "MAIN"}><OverworldPanel /></Panel>
          <Panel show={tab === "FIGHT"}><FightPanel /></Panel>
          <Panel show={tab === "ITEMS"}><ItemsPanel /></Panel>
          <Panel show={tab === "TECHNIQUES"}><TechniquesPanel /></Panel>
        </div>

        {/* Defeat */}
        <Modal open={defeatPromptOpen} title="Defeated">
          <div className="subtle">Retry the same fish, or flee back to the overworld.</div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="hot" onClick={() => act(() => Engine.retryFight(content, state))}>Retry</Button>
            <Button variant="soft" onClick={() => act(() => Engine.flee(state))}>Flee</Button>
          </div>
          <div className="dim mono" style={{ marginTop: 10 }}>Enter = Retry • Esc = Flee</div>
        </Modal>
      </div>
    </>
  );
}

export default CombatMenu;
