"use client";

import { ContentBundle, GameState, Id } from "@/game/types";
import * as Engine from "@/game/engine";
import { useMemo, useState } from "react";

type Props = {
  content: ContentBundle;
  state: GameState;
  onCommit: (next: GameState) => Promise<void>;
  onSoftToast?: (text: string) => void;
};

type Tab = "MAIN" | "FIGHT" | "ITEMS" | "TECHNIQUES";

export default function CombatMenu({ content, state, onCommit, onSoftToast }: Props) {
  const [tab, setTab] = useState<Tab>("MAIN");

  const node = content.levelGraph?.[state.progress.nodeId];
  const inCombat = !!state.combat;
  const enemy = state.combat ? content.enemies[state.combat.enemyId] : null;
  const encounter = state.combat ? content.encounters[state.combat.encounterId] : null;

  const fightActions = useMemo(() => {
    if (!encounter) return [];
    return encounter.fightActions.map((id) => content.actions[id]).filter(Boolean);
  }, [encounter, content.actions]);

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

  async function commit(next: GameState) {
    await onCommit(next);
  }

  async function safeAction(fn: () => GameState) {
    try {
      await commit(fn());
    } catch (e: any) {
      onSoftToast?.(e?.message ?? "Commit failed");
    }
  }

  // Panels / “WidgetSwitcher style”
  function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
    return (
      <div
        style={{
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0px)" : "translateY(8px)",
          pointerEvents: show ? "auto" : "none",
          transition: "opacity 140ms ease, transform 140ms ease",
          position: show ? "relative" : "absolute",
          inset: show ? "auto" : 0
        }}
      >
        {children}
      </div>
    );
  }

  const card: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(120,160,255,0.22)",
    background: "linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.15))",
    boxShadow: "0 10px 30px rgba(0,0,0,0.45)"
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(120,160,255,0.22)",
    background: "rgba(0,0,0,0.35)",
    color: "#eaf0ff",
    cursor: "pointer",
    userSelect: "none"
  };

  const btnHot: React.CSSProperties = {
    ...btn,
    background: "linear-gradient(90deg, rgba(70,110,255,0.35), rgba(0,0,0,0.35))",
    border: "1px solid rgba(120,160,255,0.35)"
  };

  function Bar({ label, value, max }: { label: string; value: number; max: number }) {
    const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.9 }}>
          <span>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {value}/{max}
          </span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "rgba(120,160,255,0.55)" }} />
        </div>
      </div>
    );
  }

  function Tabs() {
    const tabs: { id: Tab; label: string; enabled?: boolean }[] = [
      { id: "MAIN", label: "Main", enabled: true },
      { id: "FIGHT", label: "Fight", enabled: inCombat },
      { id: "ITEMS", label: "Items", enabled: true },
      { id: "TECHNIQUES", label: "Techniques", enabled: inCombat }
    ];

    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const enabled = t.enabled !== false;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => enabled && setTab(t.id)}
              style={{
                ...btn,
                opacity: enabled ? 1 : 0.35,
                background: active ? "rgba(120,160,255,0.22)" : "rgba(0,0,0,0.35)"
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }

  function LastEventLine() {
    const e = state.lastEvent;
    if (!e) return null;

    let text = "";
    if (e.type === "LOG") text = e.text;
    if (e.type === "DAMAGE") text = `${e.who === "enemy" ? "Enemy" : "You"} took ${e.amount} dmg`;
    if (e.type === "HEAL") text = `${e.who === "player" ? "You" : "Enemy"} healed ${e.amount}`;
    if (e.type === "WIN") text = "Victory!";
    if (e.type === "LOSE") text = "Defeat...";
    if (e.type === "NODE") text = `Entered node: ${e.nodeId}`;

    return (
      <div style={{ marginTop: 10, opacity: 0.85 }}>
        <span style={{ opacity: 0.65 }}>Event:</span> {text}
      </div>
    );
  }

  function ScreenTitle() {
    const nType = node?.type ?? "unknown";
    let title = "Menu RPG";
    if (nType === "intro") title = "Intro";
    if (nType === "encounter") title = "Encounter";
    if (nType === "victory") title = "Victory";
    if (nType === "defeat") title = "Defeat";
    return (
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.2 }}>{title}</div>
          <div style={{ opacity: 0.7, marginTop: 2 }}>
            Node: <span style={{ fontFamily: "ui-monospace, monospace" }}>{state.progress.nodeId}</span>
            {inCombat ? (
              <>
                {" "}• Turn{" "}
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{state.combat?.turn}</span>
              </>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={btn} onClick={() => safeAction(() => Engine.restartRun(content))}>Restart Run</button>
          <button style={{ ...btn, opacity: inCombat ? 1 : 0.35 }} disabled={!inCombat} onClick={() => inCombat && safeAction(() => Engine.restartEncounter(content, state))}>
            Restart Encounter
          </button>
          <button style={btn} onClick={() => safeAction(() => Engine.enterNode(content, { ...state }, "start"))}>
            Jump to Start
          </button>
        </div>
      </div>
    );
  }

  // MAIN panel logic
  function MainPanel() {
    const nType = node?.type;
    const canContinue = !!node?.next;

    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ opacity: 0.9 }}>
          This is your “hub” panel. You’ll keep this as your **Main** menu in every encounter.
        </div>

        {nType === "intro" && (
          <button style={btnHot} onClick={() => safeAction(() => Engine.continueFromNode(content, state))}>
            Continue
          </button>
        )}

        {nType === "victory" && (
          <button style={btnHot} onClick={() => safeAction(() => Engine.restartRun(content))}>
            Start New Run
          </button>
        )}

        {nType === "defeat" && (
          <div style={{ display: "grid", gap: 10 }}>
            <button style={btnHot} onClick={() => safeAction(() => Engine.restartRun(content))}>Restart Run</button>
            <button style={btn} onClick={() => safeAction(() => Engine.enterNode(content, { ...state, player: { ...state.player, hp: state.player.maxHp, focus: state.player.maxFocus } }, "start"))}>
              Heal & Jump Start (dev)
            </button>
          </div>
        )}

        {nType !== "intro" && canContinue && (
          <button style={btnHot} onClick={() => safeAction(() => Engine.continueFromNode(content, state))}>
            Continue
          </button>
        )}

        {!canContinue && nType === "intro" && (
          <div style={{ opacity: 0.7 }}>No next node configured for this intro.</div>
        )}

        {!inCombat && node?.type === "encounter" && (
          <button style={btnHot} onClick={() => safeAction(() => Engine.enterNode(content, state, state.progress.nodeId))}>
            Enter Encounter
          </button>
        )}
      </div>
    );
  }

  function FightPanel() {
    if (!inCombat || !enemy) {
      return <div style={{ opacity: 0.7 }}>No combat right now.</div>;
    }

    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ opacity: 0.9 }}>
          Choose an action. (Generated from encounter JSON)
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {fightActions.map((a) => {
            const cost = a.focusCost ?? 0;
            const disabled = state.combat?.phase !== "PLAYER" || state.player.focus < cost;
            const subtitle =
              a.kind === "attack"
                ? `DMG ${a.damage ?? 0}${cost ? ` • Focus -${cost}` : ""}`
                : `Heal ${a.heal ?? 0} • Focus +${a.focusGain ?? 0}${cost ? ` • Cost ${cost}` : ""}`;

            return (
              <button
                key={a.id}
                disabled={disabled}
                onClick={() => safeAction(() => Engine.applyAction(content, state, a.id))}
                style={{
                  ...btnHot,
                  opacity: disabled ? 0.35 : 1,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10
                }}
              >
                <span style={{ fontWeight: 650 }}>{a.label}</span>
                <span style={{ opacity: 0.75, fontFamily: "ui-monospace, monospace" }}>{subtitle}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function ItemsPanel() {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ opacity: 0.9 }}>
          Items are usable anytime (and enemy responds if you’re in combat).
        </div>

        {inventoryList.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No items.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {inventoryList.map((it) => (
              <button
                key={it.id}
                onClick={() => safeAction(() => Engine.useItem(content, state, it.id))}
                style={{ ...btn, display: "flex", justifyContent: "space-between", gap: 10 }}
              >
                <span style={{ fontWeight: 650 }}>{it.label}</span>
                <span style={{ opacity: 0.75, fontFamily: "ui-monospace, monospace" }}>
                  x{it.count} • Heal {it.heal}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function TechniquesPanel() {
    if (!inCombat) return <div style={{ opacity: 0.7 }}>No combat right now.</div>;
    // For now: mirror fight actions, later you’ll separate “techniques” from “fight”
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ opacity: 0.9 }}>Techniques (placeholder: mirrors Fight for now)</div>
        <FightPanel />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card, padding: 16 }}>
        <ScreenTitle />
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <Bar label="Player HP" value={state.player.hp} max={state.player.maxHp} />
          <Bar label="Player Focus" value={state.player.focus} max={state.player.maxFocus} />
          {inCombat && enemy ? (
            <Bar label={`${enemy.name} HP`} value={state.combat!.enemyHp} max={enemy.maxHp} />
          ) : null}
          <LastEventLine />
        </div>
      </div>

      <div style={{ ...card, padding: 16 }}>
        <Tabs />

        <div style={{ marginTop: 14, position: "relative", minHeight: 220 }}>
          <Panel show={tab === "MAIN"}><MainPanel /></Panel>
          <Panel show={tab === "FIGHT"}><FightPanel /></Panel>
          <Panel show={tab === "ITEMS"}><ItemsPanel /></Panel>
          <Panel show={tab === "TECHNIQUES"}><TechniquesPanel /></Panel>
        </div>
      </div>
    </div>
  );
}
