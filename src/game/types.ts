export type Id = string;

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

  enemies: Record<Id, { id: Id; name: string; maxHp: number; attack: number; xp: number }>;

  actions: Record<
    Id,
    {
      id: Id;
      label: string;
      kind: "attack" | "utility";
      damage?: number;
      heal?: number;
      focusCost?: number;
      focusGain?: number;
    }
  >;

  items: Record<Id, { id: Id; label: string; heal: number }>;

  loadout?: {
    startActions?: Id[];
    startItems?: Record<Id, number>;
  };
};

export type GameEvent =
  | { type: "LOG"; text: string }
  | { type: "DAMAGE"; who: "player" | "enemy"; amount: number }
  | { type: "HEAL"; who: "player"; amount: number }
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

    hp: number;
    maxHp: number;

    focus: number;
    maxFocus: number;

    knownActions: Id[];
    inventory: Record<Id, number>;
  };

  combat?: {
    enemyId: Id;
    enemyHp: number;
    phase: "PLAYER" | "ENEMY";
    turn: number;

    // Used for the retry prompt:
    lastSpawn?: { regionId: Id; enemyId: Id };
    outcome?: "NONE" | "DEFEAT_PROMPT";
  };

  lastEvent?: GameEvent;
};
