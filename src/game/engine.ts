import { ContentBundle, GameState, Id } from "./types";

export function makeNewRunState(): GameState {
  return {
    progress: { nodeId: "start" },
    player: {
      hp: 80,
      maxHp: 80,
      focus: 40,
      maxFocus: 40,
      inventory: { small_potion: 2 }
    },
    lastEvent: { type: "LOG", text: "New run started." }
  };
}

export function enterNode(content: ContentBundle, state: GameState, nodeId: Id): GameState {
  const node = content.levelGraph?.[nodeId];
  if (!node) {
    return { ...state, progress: { nodeId }, lastEvent: { type: "LOG", text: `Missing node: ${nodeId}` } };
  }

  // Terminal nodes
  if (node.type === "victory") return { ...state, progress: { nodeId }, combat: undefined, lastEvent: { type: "WIN" } };
  if (node.type === "defeat") return { ...state, progress: { nodeId }, combat: undefined, lastEvent: { type: "LOSE" } };

  // Encounter node -> start combat
  if (node.type === "encounter") {
    const enc = content.encounters[node.encounterId];
    const enemy = content.enemies[enc.enemyId];
    return {
      ...state,
      progress: { nodeId },
      combat: {
        encounterId: enc.id,
        enemyId: enemy.id,
        enemyHp: enemy.maxHp,
        phase: "PLAYER",
        turn: 1
      },
      lastEvent: { type: "NODE", nodeId }
    };
  }

  // Intro/hub: safe
  return {
    ...state,
    progress: { nodeId },
    combat: undefined,
    lastEvent: { type: "NODE", nodeId }
  };
}

export function restartRun(content: ContentBundle): GameState {
  const s = makeNewRunState();
  // Enter start and immediately keep it safe (if start has "next", UI will show a Continue button)
  return enterNode(content, s, "start");
}

export function continueFromNode(content: ContentBundle, state: GameState): GameState {
  const node = content.levelGraph?.[state.progress.nodeId];
  const nextId = node?.next;
  if (!nextId) return { ...state, lastEvent: { type: "LOG", text: "No next node." } };
  return enterNode(content, state, nextId);
}

export function applyAction(content: ContentBundle, state: GameState, actionId: Id): GameState {
  if (!state.combat) return { ...state, lastEvent: { type: "LOG", text: "No combat active." } };
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
      lastEvent:
        heal > 0
          ? { type: "HEAL", who: "player", amount: heal }
          : { type: "LOG", text: "Focused." }
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
    lastEvent: { type: "HEAL", who: "player", amount: item.heal }
  };

  // Enemy reacts after item if in combat
  if (next.combat?.phase === "PLAYER") {
    next = enemyTurn(content, { ...next, combat: { ...next.combat, phase: "ENEMY" } });
  }
  return next;
}

export function restartEncounter(content: ContentBundle, state: GameState): GameState {
  const nodeId = state.progress.nodeId;
  return enterNode(content, state, nodeId);
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

  if (hp <= 0) return resolveLose(content, next);
  return next;
}

function resolveWin(content: ContentBundle, state: GameState): GameState {
  const node = content.levelGraph?.[state.progress.nodeId];
  const nextNode = node?.onWin ?? "win";
  return enterNode(content, { ...state, combat: undefined, lastEvent: { type: "WIN" } }, nextNode);
}

function resolveLose(content: ContentBundle, state: GameState): GameState {
  const node = content.levelGraph?.[state.progress.nodeId];
  const nextNode = node?.onLose ?? "lose";
  return enterNode(content, { ...state, combat: undefined, lastEvent: { type: "LOSE" } }, nextNode);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
