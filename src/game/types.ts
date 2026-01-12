export type Id = string;

export type FishPhase = "AGGRESSIVE" | "DEFENSIVE" | "EXHAUSTED";

export type TimingGrade = "MISS" | "GOOD" | "PERFECT";

export type ContentBundle = {
  xpCurve: { base: number; growth: number };

  regions: Record<
    Id,
    {
      id: Id;
      name: string;
      requiredLevel: number;
      encounterPool: { enemyId: Id; weight: number }[];
    }
  >;

  // Note: Content is authored as a JSON export and may evolve.
  // For now we support legacy fields (maxHp/attack, damage/heal/focusCost/focusGain)
  // and interpret them into the fishing combat model.
  enemies: Record<
    Id,
    {
      id: Id;
      name: string;
      xp: number;

      // Fishing model (preferred)
      stamina?: number;
      pressure?: number;

      // Legacy combat model (supported for now)
      maxHp?: number;
      attack?: number;
    }
  >;

  actions: Record<
    Id,
    {
      id: Id;
      label: string;

      // Kind supports both the new fishing intent and legacy exports.
      kind: "reel" | "brace" | "adjust" | "technique" | "attack" | "utility";
      timing?: "none" | "basic";
      staminaDelta?: number; // negative = fish tires
      tensionDelta?: number; // positive = more danger
      integrityDelta?: number; // positive = repair, negative = wear

      // Legacy combat fields (supported for now)
      damage?: number;
      heal?: number;
      focusCost?: number;
      focusGain?: number;
    }
  >;

  items: Record<
    Id,
    {
      id: Id;
      label: string;

      // Preferred fishing intent
      integrityRestore?: number;
      tensionReduce?: number;

      // Legacy field (supported for now)
      heal: number;
    }
  >;

  loadout?: {
    startActions?: Id[];
    startItems?: Record<Id, number>;
  };
};

export type GameEvent =
  | { type: "LOG"; text: string }
  | { type: "TIMING"; grade: TimingGrade }
  | { type: "TENSION"; delta: number; tension: number; reason?: string }
  | { type: "INTEGRITY"; delta: number; integrity: number; reason?: string }
  | { type: "STAMINA"; delta: number; phase: FishPhase; reason?: string }
  | { type: "PHASE"; phase: FishPhase }
  | { type: "XP"; amount: number }
  | { type: "LEVEL_UP"; level: number }
  | { type: "SPAWN"; regionId: Id; enemyId: Id }
  | { type: "DEFEAT_PROMPT" }
  | { type: "FLEE" };

export type GameState = {
  progress: { regionId: Id };

  player: {
    level: number;
    xp: number;
    xpToNext: number;

    // Fishing resources
    tension: number; // 0..maxTension
    maxTension: number;

    lineIntegrity: number; // 0..maxLineIntegrity (0 = defeat)
    maxLineIntegrity: number;

    knownActions: Id[];
    inventory: Record<Id, number>;
  };

  combat?: {
    enemyId: Id;

    // Hidden values (player-facing UI should avoid numeric HP-like presentation)
    fishStamina: number;
    maxFishStamina: number;
    fishPhase: FishPhase;

    // Turn state
    phase: "PLAYER" | "FISH";
    turn: number;

    // Simple stateful modifiers (small, not a new system)
    brace: number; // reduces next fish pressure
    control: number; // reduces tension gain / integrity wear

    // Used for the retry prompt:
    lastSpawn?: { regionId: Id; enemyId: Id };
    outcome?: "NONE" | "DEFEAT_PROMPT";
  };

  lastEvent?: GameEvent;
};
