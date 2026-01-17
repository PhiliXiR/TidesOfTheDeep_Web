"use client";

import React, { useMemo } from "react";
import type { ContentBundle, GameState, Id } from "@/game/types";
import * as Engine from "@/game/engine";
import { AnimatePresence, motion } from "framer-motion";
import CombatMenu from "@/ui/CombatMenu";
import { Card } from "@/ui/components/Card";
import { Button } from "@/ui/components/Button";

type Props = {
  content: ContentBundle;
  state: GameState;
  onCommit: (next: GameState) => Promise<void>;
  onSoftToast?: (text: string) => void;
};

function currency(state: GameState) {
  return typeof state.currency === "number" ? state.currency : 0;
}

function mods(state: GameState): Id[] {
  return Array.isArray(state.temporaryMods) ? state.temporaryMods : [];
}

export function MetaLoopMenu({ content, state, onCommit, onSoftToast }: Props) {
  const inCombat = !!state.combat;
  const contract = state.contract;

  const contracts = useMemo(() => {
    const all = Object.values(content.contracts ?? {});
    all.sort((a, b) => a.label.localeCompare(b.label));
    return all;
  }, [content.contracts]);

  async function safeCommit(next: GameState) {
    try {
      await onCommit(next);
    } catch (e: any) {
      onSoftToast?.(e?.message ?? "Commit failed");
    }
  }

  if (inCombat) {
    return <CombatMenu content={content} state={state} onCommit={safeCommit} onSoftToast={onSoftToast} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mono subtle">Currency: {currency(state)}</div>
        {mods(state).length ? (
          <div className="mono subtle">Mods: {mods(state).length}</div>
        ) : (
          <div className="mono subtle">Mods: 0</div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!contract ? (
          <motion.div
            key="board"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <ContractsBoard content={content} state={state} contracts={contracts} onStart={(id) => safeCommit(Engine.startContract(content, state, id))} />
          </motion.div>
        ) : contract.phase === "CAMP" ? (
          <motion.div
            key="camp"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <CampScreen
              content={content}
              state={state}
              onBuy={(shopId, stockId) => safeCommit(Engine.buyFromShop(content, state, shopId, stockId))}
              onContinue={() => safeCommit(Engine.continueContract(content, state))}
              onAbort={() => safeCommit(Engine.endContract(state))}
            />
          </motion.div>
        ) : contract.phase === "SUMMARY" ? (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <SummaryScreen content={content} state={state} onBack={() => safeCommit(Engine.endContract(state))} />
          </motion.div>
        ) : (
          <motion.div
            key="postfight"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <PostFightScreen content={content} state={state} onAdvance={() => safeCommit(Engine.advanceContractAfterFight(content, state))} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ContractsBoard({
  content,
  state,
  contracts,
  onStart
}: {
  content: ContentBundle;
  state: GameState;
  contracts: NonNullable<ContentBundle["contracts"]>[string][];
  onStart: (contractId: Id) => void;
}) {
  if (!contracts.length) {
    return (
      <Card className="p-5">
        <div className="text-white/80">No contracts are defined in your content bundle yet.</div>
        <div className="mt-2 text-sm text-white/60">Add `contracts`, `shops`, and optional `rigMods` in Creator Mode.</div>
      </Card>
    );
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card className="p-5">
        <div className="text-xl font-extrabold tracking-tight">Contracts</div>
        <div className="mt-1 text-sm text-white/70">Pick a contract: 2–5 fights pulled from a region pool (duplicates allowed).</div>
      </Card>

      {contracts.map((c) => {
        const region = content.regions?.[c.regionId];
        const locked = !!region && state.player.level < region.requiredLevel;

        return (
          <Card key={c.id} className="p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <div className="text-lg font-bold">{c.label}</div>
                <div className="text-sm text-white/70">
                  {region ? `${region.name} • Lv ${region.requiredLevel}+` : `Region: ${c.regionId}`}
                </div>
                {c.description ? <div className="mt-2 text-sm text-white/65">{c.description}</div> : null}
              </div>
              <div className="ml-auto">
                <Button variant={locked ? "soft" : "hot"} disabled={locked} onClick={() => onStart(c.id)}>
                  {locked ? "Locked" : "Start"}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function PostFightScreen({ content, state, onAdvance }: { content: ContentBundle; state: GameState; onAdvance: () => void }) {
  const c = state.contract;
  if (!c) return null;

  const def = content.contracts?.[c.contractId];
  const label = def?.label ?? c.contractId;

  const idx = c.index + 1;
  const total = c.encounters.length;

  return (
    <Card className="p-5">
      <div className="text-lg font-bold">{label}</div>
      <div className="text-sm text-white/70">Encounter {idx}/{total} cleared.</div>
      {c.lastReward?.currency ? (
        <div className="mt-2 text-sm text-white/80">Reward: +{c.lastReward.currency} currency</div>
      ) : (
        <div className="mt-2 text-sm text-white/60">No reward this step.</div>
      )}
      <div className="mt-4 flex gap-2 flex-wrap">
        <Button variant="hot" onClick={onAdvance}>Continue</Button>
      </div>
    </Card>
  );
}

function CampScreen({
  content,
  state,
  onBuy,
  onContinue,
  onAbort
}: {
  content: ContentBundle;
  state: GameState;
  onBuy: (shopId: Id, stockId: Id) => void;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const c = state.contract;
  if (!c) return null;

  const def = content.contracts?.[c.contractId];
  const label = def?.label ?? c.contractId;

  const shopId = def?.camp?.shopId ?? content.economy?.defaultShopId;
  const shop = shopId ? content.shops?.[shopId] : null;

  const installed = mods(state);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card className="p-5">
        <div className="text-lg font-bold">Camp</div>
        <div className="text-sm text-white/70">{label} • Prepare for the next fight.</div>
        <div className="mt-2 text-sm text-white/75">Currency: {currency(state)}</div>
        <div className="mt-1 text-sm text-white/60">Perfects so far: {c.stats.perfectCount}</div>
      </Card>

      <Card className="p-5">
        <div className="text-base font-bold">Rig Mods</div>
        {installed.length ? (
          <div className="mt-2 grid" style={{ gap: 6 }}>
            {installed.map((id) => {
              const m = content.rigMods?.[id];
              return (
                <div key={id} className="text-sm text-white/80">
                  • {m?.label ?? id}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-2 text-sm text-white/60">None installed.</div>
        )}
      </Card>

      <Card className="p-5">
        <div className="text-base font-bold">Shop</div>
        {!shop ? (
          <div className="mt-2 text-sm text-white/60">No shop configured for this camp.</div>
        ) : (
          <div className="mt-3 grid" style={{ gap: 10 }}>
            <div className="text-sm text-white/70">{shop.label}</div>
            {(shop.stock ?? []).map((s) => {
              const price = s.price;
              const canAfford = currency(state) >= price;
              const title =
                s.kind === "ITEM"
                  ? content.items?.[s.itemId]?.label ?? s.itemId
                  : content.rigMods?.[s.modId]?.label ?? s.modId;
              const extra = s.kind === "ITEM" ? `x${s.amount ?? 1}` : "";

              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-sm text-white/85">{title} {extra}</div>
                    <div className="mono subtle">Price: {price}</div>
                  </div>
                  <div className="ml-auto">
                    <Button
                      variant={canAfford ? "hot" : "soft"}
                      disabled={!canAfford}
                      onClick={() => onBuy(shop.id, s.id)}
                    >
                      Buy
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="flex gap-2 flex-wrap">
        <Button variant="hot" onClick={onContinue}>Next Fight</Button>
        <Button variant="soft" onClick={onAbort}>Abort Contract</Button>
      </div>
    </div>
  );
}

function SummaryScreen({ content, state, onBack }: { content: ContentBundle; state: GameState; onBack: () => void }) {
  const c = state.contract;
  if (!c) return null;

  const def = content.contracts?.[c.contractId];
  const label = def?.label ?? c.contractId;

  return (
    <Card className="p-5">
      <div className="text-lg font-bold">Contract Summary</div>
      <div className="text-sm text-white/70">{label}</div>

      <div className="mt-3 grid" style={{ gap: 6 }}>
        <div className="text-sm text-white/80">Fights won: {c.stats.fightsWon}/{c.encounters.length}</div>
        <div className="text-sm text-white/80">Perfect timings: {c.stats.perfectCount}</div>
        <div className="text-sm text-white/80">Contract earnings: {c.earned.currency} currency</div>
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <Button variant="hot" onClick={onBack}>Back to Board</Button>
      </div>
    </Card>
  );
}

export default MetaLoopMenu;
