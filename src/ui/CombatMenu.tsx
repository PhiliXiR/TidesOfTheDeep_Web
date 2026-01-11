"use client";

import React, { useMemo, useState } from "react";
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

export function CombatMenu({ content, state, onCommit, onSoftToast }: Props) {
  const [tab, setTab] = useState<Tab>("MAIN");
  const [floats, setFloats] = useState<FloatText[]>([]);

  const inCombat = !!state.combat;
  const enemy = state.combat ? content.enemies[state.combat.enemyId] : null;

  const region = content.regions[state.progress.regionId];
  const regionList = useMemo(() => Object.values(content.regions), [content.regions]);

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

  const activeTabIndex = useMemo(
    () => Math.max(0, tabs.findIndex((t) => t.id === tab)),
    [tab]
  );

  function EventLine() {
    const e = state.lastEvent;
    if (!e) return null;

    let text = "";
    if (e.type === "LOG") text = e.text;
    if (e.type === "DAMAGE") text = `${e.who === "enemy" ? "Enemy" : "You"} took ${e.amount} dmg`;
    if (e.type === "HEAL") text = `Recovered ${e.amount}`;
    if (e.type === "XP") text = `+${e.amount} XP`;
    if (e.type === "LEVEL_UP") text = `LEVEL UP → ${e.level}`;
    if (e.type === "SPAWN") text = `Hooked a fish • ${e.regionId}`;
    if (e.type === "DEFEAT_PROMPT") text = "Defeated…";
    if (e.type === "FLEE") text = "Fled.";

    return <div className="dim mono">{text}</div>;
  }

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
          >
            {t.label}
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

  function OverworldPanel() {
    return (
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <div className="label">Select Destination</div>
          <div className="subtle">Choose a region you can access. Then start a fight.</div>
        </div>

        <div className="list">
          {regionList.map((r) => {
            const locked = state.player.level < r.requiredLevel;
            const active = r.id === state.progress.regionId;

            return (
              <motion.button
                key={r.id}
                disabled={locked}
                onClick={() => act(() => Engine.setRegion(content, state, r.id))}
                className={["row", active ? "row--active" : ""].join(" ")}
                initial={false}
                animate={active ? { scale: 1 } : { scale: 1 }}
                whileHover={locked ? undefined : { scale: 1.005 }}
                whileTap={locked ? undefined : { scale: 0.995 }}
              >
                <div className="row-left">
                  <motion.span
                    className="cursor mono"
                    initial={false}
                    animate={{ opacity: active ? 1 : 0, x: active ? 0 : -6 }}
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

  // Enemy micro-juice: shake + ripple on enemy damage
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

        {/* Header */}
        <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4, minWidth: 280 }}>
              <div className="title">Tides of the Deep</div>
              <div className="label">
                Region <span className="mono" style={{ color: "rgba(255,255,255,.72)" }}>{state.progress.regionId}</span>
                {inCombat ? (
                  <>
                    <span style={{ margin: "0 8px", color: "rgba(255,255,255,.22)" }}>•</span>
                    Turn <span className="mono" style={{ color: "rgba(255,255,255,.72)" }}>{state.combat?.turn}</span>
                  </>
                ) : null}
              </div>
              <EventLine />
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <TurnChip />
              <TabsRow />
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

            {/* XP */}
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
            {/* ripple */}
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
        </Modal>
      </div>
    </>
  );
}

export default CombatMenu;
