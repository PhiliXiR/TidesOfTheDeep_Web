import type { ContentBundle, Id } from "@/game/types";

export type ValidationIssue = { path: string; message: string };

export type ContentBundleValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

function isPlainObject(x: unknown): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function pushUnique(arr: ValidationIssue[], issue: ValidationIssue) {
  if (!arr.some((e) => e.path === issue.path && e.message === issue.message)) arr.push(issue);
}

function asDict(x: unknown): Record<string, any> {
  return isPlainObject(x) ? x : {};
}

function checkNonNegativeNumber(
  res: ContentBundleValidationResult,
  path: string,
  value: unknown,
  mode: "error" | "warning" = "error"
) {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || Number.isNaN(value)) {
    pushUnique(mode === "error" ? res.errors : res.warnings, { path, message: "Must be a number." });
    return;
  }
  if (value < 0) {
    pushUnique(mode === "error" ? res.errors : res.warnings, { path, message: "Must be non-negative." });
  }
}

function checkString(res: ContentBundleValidationResult, path: string, value: unknown, required = true) {
  if (value === undefined || value === null) {
    if (required) pushUnique(res.errors, { path, message: "Missing required string." });
    return;
  }
  if (typeof value !== "string" || value.trim() === "") {
    pushUnique(res.errors, { path, message: "Must be a non-empty string." });
  }
}

function checkDictHasIds(
  res: ContentBundleValidationResult,
  dict: Record<string, any>,
  dictPath: string,
  kind: string
) {
  for (const [key, value] of Object.entries(dict)) {
    const path = `${dictPath}.${key}`;
    if (!isPlainObject(value)) {
      pushUnique(res.errors, { path, message: `${kind} must be an object.` });
      continue;
    }
    checkString(res, `${path}.id`, value.id, true);
    if (typeof value.id === "string" && value.id !== key) {
      pushUnique(res.warnings, { path: `${path}.id`, message: `ID mismatch (key is '${key}').` });
    }
  }
}

function checkUniqueKeys(res: ContentBundleValidationResult, dict: Record<string, any>, dictPath: string) {
  // In JS objects, keys are unique by construction; this check is mainly for authored arrays.
  // Still, validate that no value declares a duplicate id.
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(dict)) {
    const declared = isPlainObject(value) && typeof value.id === "string" ? value.id : null;
    const id = declared ?? key;
    if (seen.has(id)) {
      pushUnique(res.errors, { path: `${dictPath}.${key}`, message: `Duplicate id '${id}'.` });
    }
    seen.add(id);
  }
}

export function validateContentBundle(input: unknown): ContentBundleValidationResult {
  const res: ContentBundleValidationResult = { ok: true, errors: [], warnings: [] };

  if (!isPlainObject(input)) {
    res.errors.push({ path: "$", message: "Content bundle must be a JSON object." });
    res.ok = false;
    return res;
  }

  // Top-level required-ish keys
  const requiredKeys = ["regions", "enemies", "actions", "items", "xpCurve"] as const;
  for (const k of requiredKeys) {
    if (!(k in input)) pushUnique(res.errors, { path: `$.${k}`, message: "Missing required top-level key." });
  }

  // Optional but expected by creator tooling
  if (!("skills" in input)) {
    pushUnique(res.warnings, { path: "$.skills", message: "Missing 'skills' key (use an empty object if none)." });
  }
  if (!("tuning" in input)) {
    pushUnique(res.warnings, { path: "$.tuning", message: "Missing 'tuning' key (recommended for balancing)." });
  }

  // Versioning
  if (!("contentVersion" in input)) {
    pushUnique(res.warnings, { path: "$.contentVersion", message: "Missing contentVersion (will default to '0.1.0' on save)." });
  } else if (typeof (input as any).contentVersion !== "string" || !(input as any).contentVersion.trim()) {
    pushUnique(res.errors, { path: "$.contentVersion", message: "contentVersion must be a non-empty string." });
  }

  const regions = asDict((input as any).regions);
  const enemies = asDict((input as any).enemies);
  const actions = asDict((input as any).actions);
  const items = asDict((input as any).items);
  const skills = asDict((input as any).skills);

  // Basic dict validation
  checkDictHasIds(res, regions, "$.regions", "Region");
  checkDictHasIds(res, enemies, "$.enemies", "Enemy");
  checkDictHasIds(res, actions, "$.actions", "Action");
  checkDictHasIds(res, items, "$.items", "Item");
  if ("skills" in input) checkDictHasIds(res, skills, "$.skills", "Skill");

  checkUniqueKeys(res, regions, "$.regions");
  checkUniqueKeys(res, enemies, "$.enemies");
  checkUniqueKeys(res, actions, "$.actions");
  checkUniqueKeys(res, items, "$.items");
  if ("skills" in input) checkUniqueKeys(res, skills, "$.skills");

  // Cross references: region encounter pools -> enemies
  for (const [rid, r] of Object.entries(regions)) {
    const pool = isPlainObject(r) ? (r as any).encounterPool : null;
    const poolPath = `$.regions.${rid}.encounterPool`;
    if (!Array.isArray(pool)) {
      pushUnique(res.errors, { path: poolPath, message: "encounterPool must be an array." });
      continue;
    }
    for (let i = 0; i < pool.length; i++) {
      const row = pool[i];
      const rowPath = `${poolPath}[${i}]`;
      if (!isPlainObject(row)) {
        pushUnique(res.errors, { path: rowPath, message: "Encounter row must be an object." });
        continue;
      }
      const enemyId = row.enemyId;
      if (typeof enemyId !== "string" || !enemyId) {
        pushUnique(res.errors, { path: `${rowPath}.enemyId`, message: "enemyId must be a non-empty string." });
      } else if (!enemies[enemyId]) {
        pushUnique(res.errors, { path: `${rowPath}.enemyId`, message: `Unknown enemyId '${enemyId}'.` });
      }
      checkNonNegativeNumber(res, `${rowPath}.weight`, row.weight, "error");
    }
  }

  // Cross references: skills that grant actions -> actions
  for (const [sid, sk] of Object.entries(skills)) {
    if (!isPlainObject(sk)) continue;
    const grants = (sk as any).grantsActions;
    if (grants === undefined) continue;

    const grantsPath = `$.skills.${sid}.grantsActions`;
    if (!Array.isArray(grants)) {
      pushUnique(res.errors, { path: grantsPath, message: "grantsActions must be an array of action ids." });
      continue;
    }
    for (let i = 0; i < grants.length; i++) {
      const aId = grants[i];
      if (typeof aId !== "string" || !aId) {
        pushUnique(res.errors, { path: `${grantsPath}[${i}]`, message: "Must be a non-empty action id." });
      } else if (!actions[aId]) {
        pushUnique(res.errors, { path: `${grantsPath}[${i}]`, message: `Unknown action '${aId}'.` });
      }
    }
  }

  // Cross references: enemies optionally reference actions (future-proof)
  for (const [eid, en] of Object.entries(enemies)) {
    if (!isPlainObject(en)) continue;
    const maybeActionList = (en as any).actions ?? (en as any).actionIds;
    if (maybeActionList === undefined) continue;

    const p = `$.enemies.${eid}.${"actions" in (en as any) ? "actions" : "actionIds"}`;
    if (!Array.isArray(maybeActionList)) {
      pushUnique(res.warnings, { path: p, message: "Expected an array of action ids (if present)." });
      continue;
    }
    for (let i = 0; i < maybeActionList.length; i++) {
      const aId = maybeActionList[i];
      if (typeof aId !== "string" || !aId) {
        pushUnique(res.errors, { path: `${p}[${i}]`, message: "Must be a non-empty action id." });
      } else if (!actions[aId]) {
        pushUnique(res.errors, { path: `${p}[${i}]`, message: `Unknown action '${aId}'.` });
      }
    }
  }

  // Numeric sanity checks
  for (const [aid, a] of Object.entries(actions)) {
    if (!isPlainObject(a)) continue;
    const base = `$.actions.${aid}`;

    // Legacy fields should never be negative
    checkNonNegativeNumber(res, `${base}.damage`, (a as any).damage, "error");
    checkNonNegativeNumber(res, `${base}.heal`, (a as any).heal, "error");
    checkNonNegativeNumber(res, `${base}.focusCost`, (a as any).focusCost, "error");
    checkNonNegativeNumber(res, `${base}.focusGain`, (a as any).focusGain, "error");

    // Modern fields: allow negative deltas where they represent "take" or "wear".
    // But deltas must be numbers if present.
    for (const k of ["staminaDelta", "tensionDelta", "integrityDelta"] as const) {
      const v = (a as any)[k];
      if (v === undefined) continue;
      if (typeof v !== "number" || Number.isNaN(v)) {
        pushUnique(res.errors, { path: `${base}.${k}`, message: "Must be a number." });
      }
    }
  }

  for (const [iid, it] of Object.entries(items)) {
    if (!isPlainObject(it)) continue;
    const base = `$.items.${iid}`;
    checkNonNegativeNumber(res, `${base}.heal`, (it as any).heal, "error");
    checkNonNegativeNumber(res, `${base}.integrityRestore`, (it as any).integrityRestore, "error");
    checkNonNegativeNumber(res, `${base}.tensionReduce`, (it as any).tensionReduce, "error");
  }

  for (const [eid, en] of Object.entries(enemies)) {
    if (!isPlainObject(en)) continue;
    const base = `$.enemies.${eid}`;
    checkNonNegativeNumber(res, `${base}.xp`, (en as any).xp, "error");
    checkNonNegativeNumber(res, `${base}.stamina`, (en as any).stamina, "error");
    checkNonNegativeNumber(res, `${base}.pressure`, (en as any).pressure, "error");
    checkNonNegativeNumber(res, `${base}.maxHp`, (en as any).maxHp, "error");
    checkNonNegativeNumber(res, `${base}.attack`, (en as any).attack, "error");
  }

  // XP curve monotonic non-decreasing (using the current engine formula: base * growth^(level-1))
  const xpCurve = (input as any).xpCurve;
  if (!isPlainObject(xpCurve)) {
    pushUnique(res.errors, { path: "$.xpCurve", message: "xpCurve must be an object." });
  } else {
    checkNonNegativeNumber(res, "$.xpCurve.base", xpCurve.base, "error");
    if (typeof xpCurve.growth !== "number" || Number.isNaN(xpCurve.growth)) {
      pushUnique(res.errors, { path: "$.xpCurve.growth", message: "growth must be a number." });
    } else if (xpCurve.growth < 1) {
      pushUnique(res.errors, { path: "$.xpCurve.growth", message: "growth must be >= 1 (non-decreasing)." });
    }
  }

  // Narrow typing (not required for validation, but helps keep editor callers honest)
  void (input as ContentBundle);
  void ("" as Id);

  res.ok = res.errors.length === 0;
  return res;
}
