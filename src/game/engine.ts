import { ContentBundle, GameState, Id } from "./types";

export function normalizeState(content: ContentBundle, s: any): GameState {
  // Migration support: if you load an old run that used nodeId/combat.encounterId, etc.
  // we coerce it into the new JRPG loop state.
  const regionId = s?.progress?.regionId ?? firstRegionId(content) ?? "shore_1";

  const level = typeof s?.player?.level === "number" ? s.player.level : 1;
  const xp = typeof s?.player?.xp === "number" ? s.player.xp : 0;
  const xpToNext = typeof s?.player?.xpToNext === "number" ? s.player.xpToNext : xpForLevel(content, level);

  const maxHp = typeof s?.player?.maxHp === "number" ? s.player.maxHp : 80;
  const hp = clampNumber(s?.player?.hp, 0, maxHp, maxHp);

  const maxFocus = typeof s?.player?.maxFocus === "number" ? s.player.maxFocus : 40;
  const focus = clampNumber(s?.player?.focus, 0, maxFocus, maxFocus);

  const knownActions: Id[] = Array.isArray(s?.player?.knownActions)
    ? s.player.knownActions
    : content.loadout?.startActions ?? ["strike", "hookset", "breathe"];

  const inventory: Record<Id, number> =
    s?.player?.inventory && typeof s.player.inventory === "object"
      ? s.player.inventory
      : content.loadout?.startItems ?? { small_potion: 2 };

  const combat = s?.combat && typeof s.combat === "object"
    ? {
        enemyId: s.combat.enemyId as Id,
        enemyHp: s.combat.enemyHp as number,
        phase: (s.combat.phase as any) ?? "PLAYER",
        turn: (s.combat.turn as number) ?? 1,
        lastSpawn: s.combat.lastSpawn ?? undefined,
        outcome: s.combat.outcome ?? "NONE"
      }
    : undefined;

  return {
    progress: { regionId },
    player: { level, xp, xpToNext, hp, maxHp, focus, maxFocus, knownActions, inventory },
    combat,
    lastEvent: s?.lastEvent
  };
}

export function makeNewRunState(content: ContentBundle): GameState {
  const regionId = firstRegionId(content) ?? "shore_1";
  const knownActions = content.loadout?.startActions ?? ["strike", "hookset", "breathe"];
  const inventory = content.loadout?.startItems ?? { small_potion: 2 };

  const level = 1;

  return {
    progress: { regionId },
    player: {
      level,
      xp: 0,
      xpToNext: xpForLevel(content, level),
      hp: 80,
      maxHp: 80,
      focus: 40,
      maxFocus: 40,
      knownActions,
      inventory
    },
    combat: undefined,
    lastEvent: { type: "LOG", text: "New run started." }
  };
}

export function setRegion(content: ContentBundle, state: GameState, regionId: Id): GameState {
  const r = content.regions[regionId];
  if (!r) return { ...state, lastEvent: { type: "LOG", text: `Missing region: ${regionId}` } };

  if (state.player.level < r.requiredLevel) {
    return {
      ...state,
      lastEvent: { type: "LOG", text: `Locked. Requires level ${r.requiredLevel}.` }
    };
  }

  return {
    ...state,
    progress: { regionId },
    lastEvent: { type: "LOG", text: `Travelled to ${r.name}.` }
  };
}

export function startFight(content: ContentBundle, state: GameState): GameState {
  const regionId = state.progress.regionId;
  const r = content.regions[regionId];
  if (!r) return { ...state, lastEvent: { type: "LOG", text: `Missing region: ${regionId}` } };

  if (state.player.level < r.requiredLevel) {
    return { ...state, lastEvent: { type: "LOG", text: `Region locked: level ${r.requiredLevel}+` } };
  }

  const enemyId = pickWeighted(r.encounterPool);
  const enemy = content.enemies[enemyId];
  if (!enemy) return { ...state, lastEvent: { type: "LOG", text: `Missing enemy: ${enemyId}` } };

  return {
    ...state,
    combat: {
      enemyId,
      enemyHp: enemy.maxHp,
      phase: "PLAYER",
      turn: 1,
      lastSpawn: { regionId, enemyId },
      outcome: "NONE"
    },
    lastEvent: { type: "SPAWN", regionId, enemyId }
  };
}

export function retryFight(content: ContentBundle, state: GameState): GameState {
  const spawn = state.combat?.lastSpawn;
  if (!spawn) return { ...state, lastEvent: { type: "LOG", text: "No spawn to retry." } };

  const enemy = content.enemies[spawn.enemyId];
  if (!enemy) return { ...state, lastEvent: { type: "LOG", text: `Missing enemy: ${spawn.enemyId}` } };

  // Retry = same enemy, reset enemy HP, restore player to a fair “retry” baseline
  // (adjust this later: could restore some hp/focus or none)
  return {
    ...state,
    player: {
      ...state.player,
      hp: Math.max(1, Math.min(state.player.hp, state.player.maxHp)), // ensure alive
      focus: clamp(state.player.focus, 0, state.player.maxFocus)
    },
    combat: {
      enemyId: spawn.enemyId,
      enemyHp: enemy.maxHp,
      phase: "PLAYER",
      turn: 1,
      lastSpawn: spawn,
      outcome: "NONE"
    },
    lastEvent: { type: "LOG", text: "Retry!" }
  };
}

export function flee(state: GameState): GameState {
  return {
    ...state,
    combat: undefined,
    lastEvent: { type: "FLEE" }
  };
}

export function applyAction(content: ContentBundle, state: GameState, actionId: Id): GameState {
  if (!state.combat) return { ...state, lastEvent: { type: "LOG", text: "No combat active." } };
  if (state.combat.outcome === "DEFEAT_PROMPT") return state; // waiting on retry/flee
  if (state.combat.phase !== "PLAYER") return state;

  const action = content.actions[actionId];
  if (!action) return { ...state, lastEvent: { type: "LOG", text: `Missing action: ${actionId}` } };

  const focusCost = action.focusCost ?? 0;
  if (state.player.focus < focusCost) {
    return { ...state, lastEvent: { type: "LOG", text: "Not enough Focus." } };
  }

  let next: GameState = {
    ...state,
    player: { ...state.player, focus: clamp(state.player.focus - focusCost, 0, state.player.maxFocus) }
  };

  if (action.kind === "attack") {
    const dmg = action.damage ?? 0;
    next = {
      ...next,
      combat: { ...next.combat!, enemyHp: Math.max(0, next.combat!.enemyHp - dmg) },
      lastEvent: { type: "DAMAGE", who: "enemy", amount: dmg }
    };
  } else {
    const heal = action.heal ?? 0;
    const focusGain = action.focusGain ?? 0;
    next = {
      ...next,
      player: {
        ...next.player,
        hp: clamp(next.player.hp + heal, 0, next.player.maxHp),
        focus: clamp(next.player.focus + focusGain, 0, next.player.maxFocus)
      },
      lastEvent: heal > 0 ? { type: "HEAL", who: "player", amount: heal } : { type: "LOG", text: "Focused." }
    };
  }

  // Win check
  if (next.combat!.enemyHp <= 0) return resolveWin(content, next);

  // Enemy response
  return enemyTurn(content, { ...next, combat: { ...next.combat!, phase: "ENEMY" } });
}

export function useItem(content: ContentBundle, state: GameState, itemId: Id): GameState {
  const count = state.player.inventory[itemId] ?? 0;
  if (count <= 0) return { ...state, lastEvent: { type: "LOG", text: "No item left." } };

  const item = content.items[itemId];
  if (!item) return { ...state, lastEvent: { type: "LOG", text: `Missing item: ${itemId}` } };

  let next: GameState = {
    ...state,
    player: {
      ...state.player,
      hp: clamp(state.player.hp + item.heal, 0, state.player.maxHp),
      inventory: { ...state.player.inventory, [itemId]: count - 1 }
    },
    lastEvent: item.heal > 0 ? { type: "HEAL", who: "player", amount: item.heal } : { type: "LOG", text: "Used item." }
  };

  // Enemy reacts after item if in combat and not in defeat prompt
  if (next.combat?.phase === "PLAYER" && next.combat?.outcome !== "DEFEAT_PROMPT") {
    next = enemyTurn(content, { ...next, combat: { ...next.combat, phase: "ENEMY" } });
  }

  return next;
}

function enemyTurn(content: ContentBundle, state: GameState): GameState {
  if (!state.combat) return state;

  const enemy = content.enemies[state.combat.enemyId];
  const dmg = enemy.attack;

  const hp = Math.max(0, state.player.hp - dmg);
  const next: GameState = {
    ...state,
    player: { ...state.player, hp },
    combat: { ...state.combat, phase: "PLAYER", turn: state.combat.turn + 1 },
    lastEvent: { type: "DAMAGE", who: "player", amount: dmg }
  };

  if (hp <= 0) return resolveLose(next);
  return next;
}

function resolveWin(content: ContentBundle, state: GameState): GameState {
  const enemy = content.enemies[state.combat!.enemyId];
  const gained = enemy?.xp ?? 0;

  let next = grantXp(content, {
    ...state,
    combat: undefined,
    lastEvent: { type: "XP", amount: gained }
  }, gained);

  // small heal/focus refresh after battle (tune later or remove)
  next = {
    ...next,
    player: {
      ...next.player,
      hp: clamp(next.player.hp + 6, 0, next.player.maxHp),
      focus: clamp(next.player.focus + 6, 0, next.player.maxFocus)
    }
  };

  return next;
}

function resolveLose(state: GameState): GameState {
  // Retry prompt: keep combat info, mark outcome.
  return {
    ...state,
    combat: state.combat
      ? { ...state.combat, outcome: "DEFEAT_PROMPT" }
      : undefined,
    lastEvent: { type: "DEFEAT_PROMPT" }
  };
}

function grantXp(content: ContentBundle, state: GameState, amount: number): GameState {
  let xp = state.player.xp + amount;
  let level = state.player.level;
  let xpToNext = state.player.xpToNext;

  // level up loop
  while (xp >= xpToNext) {
    xp -= xpToNext;
    level += 1;
    xpToNext = xpForLevel(content, level);

    // small stat growth (tune later)
    const maxHp = state.player.maxHp + 6;
    const maxFocus = state.player.maxFocus + 2;

    state = {
      ...state,
      player: {
        ...state.player,
        level,
        maxHp,
        maxFocus,
        hp: maxHp,       // full heal on level up (JRPG dopamine)
        focus: maxFocus,
        xp,
        xpToNext
      },
      lastEvent: { type: "LEVEL_UP", level }
    };
  }

  // if no level-ups occurred, still update xp
  return {
    ...state,
    player: { ...state.player, xp, xpToNext }
  };
}

function xpForLevel(content: ContentBundle, level: number) {
  const base = content.xpCurve?.base ?? 40;
  const growth = content.xpCurve?.growth ?? 1.22;
  return Math.max(10, Math.floor(base * Math.pow(growth, Math.max(0, level - 1))));
}

function firstRegionId(content: ContentBundle): Id | null {
  const keys = Object.keys(content.regions ?? {});
  return keys.length ? keys[0] : null;
}

function pickWeighted(entries: { enemyId: Id; weight: number }[]): Id {
  const total = entries.reduce((a, e) => a + Math.max(0, e.weight), 0);
  if (total <= 0) return entries[0]?.enemyId ?? "scrapjaw";
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= Math.max(0, e.weight);
    if (roll <= 0) return e.enemyId;
  }
  return entries[entries.length - 1]?.enemyId ?? "scrapjaw";
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function clampNumber(v: any, min: number, max: number, fallback: number) {
  if (typeof v !== "number" || Number.isNaN(v)) return fallback;
  return clamp(v, min, max);
}
