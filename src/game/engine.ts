import { ContentBundle, FishPhase, GameState, Id, StatKey, TimingGrade } from "./types";

type PlayerStats = GameState["player"]["stats"];

/**
 * Pure game engine for Tides of the Deep.
 *
 * This file is intentionally UI-agnostic and side-effect free.
 * Every exported function returns a new `GameState` (no mutation, no I/O).
 *
 * Locked gameplay rules this engine enforces:
 * - No player HP.
 * - Defeat only happens when `lineIntegrity` reaches 0 (line break).
 * - Fish have stamina + phases (not HP).
 * - Tension is the primary danger signal; high tension causes integrity wear.
 *
 * Progression systems (also locked):
 * - Exactly 5 stats: control, power, durability, precision, tactics.
 * - Skills are data-driven via `ContentBundle.skills` (passive/active/reactive).
 * - Full respec is always allowed (testing mode).
 */

// -----------------------------------------------------------------------------
// STATE NORMALIZATION / MIGRATION
// -----------------------------------------------------------------------------

/**
 * Normalizes an arbitrary saved snapshot into the current fishing-combat model.
 *
 * Why this exists:
 * - Old saves may have legacy fields (hp/focus/enemyHp, ENEMY turn names, etc).
 * - Newer systems add stats/skills/derived integrity.
 *
 * This function keeps older runs playable without redesigning persistence.
 */
export function normalizeState(content: ContentBundle, s: any): GameState {
  const contentVersion = typeof s?.contentVersion === "string" && s.contentVersion.trim()
    ? s.contentVersion
    : (content.contentVersion ?? "0.1.0");

  // Migration support: if you load an old run that used nodeId/combat.encounterId, etc.
  // we coerce it into the fishing combat loop state.
  const regionId = s?.progress?.regionId ?? firstRegionId(content) ?? "shore_1";

  const level = typeof s?.player?.level === "number" ? s.player.level : 1;
  const xp = typeof s?.player?.xp === "number" ? s.player.xp : 0;
  const xpToNext = typeof s?.player?.xpToNext === "number" ? s.player.xpToNext : xpForLevel(content, level);

  const stats: PlayerStats = normalizeStats(s?.player?.stats);

  // Stat points: total points are a function of level; unspent is derived unless present.
  const totalStatPoints = totalStatPointsForLevel(level);
  const spentStatPoints = sumStats(stats);
  const unspentStatPoints = clampNumber(
    s?.player?.unspentStatPoints ?? (totalStatPoints - spentStatPoints),
    0,
    totalStatPoints,
    Math.max(0, totalStatPoints - spentStatPoints)
  );

  const skillRanks: Record<Id, number> =
    s?.player?.skillRanks && typeof s.player.skillRanks === "object" ? s.player.skillRanks : {};

  // Skill points follow the same model: total points are a function of level.
  const totalSkillPoints = totalSkillPointsForLevel(level);
  const spentSkillPoints = sumSkillRanks(skillRanks);
  const unspentSkillPoints = clampNumber(
    s?.player?.unspentSkillPoints ?? (totalSkillPoints - spentSkillPoints),
    0,
    totalSkillPoints,
    Math.max(0, totalSkillPoints - spentSkillPoints)
  );

  const maxTension = typeof s?.player?.maxTension === "number" ? s.player.maxTension : 100;
  // Legacy mapping: old state.player.focus becomes a rough starting tension.
  const tensionFromLegacy = typeof s?.player?.focus === "number" ? Math.round((s.player.focus / 40) * 35) : undefined;
  const tension = clampNumber(s?.player?.tension ?? tensionFromLegacy, 0, maxTension, 12);

  // Line integrity is derived from (level, durability) so Durability meaningfully matters.
  const derivedMaxLineIntegrity = deriveMaxLineIntegrity(content, level, stats.durability);
  const maxLineIntegrity = typeof s?.player?.maxLineIntegrity === "number" ? s.player.maxLineIntegrity : derivedMaxLineIntegrity;
  const normalizedMaxLineIntegrity = derivedMaxLineIntegrity;
  // Legacy mapping: old state.player.hp becomes line integrity.
  const integrityFromLegacy = typeof s?.player?.hp === "number" ? Math.round((s.player.hp / Math.max(1, s.player.maxHp ?? 80)) * maxLineIntegrity) : undefined;
  const lineIntegrity = clampNumber(s?.player?.lineIntegrity ?? integrityFromLegacy, 0, normalizedMaxLineIntegrity, normalizedMaxLineIntegrity);

  const baseActions: Id[] = Array.isArray(s?.player?.knownActions)
    ? s.player.knownActions
    : content.loadout?.startActions ?? ["strike", "hookset", "breathe"];

  // Active skills can grant actions (menu techniques) into `knownActions`.
  const knownActions = computeKnownActions(content, baseActions, skillRanks);

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
          // Old state used "ENEMY". New state uses "FISH".
          phase: (s.combat.phase as any) === "ENEMY" ? "FISH" : ((s.combat.phase as any) ?? "PLAYER"),
          turn: (s.combat.turn as number) ?? 1,
          brace: typeof s.combat.brace === "number" ? s.combat.brace : 0,
          control: typeof s.combat.control === "number" ? s.combat.control : 0,
          skill: s.combat.skill ?? undefined,
          lastSpawn: s.combat.lastSpawn ?? undefined,
          outcome: s.combat.outcome ?? "NONE"
        } as GameState["combat"];
      })()
    : undefined;

  // Meta-loop fields (all optional / backward compatible)
  const currency = clampNumber(
    s?.currency,
    0,
    999999,
    typeof content.economy?.startingCurrency === "number" ? Math.max(0, Math.floor(content.economy.startingCurrency)) : 0
  );

  const temporaryMods: Id[] = Array.isArray(s?.temporaryMods)
    ? (s.temporaryMods.filter((x: any) => typeof x === "string") as Id[])
    : [];

  const contract = s?.contract && typeof s.contract === "object"
    ? (() => {
        const contractId = typeof s.contract.contractId === "string" ? (s.contract.contractId as Id) : null;
        const contractRegionId = typeof s.contract.regionId === "string" ? (s.contract.regionId as Id) : regionId;

        const encountersRaw = Array.isArray(s.contract.encounters) ? s.contract.encounters : [];
        const encounters = encountersRaw
          .map((e: any) => ({
            regionId: typeof e?.regionId === "string" ? (e.regionId as Id) : contractRegionId,
            enemyId: typeof e?.enemyId === "string" ? (e.enemyId as Id) : null
          }))
          .filter((e: any) => !!e.enemyId) as { regionId: Id; enemyId: Id }[];

        const index = clampNumber(s.contract.index, 0, Math.max(0, encounters.length - 1), 0);
        const phase = (s.contract.phase as any) === "CAMP" || (s.contract.phase as any) === "SUMMARY" ? s.contract.phase : "FIGHT";
        const stats = {
          perfectCount: clampNumber(s.contract.stats?.perfectCount, 0, 9999, 0),
          fightsWon: clampNumber(s.contract.stats?.fightsWon, 0, 9999, 0)
        };
        const earned = {
          currency: clampNumber(s.contract.earned?.currency, 0, 999999, 0)
        };

        if (!contractId) return undefined;
        if (encounters.length <= 0) return undefined;

        return {
          contractId,
          regionId: contractRegionId,
          encounters,
          index,
          phase,
          stats,
          earned,
          lastReward: s.contract.lastReward && typeof s.contract.lastReward === "object" ? s.contract.lastReward : undefined
        } as GameState["contract"];
      })()
    : undefined;

  return {
    contentVersion,
    progress: { regionId },
    player: {
      level,
      xp,
      xpToNext,
      stats,
      unspentStatPoints,
      skillRanks,
      unspentSkillPoints,
      tension,
      maxTension,
      lineIntegrity,
      maxLineIntegrity: normalizedMaxLineIntegrity,
      knownActions,
      inventory
    },
    currency,
    temporaryMods,
    contract,
    combat,
    lastEvent: s?.lastEvent
  };
}

// -----------------------------------------------------------------------------
// NEW RUN + BUILD (STATS/SKILLS)
// -----------------------------------------------------------------------------

/**
 * Creates a brand new run. Starter actions/items come from `content.loadout`.
 * Stats start at 0; level is 1.
 */
export function makeNewRunState(content: ContentBundle): GameState {
  const regionId = firstRegionId(content) ?? "shore_1";
  const knownActions = content.loadout?.startActions ?? ["strike", "hookset", "breathe"];
  const inventory = content.loadout?.startItems ?? { small_potion: 2 };

  const level = 1;
  const stats = defaultStats();

  return {
    contentVersion: content.contentVersion ?? "0.1.0",
    progress: { regionId },
    player: {
      level,
      xp: 0,
      xpToNext: xpForLevel(content, level),
      stats,
      unspentStatPoints: totalStatPointsForLevel(level),
      skillRanks: {},
      unspentSkillPoints: totalSkillPointsForLevel(level),
      tension: 10,
      maxTension: 100,
      lineIntegrity: deriveMaxLineIntegrity(content, level, stats.durability),
      maxLineIntegrity: deriveMaxLineIntegrity(content, level, stats.durability),
      knownActions: computeKnownActions(content, knownActions, {}),
      inventory
    },
    currency: Math.max(0, Math.floor(content.economy?.startingCurrency ?? 0)),
    temporaryMods: [],
    contract: undefined,
    combat: undefined,
    lastEvent: { type: "LOG", text: "New run started." }
  };
}

/**
 * Returns the timing minigame windows for the current state.
 *
 * The UI uses this so timing forgiveness scales with:
 * - Precision (expands PERFECT)
 * - Control + level (widens GOOD a bit)
 *
 * Values are radii around 0.5 in the timing bar (0..1).
 */
export function getTimingWindows(content: ContentBundle, state: GameState): { perfectRadius: number; goodRadius: number } {
  // Radii are measured as distance from 0.5 on the timing bar.
  const t = content.tuning?.timing;
  const basePerfect = t?.basePerfectRadius ?? 0.07;
  const baseGood = t?.baseGoodRadius ?? 0.18;

  const perfect = basePerfect + (t?.perfectPerPrecision ?? 0.008) * state.player.stats.precision;
  const good = baseGood + (t?.goodPerControl ?? 0.0035) * state.player.stats.control + (t?.goodPerLevel ?? 0.0012) * (state.player.level - 1);

  // Keep sane bounds.
  return {
    perfectRadius: clamp(perfect, 0.04, 0.16),
    goodRadius: clamp(Math.max(good, perfect + 0.04), 0.12, 0.32)
  };
}

/**
 * Spends one stat point into the selected stat.
 *
 * Note: Durability changes max Line Integrity, so we recompute it here.
 */
export function spendStatPoint(content: ContentBundle, state: GameState, stat: StatKey): GameState {
  if (state.player.unspentStatPoints <= 0) return { ...state, lastEvent: { type: "LOG", text: "No stat points." } };
  const nextStats = { ...state.player.stats, [stat]: state.player.stats[stat] + 1 } as PlayerStats;

  const nextMax = deriveMaxLineIntegrity(content, state.player.level, nextStats.durability);
  return {
    ...state,
    player: {
      ...state.player,
      stats: nextStats,
      unspentStatPoints: state.player.unspentStatPoints - 1,
      maxLineIntegrity: nextMax,
      lineIntegrity: clamp(state.player.lineIntegrity, 0, nextMax)
    },
    lastEvent: { type: "LOG", text: `+1 ${stat}` }
  };
}

/**
 * Testing-mode respec.
 *
 * Locked policy: full respec is allowed at any time.
 * We reset stats + skills and refund points (derived from level).
 */
export function respecAll(content: ContentBundle, state: GameState): GameState {
  const level = state.player.level;
  const stats = defaultStats();
  const maxLineIntegrity = deriveMaxLineIntegrity(content, level, stats.durability);

  const baseActions = content.loadout?.startActions ?? ["strike", "hookset", "breathe"];

  return {
    ...state,
    player: {
      ...state.player,
      stats,
      unspentStatPoints: totalStatPointsForLevel(level),
      skillRanks: {},
      unspentSkillPoints: totalSkillPointsForLevel(level),
      maxLineIntegrity,
      lineIntegrity: maxLineIntegrity,
      knownActions: computeKnownActions(content, baseActions, {})
    },
    combat: state.combat
      ? {
          ...state.combat,
          brace: 0,
          control: 0,
          skill: undefined
        }
      : state.combat,
    lastEvent: { type: "LOG", text: "Respec complete." }
  };
}

/**
 * Unlocks or upgrades a skill by spending one skill point.
 *
 * - PASSIVE/REACTIVE skills contribute modifiers/triggers.
 * - ACTIVE skills can grant new actions into the player's menu.
 */
export function unlockOrUpgradeSkill(content: ContentBundle, state: GameState, skillId: Id): GameState {
  const skill = content.skills?.[skillId];
  if (!skill) return { ...state, lastEvent: { type: "LOG", text: `Missing skill: ${skillId}` } };
  if (state.player.level < skill.requiredLevel) return { ...state, lastEvent: { type: "LOG", text: `Requires level ${skill.requiredLevel}.` } };
  if (state.player.unspentSkillPoints <= 0) return { ...state, lastEvent: { type: "LOG", text: "No skill points." } };

  const prereq = skill.prereq ?? [];
  for (const p of prereq) {
    if ((state.player.skillRanks[p] ?? 0) <= 0) {
      return { ...state, lastEvent: { type: "LOG", text: `Missing prerequisite: ${p}` } };
    }
  }

  const currentRank = state.player.skillRanks[skillId] ?? 0;
  if (currentRank >= skill.maxRank) return { ...state, lastEvent: { type: "LOG", text: "Max rank." } };

  const nextRanks = { ...state.player.skillRanks, [skillId]: currentRank + 1 };
  const knownActions = computeKnownActions(content, state.player.knownActions ?? [], nextRanks);

  return {
    ...state,
    player: {
      ...state.player,
      skillRanks: nextRanks,
      unspentSkillPoints: state.player.unspentSkillPoints - 1,
      knownActions
    },
    lastEvent: { type: "LOG", text: `Skill unlocked: ${skill.label}` }
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

// -----------------------------------------------------------------------------
// ENCOUNTERS
// -----------------------------------------------------------------------------

/**
 * Starts a random encounter in the current region.
 *
 * Important: The fish starts at full stamina, and the player always acts first.
 */
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

/**
 * Starts a specific encounter (used by contracts to be snapshot-safe).
 */
export function startFightAgainstEnemy(content: ContentBundle, state: GameState, regionId: Id, enemyId: Id): GameState {
  const r = content.regions[regionId];
  if (!r) return { ...state, lastEvent: { type: "LOG", text: `Missing region: ${regionId}` } };
  if (state.player.level < r.requiredLevel) {
    return { ...state, lastEvent: { type: "LOG", text: `Region locked: level ${r.requiredLevel}+` } };
  }

  const fish = getFish(content, enemyId);
  if (!fish) return { ...state, lastEvent: { type: "LOG", text: `Missing enemy: ${enemyId}` } };

  const maxFishStamina = fish.maxStamina;
  const fishPhase = phaseForStamina(maxFishStamina, maxFishStamina);

  return {
    ...state,
    progress: { regionId },
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

// -----------------------------------------------------------------------------
// META LOOP (CONTRACTS / SHOPS / TEMP MODS)
// -----------------------------------------------------------------------------

export function startContract(content: ContentBundle, state: GameState, contractId: Id): GameState {
  const def = content.contracts?.[contractId];
  if (!def) return { ...state, lastEvent: { type: "LOG", text: `Missing contract: ${contractId}` } };

  if (state.combat) return { ...state, lastEvent: { type: "LOG", text: "Finish the current fight first." } };
  if (state.contract) return { ...state, lastEvent: { type: "LOG", text: "Contract already active." } };

  const region = content.regions?.[def.regionId];
  if (!region) return { ...state, lastEvent: { type: "LOG", text: `Missing region: ${def.regionId}` } };
  if (state.player.level < region.requiredLevel) {
    return { ...state, lastEvent: { type: "LOG", text: `Locked. Requires level ${region.requiredLevel}.` } };
  }

  const pool = def.encounterPool && Array.isArray(def.encounterPool) && def.encounterPool.length
    ? def.encounterPool
    : region.encounterPool;

  if (!Array.isArray(pool) || pool.length <= 0) {
    return { ...state, lastEvent: { type: "LOG", text: "Contract encounter pool is empty." } };
  }

  const min = clampNumber(def.encounterCount?.min, 1, 12, 2);
  const max = clampNumber(def.encounterCount?.max, min, 12, Math.max(min, 5));
  const count = randInt(min, max);

  // Snapshot-safe: resolve all RNG now, persist in state. Duplicates are allowed.
  const encounters = Array.from({ length: count }).map(() => ({
    regionId: def.regionId,
    enemyId: pickWeighted(pool)
  }));

  const next: GameState = {
    ...state,
    progress: { regionId: def.regionId },
    currency: typeof state.currency === "number" ? state.currency : Math.max(0, Math.floor(content.economy?.startingCurrency ?? 0)),
    temporaryMods: Array.isArray(state.temporaryMods) ? state.temporaryMods : [],
    contract: {
      contractId: def.id,
      regionId: def.regionId,
      encounters,
      index: 0,
      phase: "FIGHT",
      stats: { perfectCount: 0, fightsWon: 0 },
      earned: { currency: 0 },
      lastReward: undefined
    }
  };

  return spawnContractEncounter(content, next);
}

export function spawnContractEncounter(content: ContentBundle, state: GameState): GameState {
  const c = state.contract;
  if (!c) return { ...state, lastEvent: { type: "LOG", text: "No active contract." } };
  if (state.combat) return state;

  const enc = c.encounters[c.index];
  if (!enc) return { ...state, lastEvent: { type: "LOG", text: "No encounter available." } };

  return startFightAgainstEnemy(
    content,
    {
      ...state,
      progress: { regionId: enc.regionId },
      contract: { ...c, phase: "FIGHT", lastReward: undefined }
    },
    enc.regionId,
    enc.enemyId
  );
}

export function advanceContractAfterFight(content: ContentBundle, state: GameState): GameState {
  const c = state.contract;
  if (!c) return { ...state, lastEvent: { type: "LOG", text: "No active contract." } };
  if (state.combat) return { ...state, lastEvent: { type: "LOG", text: "Finish the fight first." } };
  if (c.phase !== "FIGHT") return state;

  const def = content.contracts?.[c.contractId];
  if (!def) return { ...state, contract: undefined, lastEvent: { type: "LOG", text: "Contract missing from content (ended)." } };

  const perFightCurrency = rollRange(def.rewardsPerFight?.currency);
  let next: GameState = state;
  if (perFightCurrency > 0) next = addCurrency(next, perFightCurrency);

  const fightsWon = c.stats.fightsWon + 1;
  const earnedCurrency = c.earned.currency + perFightCurrency;
  const lastReward = perFightCurrency > 0 ? { currency: perFightCurrency } : undefined;

  const isLast = c.index >= c.encounters.length - 1;
  if (isLast) {
    const finalCurrency = rollRange(def.rewards?.currency);
    next = finalCurrency > 0 ? addCurrency(next, finalCurrency) : next;
    return {
      ...next,
      contract: {
        ...c,
        phase: "SUMMARY",
        stats: { ...c.stats, fightsWon },
        earned: { currency: earnedCurrency + finalCurrency },
        lastReward: {
          currency: (lastReward?.currency ?? 0) + (finalCurrency > 0 ? finalCurrency : 0)
        }
      },
      lastEvent: { type: "LOG", text: "Contract complete." }
    };
  }

  return {
    ...next,
    contract: {
      ...c,
      phase: "CAMP",
      stats: { ...c.stats, fightsWon },
      earned: { currency: earnedCurrency },
      lastReward
    },
    lastEvent: { type: "LOG", text: "Camp." }
  };
}

export function continueContract(content: ContentBundle, state: GameState): GameState {
  const c = state.contract;
  if (!c) return { ...state, lastEvent: { type: "LOG", text: "No active contract." } };
  if (state.combat) return state;
  if (c.phase !== "CAMP") return state;

  const next: GameState = {
    ...state,
    contract: {
      ...c,
      index: clamp(c.index + 1, 0, Math.max(0, c.encounters.length - 1)),
      phase: "FIGHT",
      lastReward: undefined
    }
  };

  return spawnContractEncounter(content, next);
}

export function endContract(state: GameState): GameState {
  if (!state.contract) return state;
  return {
    ...state,
    contract: undefined,
    lastEvent: { type: "LOG", text: "Back to board." }
  };
}

export function buyFromShop(content: ContentBundle, state: GameState, shopId: Id, stockId: Id): GameState {
  const shop = content.shops?.[shopId];
  if (!shop) return { ...state, lastEvent: { type: "LOG", text: `Missing shop: ${shopId}` } };
  const entry = (shop.stock ?? []).find((s) => s.id === stockId);
  if (!entry) return { ...state, lastEvent: { type: "LOG", text: "Missing shop item." } };

  const cur = typeof state.currency === "number" ? state.currency : 0;
  if (cur < entry.price) return { ...state, lastEvent: { type: "LOG", text: "Not enough currency." } };

  if (entry.kind === "ITEM") {
    const item = content.items?.[entry.itemId];
    if (!item) return { ...state, lastEvent: { type: "LOG", text: `Missing item: ${entry.itemId}` } };
    const amt = clampNumber(entry.amount, 1, 999, 1);
    return {
      ...state,
      currency: cur - entry.price,
      player: {
        ...state.player,
        inventory: {
          ...state.player.inventory,
          [entry.itemId]: (state.player.inventory?.[entry.itemId] ?? 0) + amt
        }
      },
      lastEvent: { type: "LOG", text: `Bought ${item.label} x${amt}.` }
    };
  }

  // RIG_MOD
  const mod = content.rigMods?.[entry.modId];
  if (!mod) return { ...state, lastEvent: { type: "LOG", text: `Missing rig mod: ${entry.modId}` } };
  const mods = Array.isArray(state.temporaryMods) ? state.temporaryMods : [];
  if (mods.includes(entry.modId)) return { ...state, lastEvent: { type: "LOG", text: "Already installed." } };
  return {
    ...state,
    currency: cur - entry.price,
    temporaryMods: [...mods, entry.modId],
    lastEvent: { type: "LOG", text: `Installed: ${mod.label}.` }
  };
}

/**
 * Retry uses the last spawn, resets the fish, and restores line integrity so the
 * player can immediately test strategy again (testing-friendly).
 */
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

/**
 * Flee ends combat and drops tension back to 0.
 */
export function flee(state: GameState): GameState {
  return {
    ...state,
    combat: undefined,
    player: { ...state.player, tension: 0 },
    lastEvent: { type: "FLEE" }
  };
}

// -----------------------------------------------------------------------------
// COMBAT LOOP
// -----------------------------------------------------------------------------

/**
 * Applies a player action during combat.
 *
 * High-level flow:
 * 1) Validate combat + turn
 * 2) Interpret action -> fishing intent (supports legacy content)
 * 3) Apply player effects
 * 4) Update fish phase
 * 5) Win check (fish stamina <= 0)
 * 6) Fish response (fishTurn)
 */
export function applyAction(content: ContentBundle, state: GameState, actionId: Id, timing?: TimingGrade): GameState {
  if (!state.combat) return { ...state, lastEvent: { type: "LOG", text: "No combat active." } };
  if (state.combat.outcome === "DEFEAT_PROMPT") return state; // waiting on retry/flee
  if (state.combat.phase !== "PLAYER") return state;

  const action = content.actions[actionId];
  if (!action) return { ...state, lastEvent: { type: "LOG", text: `Missing action: ${actionId}` } };

  // Interpret action data into concrete intent values.
  // This preserves backwards compatibility with older action exports.
  const intent = interpretAction(action);
  const fish = getFish(content, state.combat.enemyId);

  const { reelEffMult } = phaseTuning(state, state.combat.fishPhase);
  const stats = effectiveStats(content, state);
  const effects = collectEffects(content, state);

  let staminaMult = 1;
  let tensionBonus = 0;
  let tensionRelief = 0;

  if (timing) {
    // Timing is an amplifier, not a replacement for stats.
    if (timing === "MISS") {
      staminaMult = 0.15 + Math.min(0.08, stats.precision * 0.004);
      tensionBonus += Math.max(5, 14 - Math.round(stats.precision * 0.6) - Math.round(stats.control * 0.25));
    } else if (timing === "GOOD") {
      staminaMult = 1.0 + Math.min(0.12, stats.precision * 0.006);
    } else if (timing === "PERFECT") {
      staminaMult = 1.35 + Math.min(0.28, stats.precision * 0.02);
      tensionRelief += 6 + Math.round(stats.precision * 0.35);
    }
  }

  let next: GameState = state;

  // Meta-loop objective tracking (does not affect combat rules)
  if (timing === "PERFECT" && next.contract && next.contract.phase === "FIGHT") {
    next = {
      ...next,
      contract: {
        ...next.contract,
        stats: { ...next.contract.stats, perfectCount: next.contract.stats.perfectCount + 1 }
      }
    };
  }

  // Apply player action effects (player phase only).
  if (intent.kind === "reel" || intent.kind === "technique") {
    const baseStamina = Math.max(0, intent.staminaTake);

    // Power increases progress. Techniques scale slightly harder than basic reels.
    const powerMult = 1 + stats.power * (intent.kind === "technique" ? 0.05 : 0.035);
    const take = Math.round(baseStamina * reelEffMult * staminaMult * powerMult);

    next = {
      ...next,
      combat: {
        ...next.combat!,
        fishStamina: Math.max(0, next.combat!.fishStamina - take)
      },
      lastEvent: { type: "STAMINA", delta: -take, phase: next.combat!.fishPhase, reason: intent.label }
    };

    // Reeling always raises tension (risk). At high tension, Power gets riskier.
    const overSafe = Math.max(0, next.player.tension - safeTensionLimit(content, next));
    const powerRisk = overSafe > 0 ? Math.round(stats.power * 0.35) : 0;
    next = applyTension(next, intent.tension + tensionBonus + powerRisk - tensionRelief, "Reel");

    if (timing === "PERFECT" && effects.negateWearOnPerfect) {
      // Reactive skill support: mark a one-turn flag consumed by applyIntegrityWear.
      next = {
        ...next,
        combat: {
          ...next.combat!,
          skill: { ...(next.combat?.skill ?? {}), negateWearThisTurn: true }
        }
      };
    }
  } else if (intent.kind === "brace") {
    // Brace: reduce current tension and reduce incoming pressure.
    const relief = Math.round(intent.tension * (1 + stats.tactics * 0.03 + levelBraceBonus(state.player.level)) + effects.braceReliefBonus);
    next = applyTension(next, -relief, "Brace");
    next = {
      ...next,
      combat: {
        ...next.combat!,
        brace: clamp(next.combat!.brace + Math.round(intent.brace * (1 + stats.tactics * 0.04 + levelBraceBonus(state.player.level)) + effects.braceBonus), 0, 60),
        control: clamp(next.combat!.control + effects.controlOnBrace, 0, 60)
      },
      lastEvent: { type: "LOG", text: "You brace and steady the line." }
    };
  } else if (intent.kind === "adjust") {
    // Adjust: a small immediate relief plus a persistent control bonus.
    const relief = Math.round(intent.tension * (1 + stats.control * 0.01));
    next = applyTension(next, -relief, "Adjust" );
    next = {
      ...next,
      combat: { ...next.combat!, control: clamp(next.combat!.control + Math.round(intent.control * (1 + stats.tactics * 0.05)), 0, 60) },
      lastEvent: { type: "LOG", text: "You adjust your angle and regain control." }
    };
  }

  // Fish phase is derived from remaining stamina.
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

  // Fish response ends the full turn.
  return fishTurn(content, fish, { ...next, combat: { ...next.combat!, phase: "FISH" } });
}

/**
 * Uses an item (repair + optional tension reduction).
 *
 * If used in combat on the player's phase, the fish still takes its response.
 */
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

/**
 * Fish response.
 *
 * Fish do not deal HP damage. Instead:
 * - Fish pressure increases tension
 * - If tension exceeds the safe band, line integrity takes wear
 */
function fishTurn(_content: ContentBundle, fish: FishDef, state: GameState): GameState {
  if (!state.combat) return state;

  const { pressureMult } = phaseTuning(state, state.combat.fishPhase);
  const stats = effectiveStats(_content, state);
  const effects = collectEffects(_content, state);

  // Passive skill effect: small stamina bleed during EXHAUSTED phase.
  let nextState: GameState = state;
  if (state.combat.fishPhase === "EXHAUSTED" && effects.staminaBleedExhausted > 0) {
    const bleed = Math.min(state.combat.fishStamina, effects.staminaBleedExhausted);
    if (bleed > 0) {
      nextState = {
        ...nextState,
        combat: { ...nextState.combat!, fishStamina: Math.max(0, nextState.combat!.fishStamina - bleed) },
        lastEvent: { type: "STAMINA", delta: -bleed, phase: nextState.combat!.fishPhase, reason: "Pressure bleed" }
      };
    }
  }

  // Pressure is applied as tension gain. Brace reduces that spike once.
  const basePressure = Math.round(fish.pressure * pressureMult);
  const mitigated = Math.max(0, basePressure - Math.round(nextState.combat!.brace));

  // Control (stat + temporary combat control) reduces tension gained from fish pulls.
  const controlMult = clamp(1 - stats.control * 0.018, 0.72, 1);
  const flowMult = clamp(1 - (nextState.combat!.control ?? 0) * 0.008, 0.7, 1);
  const tensionMult = effects.fishTensionMult;
  const tensionDelta = Math.round(mitigated * controlMult * flowMult * tensionMult);

  let next: GameState = applyTension(nextState, tensionDelta, `${fish.name} pulls`);

  // Reactive skill effect: if tension crosses a threshold, grant temporary control (once per turn).
  if (effects.controlOnHighTensionThreshold !== null) {
    const thresh = effects.controlOnHighTensionThreshold;
    const already = next.combat?.skill?.highTensionTriggeredTurn === next.combat?.turn;
    if (!already && next.player.tension >= thresh) {
      next = {
        ...next,
        combat: {
          ...next.combat!,
          control: clamp(next.combat!.control + effects.controlOnHighTensionGain, 0, 60),
          skill: { ...(next.combat?.skill ?? {}), highTensionTriggeredTurn: next.combat!.turn }
        },
        lastEvent: { type: "LOG", text: "You find a clutch pocket of control." }
      };
    }
  }

  // Reset brace after it absorbs one hit.
  next = {
    ...next,
    combat: { ...next.combat!, brace: 0, phase: "PLAYER", turn: next.combat!.turn + 1 }
  };

  // If tension is above safe limits, line integrity takes wear.
  next = applyIntegrityWear(_content, next, "Over-tension");

  // Clear one-turn flags.
  if (next.combat?.skill?.negateWearThisTurn) {
    next = { ...next, combat: { ...next.combat, skill: { ...next.combat.skill, negateWearThisTurn: false } } };
  }

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

// -----------------------------------------------------------------------------
// XP / LEVELING
// -----------------------------------------------------------------------------

/**
 * Grants XP and applies level-ups.
 *
 * Locked leveling reward model (implemented here):
 * - Every level: +1 unspent stat point (player choice)
 * - Every level: +1 unspent skill point (unlock or upgrade)
 * - Derived stats (like maxLineIntegrity) are recalculated via helpers
 */
function grantXp(content: ContentBundle, state: GameState, amount: number): GameState {
  let xp = state.player.xp + amount;
  let level = state.player.level;
  let xpToNext = state.player.xpToNext;

  // level up loop
  while (xp >= xpToNext) {
    xp -= xpToNext;
    level += 1;
    xpToNext = xpForLevel(content, level);

    // Every level: +1 stat point, +1 skill point (testing friendly).
    const nextUnspentStats = state.player.unspentStatPoints + 1;
    const nextUnspentSkills = state.player.unspentSkillPoints + 1;
    const maxLineIntegrity = deriveMaxLineIntegrity(content, level, state.player.stats.durability);

    state = {
      ...state,
      player: {
        ...state.player,
        level,
        maxLineIntegrity,
        lineIntegrity: maxLineIntegrity,
        xp,
        xpToNext,
        unspentStatPoints: nextUnspentStats,
        unspentSkillPoints: nextUnspentSkills
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

// -----------------------------------------------------------------------------
// UTILITIES (RNG / CLAMP)
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// CONTENT INTERPRETATION (FISH / PHASES / ACTIONS)
// -----------------------------------------------------------------------------

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

function phaseTuning(state: GameState, phase: FishPhase) {
  // Minor systemic improvement: as level rises, early surges are slightly less punishing
  // (player handling improves; fish aren't "weaker").
  const handling = clamp(0.0 + (state.player.level - 1) * 0.012, 0, 0.12);
  const aggressivePressure = 1.2 - handling;

  if (phase === "AGGRESSIVE") return { pressureMult: aggressivePressure, reelEffMult: 0.9 };
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

// -----------------------------------------------------------------------------
// TENSION / INTEGRITY RULES
// -----------------------------------------------------------------------------

function safeTensionLimit(content: ContentBundle, state: GameState): number {
  // Control slightly raises the safe band. Keep it subtle.
  const combatControl = state.combat?.control ?? 0;
  const statControl = effectiveStats(content, state).control;
  return clamp(58 + Math.round(combatControl * 0.35) + Math.round(statControl * 1.15), 50, 86);
}

function applyTension(state: GameState, delta: number, reason?: string): GameState {
  const nextTension = clamp(state.player.tension + delta, 0, state.player.maxTension);
  return {
    ...state,
    player: { ...state.player, tension: nextTension },
    lastEvent: { type: "TENSION", delta, tension: nextTension, reason }
  };
}

function applyIntegrityWear(content: ContentBundle, state: GameState, reason?: string): GameState {
  // If a skill flag negates wear this turn, do nothing.
  if (state.combat?.skill?.negateWearThisTurn) return state;

  const safe = safeTensionLimit(content, state);
  const over = Math.max(0, state.player.tension - safe);
  if (over <= 0) return state;

  // Wear is slow, but it *matters*.
  // This is the ONLY path to defeat: integrity -> 0 (line break).
  const baseWear = clamp(Math.ceil(over / 10), 1, 8);
  const stats = effectiveStats(content, state);
  const effects = collectEffects(content, state);

  const durabilityMult = clamp(1 - stats.durability * 0.03, 0.65, 1);
  const wearMult = Math.max(0.2, durabilityMult * effects.integrityWearMult);
  const wear = clamp(Math.round(baseWear * wearMult), 1, 8);
  const nextIntegrity = clamp(state.player.lineIntegrity - wear, 0, state.player.maxLineIntegrity);
  return {
    ...state,
    player: { ...state.player, lineIntegrity: nextIntegrity },
    lastEvent: { type: "INTEGRITY", delta: -wear, integrity: nextIntegrity, reason: reason ?? "Line strain" }
  };
}

// -----------------------------------------------------------------------------
// PROGRESSION MATH (STATS / POINT TOTALS / DERIVED VALUES)
// -----------------------------------------------------------------------------

function defaultStats(): PlayerStats {
  return { control: 0, power: 0, durability: 0, precision: 0, tactics: 0 };
}

function normalizeStats(s: any): PlayerStats {
  const d = defaultStats();
  if (!s || typeof s !== "object") return d;
  return {
    control: clampNumber(s.control, 0, 99, d.control),
    power: clampNumber(s.power, 0, 99, d.power),
    durability: clampNumber(s.durability, 0, 99, d.durability),
    precision: clampNumber(s.precision, 0, 99, d.precision),
    tactics: clampNumber(s.tactics, 0, 99, d.tactics)
  };
}

function sumStats(stats: PlayerStats): number {
  return stats.control + stats.power + stats.durability + stats.precision + stats.tactics;
}

function sumSkillRanks(ranks: Record<Id, number>): number {
  let n = 0;
  for (const v of Object.values(ranks)) {
    if (typeof v === "number" && v > 0) n += v;
  }
  return n;
}

function totalStatPointsForLevel(level: number): number {
  // Testing-friendly: start with 1 at level 1.
  return Math.max(0, level);
}

function totalSkillPointsForLevel(level: number): number {
  // Testing-friendly: start with 1 at level 1.
  return Math.max(0, level);
}

function deriveMaxLineIntegrity(content: ContentBundle, level: number, durability: number): number {
  const t = content.tuning?.progression;
  const base = t?.baseLineIntegrity ?? 100;
  const perLevel = t?.lineIntegrityPerLevel ?? 2;
  const perDur = t?.lineIntegrityPerDurability ?? 6;
  return clamp(base + perLevel * Math.max(0, level - 1) + perDur * Math.max(0, durability), 60, 260);
}

function levelBraceBonus(level: number): number {
  // Minor systemic improvement: brace gets a little better each level.
  return clamp(0.0 + (level - 1) * 0.01, 0, 0.12);
}

// -----------------------------------------------------------------------------
// SKILLS (DATA-DRIVEN)
// -----------------------------------------------------------------------------

function computeKnownActions(content: ContentBundle, baseActions: Id[], skillRanks: Record<Id, number>): Id[] {
  // ACTIVE skills can grant actions. We treat action IDs as a set.
  const out = new Set<Id>(baseActions ?? []);
  for (const [skillId, rank] of Object.entries(skillRanks ?? {})) {
    if (!rank || rank <= 0) continue;
    const s = content.skills?.[skillId];
    if (!s) continue;
    if (s.type !== "ACTIVE") continue;
    for (const a of s.grantsActions ?? []) out.add(a);
  }
  return Array.from(out);
}

type EffectTotals = {
  integrityWearMult: number;
  fishTensionMult: number;
  braceBonus: number;
  braceReliefBonus: number;
  controlOnBrace: number;
  staminaBleedExhausted: number;
  controlOnHighTensionThreshold: number | null;
  controlOnHighTensionGain: number;
  negateWearOnPerfect: boolean;
};

function collectEffects(content: ContentBundle, state: GameState): EffectTotals {
  // Combine all learned skill effects into simple totals.
  // The combat loop reads these totals instead of hardcoding skill IDs.
  const totals: EffectTotals = {
    integrityWearMult: 1,
    fishTensionMult: 1,
    braceBonus: 0,
    braceReliefBonus: 0,
    controlOnBrace: 0,
    staminaBleedExhausted: 0,
    controlOnHighTensionThreshold: null,
    controlOnHighTensionGain: 0,
    negateWearOnPerfect: false
  };

  const skills = content.skills ?? {};
  for (const [skillId, rank] of Object.entries(state.player.skillRanks ?? {})) {
    if (!rank || rank <= 0) continue;
    const def = skills[skillId];
    if (!def) continue;
    for (const e of def.effects ?? []) {
      switch (e.kind) {
        case "INTEGRITY_WEAR_MULT":
          // Multiplicative reduction in integrity wear when over-tension.
          totals.integrityWearMult *= Math.max(0.25, 1 - e.multPerRank * rank);
          break;
        case "FISH_TENSION_MULT":
          // Multiplicative reduction to fish pull tension (applied in fishTurn).
          totals.fishTensionMult *= Math.max(0.4, 1 - e.multPerRank * rank);
          break;
        case "BRACE_BONUS":
          // Flat bonuses; final scaling also includes tactics + level.
          totals.braceBonus += e.bracePerRank * rank;
          totals.braceReliefBonus += e.reliefPerRank * rank;
          break;
        case "CONTROL_ON_BRACE":
          // Reactive: after Bracing, gain temporary combat control.
          totals.controlOnBrace += e.controlPerRank * rank;
          break;
        case "STAMINA_BLEED_EXHAUSTED":
          // Passive: tiny progress tick while the fish is exhausted.
          totals.staminaBleedExhausted += e.bleedPerRank * rank;
          break;
        case "CONTROL_ON_HIGH_TENSION":
          // Reactive: when tension is high, grant temporary combat control.
          totals.controlOnHighTensionThreshold =
            totals.controlOnHighTensionThreshold === null
              ? e.threshold
              : Math.min(totals.controlOnHighTensionThreshold, e.threshold);
          totals.controlOnHighTensionGain += e.controlPerRank * rank;
          break;
        case "NEGATE_WEAR_ON_PERFECT":
          // Reactive: on PERFECT timing, applyAction sets a one-turn "negate wear" flag.
          totals.negateWearOnPerfect = true;
          break;
      }
    }
  }

  // Rig mods apply multiplicative modifiers too.
  const rig = collectRigTotals(content, state);
  totals.integrityWearMult *= rig.integrityWearMult;
  totals.fishTensionMult *= rig.fishTensionMult;

  return totals;
}

type RigTotals = {
  statBonus: Partial<Record<StatKey, number>>;
  fishTensionMult: number;
  integrityWearMult: number;
};

function collectRigTotals(content: ContentBundle, state: GameState): RigTotals {
  const totals: RigTotals = {
    statBonus: {},
    fishTensionMult: 1,
    integrityWearMult: 1
  };

  const mods = Array.isArray(state.temporaryMods) ? state.temporaryMods : [];
  if (!mods.length) return totals;

  const defs = content.rigMods ?? {};
  for (const id of mods) {
    const def = defs[id];
    if (!def) continue;
    for (const e of def.effects ?? []) {
      if (!e || typeof e !== "object") continue;
      if (e.kind === "STAT_BONUS") {
        const add = typeof e.add === "number" ? e.add : 0;
        const stat = e.stat as StatKey;
        if (stat !== "control" && stat !== "power" && stat !== "durability" && stat !== "precision" && stat !== "tactics") continue;
        totals.statBonus[stat] = (totals.statBonus[stat] ?? 0) + add;
      } else if (e.kind === "FISH_TENSION_MULT") {
        const mult = typeof e.mult === "number" ? e.mult : 1;
        totals.fishTensionMult *= clamp(mult, 0.25, 2.5);
      } else if (e.kind === "INTEGRITY_WEAR_MULT") {
        const mult = typeof e.mult === "number" ? e.mult : 1;
        totals.integrityWearMult *= clamp(mult, 0.25, 2.5);
      }
    }
  }

  return totals;
}

function effectiveStats(content: ContentBundle, state: GameState): PlayerStats {
  const base = state.player.stats;
  const rig = collectRigTotals(content, state);
  const out: PlayerStats = { ...base };
  for (const k of Object.keys(rig.statBonus) as StatKey[]) {
    out[k] = clamp((out[k] ?? 0) + (rig.statBonus[k] ?? 0), 0, 99);
  }
  return out;
}

function addCurrency(state: GameState, amount: number): GameState {
  const a = Math.max(0, Math.floor(amount));
  const cur = typeof state.currency === "number" ? state.currency : 0;
  return { ...state, currency: cur + a };
}

function rollRange(r?: { min: number; max: number }): number {
  if (!r) return 0;
  const min = clampNumber(r.min, 0, 999999, 0);
  const max = clampNumber(r.max, min, 999999, min);
  return randInt(min, max);
}

function randInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
