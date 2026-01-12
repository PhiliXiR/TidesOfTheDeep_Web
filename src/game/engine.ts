import { ContentBundle, FishPhase, GameState, Id, TimingGrade } from "./types";

export function normalizeState(content: ContentBundle, s: any): GameState {
  // Migration support: if you load an old run that used nodeId/combat.encounterId, etc.
  // we coerce it into the fishing combat loop state.
  const regionId = s?.progress?.regionId ?? firstRegionId(content) ?? "shore_1";

  const level = typeof s?.player?.level === "number" ? s.player.level : 1;
  const xp = typeof s?.player?.xp === "number" ? s.player.xp : 0;
  const xpToNext = typeof s?.player?.xpToNext === "number" ? s.player.xpToNext : xpForLevel(content, level);

  const maxTension = typeof s?.player?.maxTension === "number" ? s.player.maxTension : 100;
  // Legacy mapping: old state.player.focus becomes a rough starting tension.
  const tensionFromLegacy = typeof s?.player?.focus === "number" ? Math.round((s.player.focus / 40) * 35) : undefined;
  const tension = clampNumber(s?.player?.tension ?? tensionFromLegacy, 0, maxTension, 12);

  const maxLineIntegrity = typeof s?.player?.maxLineIntegrity === "number" ? s.player.maxLineIntegrity : 100;
  // Legacy mapping: old state.player.hp becomes line integrity.
  const integrityFromLegacy = typeof s?.player?.hp === "number" ? Math.round((s.player.hp / Math.max(1, s.player.maxHp ?? 80)) * maxLineIntegrity) : undefined;
  const lineIntegrity = clampNumber(s?.player?.lineIntegrity ?? integrityFromLegacy, 0, maxLineIntegrity, maxLineIntegrity);

  const knownActions: Id[] = Array.isArray(s?.player?.knownActions)
    ? s.player.knownActions
    : content.loadout?.startActions ?? ["strike", "hookset", "breathe"];

  const inventory: Record<Id, number> =
    s?.player?.inventory && typeof s.player.inventory === "object"
      ? s.player.inventory
      : content.loadout?.startItems ?? { small_potion: 2 };

  const combat = s?.combat && typeof s.combat === "object"
    ? (() => {
        const enemyId = s.combat.enemyId as Id;
        const fish = getFish(content, enemyId);

        const maxFishStamina =
          typeof s.combat.maxFishStamina === "number"
            ? s.combat.maxFishStamina
            : fish.maxStamina;

        const fishStaminaLegacy = typeof s.combat.enemyHp === "number" ? s.combat.enemyHp : undefined;
        const fishStamina = clampNumber(s.combat.fishStamina ?? fishStaminaLegacy, 0, maxFishStamina, maxFishStamina);

        const fishPhase = (s.combat.fishPhase as FishPhase) ?? phaseForStamina(fishStamina, maxFishStamina);

        return {
          enemyId,
          fishStamina,
          maxFishStamina,
          fishPhase,
          phase: (s.combat.phase as any) === "ENEMY" ? "FISH" : ((s.combat.phase as any) ?? "PLAYER"),
          turn: (s.combat.turn as number) ?? 1,
          brace: typeof s.combat.brace === "number" ? s.combat.brace : 0,
          control: typeof s.combat.control === "number" ? s.combat.control : 0,
          lastSpawn: s.combat.lastSpawn ?? undefined,
          outcome: s.combat.outcome ?? "NONE"
        } as GameState["combat"];
      })()
    : undefined;

  return {
    progress: { regionId },
    player: { level, xp, xpToNext, tension, maxTension, lineIntegrity, maxLineIntegrity, knownActions, inventory },
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
      tension: 10,
      maxTension: 100,
      lineIntegrity: 100,
      maxLineIntegrity: 100,
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
  const fish = getFish(content, enemyId);
  if (!fish) return { ...state, lastEvent: { type: "LOG", text: `Missing enemy: ${enemyId}` } };

  const maxFishStamina = fish.maxStamina;
  const fishPhase = phaseForStamina(maxFishStamina, maxFishStamina);

  return {
    ...state,
    combat: {
      enemyId,
      fishStamina: maxFishStamina,
      maxFishStamina,
      fishPhase,
      phase: "PLAYER",
      turn: 1,
      brace: 0,
      control: 0,
      lastSpawn: { regionId, enemyId },
      outcome: "NONE"
    },
    lastEvent: { type: "SPAWN", regionId, enemyId }
  };
}

export function retryFight(content: ContentBundle, state: GameState): GameState {
  const spawn = state.combat?.lastSpawn;
  if (!spawn) return { ...state, lastEvent: { type: "LOG", text: "No spawn to retry." } };

  const fish = getFish(content, spawn.enemyId);
  if (!fish) return { ...state, lastEvent: { type: "LOG", text: `Missing enemy: ${spawn.enemyId}` } };

  // Retry = same fish, reset stamina; restore line integrity so the player can re-attempt.
  return {
    ...state,
    player: {
      ...state.player,
      tension: clamp(state.player.tension, 0, state.player.maxTension),
      lineIntegrity: state.player.maxLineIntegrity
    },
    combat: {
      enemyId: spawn.enemyId,
      fishStamina: fish.maxStamina,
      maxFishStamina: fish.maxStamina,
      fishPhase: phaseForStamina(fish.maxStamina, fish.maxStamina),
      phase: "PLAYER",
      turn: 1,
      brace: 0,
      control: 0,
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
    player: { ...state.player, tension: 0 },
    lastEvent: { type: "FLEE" }
  };
}

export function applyAction(content: ContentBundle, state: GameState, actionId: Id, timing?: TimingGrade): GameState {
  if (!state.combat) return { ...state, lastEvent: { type: "LOG", text: "No combat active." } };
  if (state.combat.outcome === "DEFEAT_PROMPT") return state; // waiting on retry/flee
  if (state.combat.phase !== "PLAYER") return state;

  const action = content.actions[actionId];
  if (!action) return { ...state, lastEvent: { type: "LOG", text: `Missing action: ${actionId}` } };

  const intent = interpretAction(action);
  const fish = getFish(content, state.combat.enemyId);

  const { reelEffMult } = phaseTuning(state.combat.fishPhase);

  let staminaMult = 1;
  let tensionBonus = 0;
  let tensionRelief = 0;

  if (timing) {
    // Timing is an amplifier, not a replacement for stats.
    if (timing === "MISS") {
      staminaMult = 0.15;
      tensionBonus += 14;
    } else if (timing === "GOOD") {
      staminaMult = 1.0;
    } else if (timing === "PERFECT") {
      staminaMult = 1.35;
      tensionRelief += 6;
    }
  }

  let next: GameState = { ...state };

  // Apply player action effects
  if (intent.kind === "reel" || intent.kind === "technique") {
    const baseStamina = Math.max(0, intent.staminaTake);
    const take = Math.round(baseStamina * reelEffMult * staminaMult);

    next = {
      ...next,
      combat: {
        ...next.combat!,
        fishStamina: Math.max(0, next.combat!.fishStamina - take)
      },
      lastEvent: { type: "STAMINA", delta: -take, phase: next.combat!.fishPhase, reason: intent.label }
    };

    // Reeling always raises tension a bit, especially with heavier actions.
    next = applyTension(next, intent.tension + tensionBonus - tensionRelief, "Reel");
  } else if (intent.kind === "brace") {
    // Brace: reduce current tension and reduce incoming pressure.
    next = applyTension(next, -intent.tension, "Brace");
    next = {
      ...next,
      combat: { ...next.combat!, brace: clamp(next.combat!.brace + intent.brace, 0, 40) },
      lastEvent: { type: "LOG", text: "You brace and steady the line." }
    };
  } else if (intent.kind === "adjust") {
    // Adjust: a small immediate relief plus a persistent control bonus.
    next = applyTension(next, -intent.tension, "Adjust" );
    next = {
      ...next,
      combat: { ...next.combat!, control: clamp(next.combat!.control + intent.control, 0, 40) },
      lastEvent: { type: "LOG", text: "You adjust your angle and regain control." }
    };
  }

  // Update fish phase after stamina changes
  if (next.combat) {
    const newPhase = phaseForStamina(next.combat.fishStamina, next.combat.maxFishStamina);
    if (newPhase !== next.combat.fishPhase) {
      next = { ...next, combat: { ...next.combat, fishPhase: newPhase }, lastEvent: { type: "PHASE", phase: newPhase } };
    } else {
      next = { ...next, combat: { ...next.combat, fishPhase: newPhase } };
    }
  }

  // Win check
  if (next.combat && next.combat.fishStamina <= 0) return resolveWin(content, fish, next);

  // Fish response
  return fishTurn(content, fish, { ...next, combat: { ...next.combat!, phase: "FISH" } });
}

export function useItem(content: ContentBundle, state: GameState, itemId: Id): GameState {
  const count = state.player.inventory[itemId] ?? 0;
  if (count <= 0) return { ...state, lastEvent: { type: "LOG", text: "No item left." } };

  const item = content.items[itemId];
  if (!item) return { ...state, lastEvent: { type: "LOG", text: `Missing item: ${itemId}` } };

  const integrityRestore = item.integrityRestore ?? item.heal ?? 0;
  const tensionReduce = item.tensionReduce ?? 0;

  let next: GameState = {
    ...state,
    player: {
      ...state.player,
      lineIntegrity: clamp(state.player.lineIntegrity + integrityRestore, 0, state.player.maxLineIntegrity),
      inventory: { ...state.player.inventory, [itemId]: count - 1 }
    },
    lastEvent: integrityRestore > 0
      ? { type: "INTEGRITY", delta: integrityRestore, integrity: clamp(state.player.lineIntegrity + integrityRestore, 0, state.player.maxLineIntegrity), reason: item.label }
      : { type: "LOG", text: "Used item." }
  };

  if (tensionReduce) {
    next = applyTension(next, -tensionReduce, item.label);
  }

  // Enemy reacts after item if in combat and not in defeat prompt
  if (next.combat?.phase === "PLAYER" && next.combat?.outcome !== "DEFEAT_PROMPT") {
    const fish = getFish(content, next.combat.enemyId);
    next = fishTurn(content, fish, { ...next, combat: { ...next.combat, phase: "FISH" } });
  }

  return next;
}

function fishTurn(_content: ContentBundle, fish: FishDef, state: GameState): GameState {
  if (!state.combat) return state;

  const { pressureMult } = phaseTuning(state.combat.fishPhase);

  // Pressure is applied as tension gain. Brace reduces the next spike.
  const basePressure = Math.round(fish.pressure * pressureMult);
  const mitigated = Math.max(0, basePressure - Math.round(state.combat.brace));

  let next: GameState = applyTension(state, mitigated, `${fish.name} pulls`);

  // Reset brace after it absorbs one hit.
  next = {
    ...next,
    combat: { ...next.combat!, brace: 0, phase: "PLAYER", turn: next.combat!.turn + 1 }
  };

  // If tension is above safe limits, line integrity takes wear.
  next = applyIntegrityWear(next, "Over-tension");

  if (next.player.lineIntegrity <= 0) return resolveLose(next);
  return next;
}

function resolveWin(content: ContentBundle, fish: FishDef, state: GameState): GameState {
  const gained = fish?.xp ?? 0;

  let next = grantXp(
    content,
    {
      ...state,
      combat: undefined,
      // Relief: landing a fish should drop tension.
      player: { ...state.player, tension: Math.max(0, Math.round(state.player.tension * 0.35)) },
      lastEvent: { type: "XP", amount: gained }
    },
    gained
  );

  return next;
}

function resolveLose(state: GameState): GameState {
  // Failure condition is line break (integrity 0).
  return {
    ...state,
    combat: state.combat ? { ...state.combat, outcome: "DEFEAT_PROMPT" } : undefined,
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

    // Small progression bumps (do not introduce new combat stats here yet).
    const maxLineIntegrity = state.player.maxLineIntegrity + 2;

    state = {
      ...state,
      player: {
        ...state.player,
        level,
        maxLineIntegrity,
        lineIntegrity: maxLineIntegrity,
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

type FishDef = { id: Id; name: string; maxStamina: number; pressure: number; xp: number };

function getFish(content: ContentBundle, enemyId: Id): FishDef {
  const e = content.enemies[enemyId];
  if (!e) return { id: enemyId, name: enemyId, maxStamina: 80, pressure: 10, xp: 10 };

  const maxStamina =
    typeof e.stamina === "number"
      ? e.stamina
      : typeof e.maxHp === "number"
      ? e.maxHp
      : 80;

  const pressure =
    typeof e.pressure === "number"
      ? e.pressure
      : typeof e.attack === "number"
      ? e.attack
      : 10;

  return { id: e.id, name: e.name, maxStamina, pressure, xp: e.xp };
}

function phaseForStamina(stamina: number, max: number): FishPhase {
  if (max <= 0) return "EXHAUSTED";
  const r = stamina / max;
  if (r > 0.66) return "AGGRESSIVE";
  if (r > 0.33) return "DEFENSIVE";
  return "EXHAUSTED";
}

function phaseTuning(phase: FishPhase) {
  if (phase === "AGGRESSIVE") return { pressureMult: 1.2, reelEffMult: 0.9 };
  if (phase === "DEFENSIVE") return { pressureMult: 0.95, reelEffMult: 0.8 };
  return { pressureMult: 0.7, reelEffMult: 1.25 };
}

function interpretAction(a: ContentBundle["actions"][Id]) {
  // Defaults are tuned to hit ~6–12 turns per fight with the sample content.
  // Legacy mapping keeps existing exports usable while the design tool updates.

  // If the action includes explicit fishing fields, prefer them.
  const explicitKind = a.kind === "reel" || a.kind === "brace" || a.kind === "adjust" || a.kind === "technique" ? a.kind : null;
  if (explicitKind) {
    return {
      id: a.id,
      label: a.label,
      kind: explicitKind,
      staminaTake: Math.max(0, Math.round(-(a.staminaDelta ?? 0))),
      tension: Math.abs(a.tensionDelta ?? 0),
      brace: explicitKind === "brace" ? 14 : 0,
      control: explicitKind === "adjust" ? 8 : 0
    };
  }

  // Legacy kinds
  if (a.kind === "attack") {
    const dmg = a.damage ?? 0;
    const strain = a.focusCost ?? 0;
    return {
      id: a.id,
      label: a.label,
      kind: "reel" as const,
      staminaTake: Math.max(0, dmg),
      tension: 12 + Math.round(strain * 0.7),
      brace: 0,
      control: 0
    };
  }

  // utility: treat as brace/adjust depending on focusGain
  const gain = a.focusGain ?? 0;
  const heal = a.heal ?? 0;
  const relief = 10 + Math.round(gain * 0.35) + Math.round(heal * 0.4);
  const kind = gain >= 14 ? ("adjust" as const) : ("brace" as const);
  return {
    id: a.id,
    label: a.label,
    kind,
    staminaTake: 0,
    tension: relief,
    brace: kind === "brace" ? 18 : 0,
    control: kind === "adjust" ? 10 : 0
  };
}

function safeTensionLimit(state: GameState): number {
  // Control slightly raises the safe band. Keep it subtle.
  const control = state.combat?.control ?? 0;
  return clamp(58 + Math.round(control * 0.35), 50, 80);
}

function applyTension(state: GameState, delta: number, reason?: string): GameState {
  const nextTension = clamp(state.player.tension + delta, 0, state.player.maxTension);
  return {
    ...state,
    player: { ...state.player, tension: nextTension },
    lastEvent: { type: "TENSION", delta, tension: nextTension, reason }
  };
}

function applyIntegrityWear(state: GameState, reason?: string): GameState {
  const safe = safeTensionLimit(state);
  const over = Math.max(0, state.player.tension - safe);
  if (over <= 0) return state;

  // Wear is slow, but it *matters*.
  const wear = clamp(Math.ceil(over / 10), 1, 8);
  const nextIntegrity = clamp(state.player.lineIntegrity - wear, 0, state.player.maxLineIntegrity);
  return {
    ...state,
    player: { ...state.player, lineIntegrity: nextIntegrity },
    lastEvent: { type: "INTEGRITY", delta: -wear, integrity: nextIntegrity, reason: reason ?? "Line strain" }
  };
}
