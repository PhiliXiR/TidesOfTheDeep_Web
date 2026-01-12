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

type TimingGrade = "MISS" | "GOOD" | "PERFECT";

type FloatText = {
  id: string;
  text: string;
  kind: "tension" | "integrity" | "stamina" | "xp" | "info";
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
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none" as const };
  switch (tab) {
    case "MAIN":
      return (
        <svg {...common}>
          <path
            d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      );
    case "FIGHT":
      return (
        <svg {...common}>
          <path
            d="M6 18h12M8 18V6l4-2 4 2v12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M10 10h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "ITEMS":
      return (
        <svg {...common}>
          <path d="M7 7h10v14H7V7Z" stroke="currentColor" strokeWidth="2" />
          <path
            d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "TECHNIQUES":
      return (
        <svg {...common}>
          <path
            d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M12 8a4 4 0 1 0 0 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function CombatMenu({ content, state, onCommit, onSoftToast }: Props) {
  const [tab, setTab] = useState<Tab>("MAIN");

  const [timingOpen, setTimingOpen] = useState(false);
  const [timingActionId, setTimingActionId] = useState<Id | null>(null);
  const timingStartRef = useRef<number>(0);
  const timingStateRef = useRef<GameState | null>(null);
  const [timingPos, setTimingPos] = useState(0); // 0..1

  // cursors
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);

  const [floats, setFloats] = useState<FloatText[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  const inCombat = !!state.combat;
  const enemy = state.combat ? content.enemies[state.combat.enemyId] : null;

  const regionList = useMemo(() => Object.values(content.regions), [content.regions]);
  const region = content.regions[state.progress.regionId];

  // sync region selection to current region
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

  // keep action/item cursors in range
  useEffect(() => {
    setSelectedActionIndex((i) => clamp(i, 0, Math.max(0, fightActions.length - 1)));
  }, [fightActions.length]);

  useEffect(() => {
    setSelectedItemIndex((i) => clamp(i, 0, Math.max(0, inventoryList.length - 1)));
  }, [inventoryList.length]);

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
    else if (e.type === "SPAWN") {
      const fishName = content.enemies[e.enemyId]?.name ?? e.enemyId;
      text = `Hooked • ${fishName} (${e.regionId})`;
    } else if (e.type === "TIMING") {
      text = e.grade === "PERFECT" ? "Perfect timing." : e.grade === "GOOD" ? "Good timing." : "Missed timing.";
      tone = e.grade === "MISS" ? "bad" : "good";
    } else if (e.type === "TENSION") {
      text = e.delta > 0 ? "Tension rises." : "Tension settles.";
      tone = e.delta > 0 ? "bad" : "good";
    } else if (e.type === "INTEGRITY") {
      text = e.delta < 0 ? "Line integrity damaged." : "Line integrity restored.";
      tone = e.delta < 0 ? "bad" : "good";
    } else if (e.type === "STAMINA") {
      const mag = Math.abs(e.delta);
      text = mag >= 20 ? "Big gain on the fish." : mag >= 10 ? "You gain ground." : "Slight progress.";
      tone = "good";
    } else if (e.type === "PHASE") {
      text = e.phase === "AGGRESSIVE" ? "The fish surges." : e.phase === "DEFENSIVE" ? "The fish resists." : "The fish is tiring.";
      tone = e.phase === "AGGRESSIVE" ? "bad" : "good";
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

    if (e.type === "TENSION") {
      text = e.delta > 0 ? "TENSION" : "CALM";
      kind = "tension";
    } else if (e.type === "INTEGRITY") {
      text = e.delta < 0 ? "LINE!" : "REPAIR";
      kind = "integrity";
    } else if (e.type === "STAMINA") {
      text = "GAIN";
      kind = "stamina";
    } else if (e.type === "XP") {
      text = `+${e.amount} XP`;
      kind = "xp";
    } else if (e.type === "LEVEL_UP") {
      text = `LEVEL UP`;
      kind = "info";
    } else if (e.type === "SPAWN") {
      text = `HOOKED`;
      kind = "info";
    } else if (e.type === "FLEE") {
      text = `FLED`;
      kind = "info";
    } else if (e.type === "DEFEAT_PROMPT") {
      text = `DEFEATED`;
      kind = "info";
    } else return;

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

  function disabledReasonForAction(actionId: Id): string | null {
    const a = content.actions[actionId];
    if (!a) return "Missing action";
    if (defeatPromptOpen) return "Defeated (retry or flee)";
    if (!inCombat) return "Not in combat";
    if (state.combat?.phase !== "PLAYER") return "Fish turn";
    return null;
  }

  function disabledReasonForItem(itemId: Id): string | null {
    if (defeatPromptOpen) return "Defeated (retry or flee)";
    if (inCombat && state.combat?.phase !== "PLAYER") return "Fish turn";
    const count = state.player.inventory?.[itemId] ?? 0;
    if (count <= 0) return "Out of stock";
    if (!content.items[itemId]) return "Missing item";
    return null;
  }

  const tabs: { id: Tab; label: string; enabled: boolean }[] = [
    { id: "MAIN", label: "Main", enabled: true },
    { id: "FIGHT", label: "Fight", enabled: inCombat },
    { id: "ITEMS", label: "Items", enabled: true },
    { id: "TECHNIQUES", label: "Techniques", enabled: inCombat }
  ];

  const activeTabIndex = useMemo(() => Math.max(0, tabs.findIndex((t) => t.id === tab)), [tab]);

  useEffect(() => {
    if (!timingOpen) return;
    let raf = 0;
    const periodMs = 980;

    const loop = () => {
      const start = timingStartRef.current;
      const t = start ? ((Date.now() - start) % periodMs) / periodMs : 0;
      // triangle wave: 0..1..0
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
      setTimingPos(tri);
      raf = window.requestAnimationFrame(loop);
    };

    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [timingOpen]);

  function gradeFromTimingPos(pos: number): TimingGrade {
    const dist = Math.abs(pos - 0.5);
    if (dist <= 0.07) return "PERFECT";
    if (dist <= 0.18) return "GOOD";
    return "MISS";
  }

  function pushTimelineText(text: string, tone: TimelineItem["tone"]) {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setTimeline((prev) => [{ id, text, tone }, ...prev].slice(0, 6));
  }

  // ---------- Keyboard controls ----------
  const lastKeyTimeRef = useRef(0);

  function moveRegionSelection(delta: number) {
    if (regionList.length <= 1) return;

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
    setSelectedRegionIndex(start);
  }

  function moveActionSelection(delta: number) {
    if (fightActions.length <= 1) return;
    setSelectedActionIndex((i) => (i + delta + fightActions.length) % fightActions.length);
  }

  function moveItemSelection(delta: number) {
    if (inventoryList.length <= 1) return;
    setSelectedItemIndex((i) => (i + delta + inventoryList.length) % inventoryList.length);
  }

  function confirmEnter() {
    if (timingOpen) {
      const aId = timingActionId;
      const base = timingStateRef.current;
      if (!aId || !base) {
        setTimingOpen(false);
        setTimingActionId(null);
        return;
      }

      const grade = gradeFromTimingPos(timingPos);
      pushTimelineText(
        grade === "PERFECT" ? "Perfect timing." : grade === "GOOD" ? "Good timing." : "Missed timing.",
        grade === "MISS" ? "bad" : "good"
      );

      setTimingOpen(false);
      setTimingActionId(null);
      timingStateRef.current = null;

      act(() => Engine.applyAction(content, base, aId, grade));
      return;
    }

    // Defeat prompt: Enter = Retry
    if (defeatPromptOpen) {
      act(() => Engine.retryFight(content, state));
      return;
    }

    // MAIN: Enter confirms region or starts fight
    if (tab === "MAIN") {
      const r = selectedRegion;
      if (!r) return;

      const locked = state.player.level < r.requiredLevel;
      if (locked) {
        onSoftToast?.("Locked region.");
        return;
      }

      if (r.id !== state.progress.regionId) {
        act(() => Engine.setRegion(content, state, r.id));
        return;
      }

      if (!state.combat) {
        act(() => Engine.startFight(content, state));
        return;
      }

      // already in combat -> go Fight
      setTab("FIGHT");
      return;
    }

    // FIGHT: Enter executes selected action
    if (tab === "FIGHT" && inCombat) {
      const a = fightActions[selectedActionIndex];
      if (!a) return;

      const disabled = defeatPromptOpen || state.combat?.phase !== "PLAYER";
      if (disabled) return;

      // Timing check for reel-style actions (legacy attack)
      const needsTiming = a.timing === "basic" || a.kind === "attack" || a.kind === "reel" || a.kind === "technique";
      if (needsTiming) {
        timingStateRef.current = state;
        timingStartRef.current = Date.now();
        setTimingActionId(a.id);
        setTimingOpen(true);
        return;
      }

      act(() => Engine.applyAction(content, state, a.id));
      return;
    }

    // ITEMS: Enter uses selected item
    if (tab === "ITEMS") {
      const it = inventoryList[selectedItemIndex];
      if (!it) return;
      const reason = disabledReasonForItem(it.id);
      if (reason) return;
      act(() => Engine.useItem(content, state, it.id));
      return;
    }
  }

  function handleEsc() {
    if (timingOpen) {
      setTimingOpen(false);
      setTimingActionId(null);
      timingStateRef.current = null;
      return;
    }

    if (defeatPromptOpen) {
      act(() => Engine.flee(state));
      return;
    }

    if (tab !== "MAIN") {
      setTab("MAIN");
      return;
    }

    if (inCombat) {
      setTab("FIGHT");
      return;
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

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

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (timingOpen) return;
        const delta = e.key === "ArrowUp" ? -1 : 1;

        if (tab === "MAIN") moveRegionSelection(delta);
        else if (tab === "FIGHT") moveActionSelection(delta);
        else if (tab === "ITEMS") moveItemSelection(delta);
        else if (tab === "TECHNIQUES") moveActionSelection(delta); // placeholder: same list
        return;
      }

      // quick tabs 1-4
      if (timingOpen) return;
      if (e.key === "1") setTab("MAIN");
      if (e.key === "2" && inCombat) setTab("FIGHT");
      if (e.key === "3") setTab("ITEMS");
      if (e.key === "4" && inCombat) setTab("TECHNIQUES");
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    inCombat,
    defeatPromptOpen,
    timingOpen,
    timingActionId,
    timingPos,
    selectedRegionIndex,
    selectedActionIndex,
    selectedItemIndex,
    regionList.length,
    fightActions.length,
    inventoryList.length,
    state
  ]);

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
        <div className="label" style={{ marginBottom: 6 }}>
          Timeline
        </div>
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
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} exit={{ opacity: 0 }} className="dim mono">
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

  // --- Persona-like selectable row ---
  function SelectRow({
    title,
    subtitle,
    hint,
    right,
    selected,
    disabled,
    onClick
  }: {
    title: string;
    subtitle?: string;
    hint?: string;
    right?: string;
    selected: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }) {
    return (
      <motion.button
        disabled={disabled}
        onClick={onClick}
        title={disabled && hint ? hint : undefined}
        className={[
          "select-row",
          selected ? "select-row--selected" : "",
          disabled ? "select-row--disabled" : ""
        ].join(" ")}
        whileHover={disabled ? undefined : { scale: 1.003 }}
        whileTap={disabled ? undefined : { scale: 0.995 }}
      >
        <div className="select-left">
          <motion.span
            className="select-cursor mono"
            initial={false}
            animate={{ opacity: selected ? 1 : 0, x: selected ? 0 : -8 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
          >
            ▶
          </motion.span>

          <div style={{ minWidth: 0 }}>
            <div className="select-title">{title}</div>
            {subtitle ? <div className="select-sub mono">{subtitle}</div> : null}
            {hint ? <div className="select-sub mono" style={{ opacity: 0.68 }}>{hint}</div> : null}
          </div>
        </div>

        {right ? <div className="select-right mono">{right}</div> : null}

        {selected ? (
          <motion.div
            className="select-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        ) : null}

        {selected ? (
          <motion.div
            className="select-pulse"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.0, 0.22, 0.06] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
      </motion.button>
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
              <SelectRow
                key={r.id}
                title={`${r.name}${locked ? "  🔒" : ""}`}
                subtitle={r.id}
                right={`Lv ${r.requiredLevel}+`}
                selected={selected}
                disabled={locked}
                onClick={() => {
                  setSelectedRegionIndex(idx);
                  if (!locked) act(() => Engine.setRegion(content, state, r.id));
                }}
              />
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

    function actionPreview(a: any) {
      // Keep this aligned with Engine's legacy mapping, but only for display.
      if (a.kind === "attack") {
        const take = a.damage ?? 0;
        const tension = 12 + Math.round((a.focusCost ?? 0) * 0.7);
        return `Reel  •  Progress ${take ? "▲".repeat(Math.min(3, Math.ceil(take / 10))) : "-"}  •  Tension +${tension}`;
      }
      const gain = a.focusGain ?? 0;
      const heal = a.heal ?? 0;
      const relief = 10 + Math.round(gain * 0.35) + Math.round(heal * 0.4);
      return gain >= 14 ? `Adjust  •  Tension -${relief}` : `Brace  •  Tension -${relief}`;
    }

    return (
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <div className="label">Commands</div>
          <div className="subtle">↑/↓ selects • Enter executes</div>
        </div>

        <div className="list">
          {fightActions.map((a, idx) => {
            const disabled = lockedByPrompt || state.combat?.phase !== "PLAYER";

            const hint = selectedActionIndex === idx ? disabledReasonForAction(a.id) ?? undefined : undefined;

            const right = actionPreview(a);

            const selected = idx === selectedActionIndex;

            return (
              <SelectRow
                key={a.id}
                title={a.label}
                hint={hint}
                right={right}
                selected={selected}
                disabled={disabled}
                onClick={() => {
                  setSelectedActionIndex(idx);
                  if (!disabled) act(() => Engine.applyAction(content, state, a.id));
                }}
              />
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
          <div className="subtle">↑/↓ selects • Enter uses</div>
        </div>

        {inventoryList.length === 0 ? (
          <div className="subtle">No items.</div>
        ) : (
          <div className="list">
            {inventoryList.map((it, idx) => {
              const selected = idx === selectedItemIndex;
              const reason = disabledReasonForItem(it.id);
              const disabled = !!reason;
              const item = content.items[it.id];
              const integrityRestore = item?.integrityRestore ?? item?.heal ?? it.heal;
              const tensionReduce = item?.tensionReduce ?? 0;
              return (
                <SelectRow
                  key={it.id}
                  title={it.label}
                  subtitle={it.id}
                  right={`x${it.count}  •  Line +${integrityRestore}${tensionReduce ? `  •  Tension -${tensionReduce}` : ""}`}
                  selected={selected}
                  disabled={disabled}
                  hint={selected ? reason ?? undefined : undefined}
                  onClick={() => {
                    setSelectedItemIndex(idx);
                    if (!disabled) act(() => Engine.useItem(content, state, it.id));
                  }}
                />
              );
            })}
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
          <div className="subtle">Placeholder (uses same list as Commands)</div>
        </div>
        <FightPanel />
      </div>
    );
  }

  const enemyFlashKey = state.combat ? `fish_${state.combat.fishStamina}` : "fish_none";
  const hitEnemy = state.lastEvent?.type === "STAMINA";

  return (
    <>
      <div className="ocean-drift" />
      <div className="noise" />

      <div className="frame pad-lg" style={{ position: "relative" }}>
        {/* floats */}
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
                  f.kind === "tension"
                    ? "float--tension"
                    : f.kind === "integrity"
                    ? "float--integrity"
                    : f.kind === "stamina"
                    ? "float--stamina"
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

        {/* header */}
        <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6, minWidth: 280, flex: "1 1 420px" }}>
              <div className="game-title game-title--hero game-title--animated">Tides of the Deep</div>
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

        {/* hud */}
        <div className="grid-2" style={{ marginBottom: 10 }}>
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

              <Progress label="Line Integrity" value={state.player.lineIntegrity} max={state.player.maxLineIntegrity} tone="neon" />
              <Progress label="Tension" value={state.player.tension} max={state.player.maxTension} tone="danger" />
            </div>
          </div>

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
                <span className="label">Fish</span>
              </div>
              <div className="mono subtle">
                {inCombat && enemy ? `${state.combat?.fishPhase ?? ""}` : ""}
              </div>
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

                <Progress
                  label="Stamina"
                  value={state.combat!.fishStamina}
                  max={state.combat!.maxFishStamina}
                  tone="aqua"
                  showNumbers={false}
                />

                <div className="label" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="mono subtle">
                    {state.combat?.fishPhase === "AGGRESSIVE"
                      ? "Surging"
                      : state.combat?.fishPhase === "DEFENSIVE"
                      ? "Digging in"
                      : "Fading"}
                  </span>
                  <span style={{ color: "rgba(255,255,255,.22)" }}>•</span>
                  <span className="mono subtle">Reward {enemy.xp} XP</span>
                </div>
              </div>
            ) : (
              <div className="subtle">No enemy engaged.</div>
            )}
          </div>
        </div>

        {/* content */}
        <div className="panel" style={{ padding: 12 }}>
          <Panel show={tab === "MAIN"}><OverworldPanel /></Panel>
          <Panel show={tab === "FIGHT"}><FightPanel /></Panel>
          <Panel show={tab === "ITEMS"}><ItemsPanel /></Panel>
          <Panel show={tab === "TECHNIQUES"}><TechniquesPanel /></Panel>
        </div>

        <Modal open={defeatPromptOpen} title="Defeated">
          <div className="subtle">Retry the same fish, or flee back to the overworld.</div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="hot" onClick={() => act(() => Engine.retryFight(content, state))}>
              Retry
            </Button>
            <Button variant="soft" onClick={() => act(() => Engine.flee(state))}>
              Flee
            </Button>
          </div>
          <div className="dim mono" style={{ marginTop: 10 }}>
            Enter = Retry • Esc = Flee
          </div>
        </Modal>

        <Modal open={timingOpen} title="Timing">
          <div className="subtle">
            Press <span className="mono">Enter</span> as the marker hits the bright zone.
          </div>

          <div
            className="panel"
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              background: "linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.10))"
            }}
          >
            <div style={{ position: "relative", height: 18, borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,.10)" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.02))"
                }}
              />

              {/* Good zone */}
              <div
                style={{
                  position: "absolute",
                  left: "32%",
                  width: "36%",
                  top: 0,
                  bottom: 0,
                  background: "rgba(120,170,255,.14)"
                }}
              />

              {/* Perfect zone */}
              <div
                style={{
                  position: "absolute",
                  left: "43%",
                  width: "14%",
                  top: 0,
                  bottom: 0,
                  background: "rgba(70,255,230,.18)"
                }}
              />

              {/* Marker */}
              <div
                style={{
                  position: "absolute",
                  top: -2,
                  height: 22,
                  width: 6,
                  borderRadius: 999,
                  left: `calc(${Math.round(timingPos * 1000) / 10}% - 3px)`,
                  background: "rgba(255,255,255,.88)",
                  boxShadow: "0 0 22px rgba(120,190,255,.28)"
                }}
              />
            </div>

            <div className="dim mono" style={{ marginTop: 10 }}>
              Enter = lock in • Esc = cancel
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}

export default CombatMenu;
