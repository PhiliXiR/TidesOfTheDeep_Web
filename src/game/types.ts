export type Id = string;

export type ContentBundle = {
  enemies: Record<Id, { id: Id; name: string; maxHp: number; attack: number }>;
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
  encounters: Record<
    Id,
    { id: Id; enemyId: Id; fightActions: Id[]; itemDrops?: Id[] }
  >;
  levelGraph: Record<Id, any>;
};

export type GameEvent =
  | { type: "LOG"; text: string }
  | { type: "DAMAGE"; who: "player" | "enemy"; amount: number }
  | { type: "HEAL"; who: "player" | "enemy"; amount: number }
  | { type: "WIN" }
  | { type: "LOSE" }
  | { type: "NODE"; nodeId: Id };

export type GameState = {
  progress: { nodeId: Id };
  player: {
    hp: number;
    maxHp: number;
    focus: number;
    maxFocus: number;
    inventory: Record<Id, number>;
  };
  combat?: {
    encounterId: Id;
    enemyId: Id;
    enemyHp: number;
    phase: "PLAYER" | "ENEMY";
    turn: number;
  };
  lastEvent?: GameEvent;
};
