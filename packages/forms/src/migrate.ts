/** Moves a submission's answers from one definition version to another by stable field key. */
import type { Answers, FieldDef, FormDefinition } from "./definition";
import { findField } from "./sections";
import { isIsoDate, isUuid, toNumber } from "./values";

export type MigrationResult = { answers: Answers; retired: Record<string, unknown> };

const NOT_COMPATIBLE = Symbol("not compatible");

/** The value converted for the new field type, or NOT_COMPATIBLE. */
function convert(value: unknown, to: FieldDef): unknown {
  const choices = to.options.choices ?? [];
  const isChoice = (v: unknown) => typeof v === "string" && (to.options.allowOther === true || choices.some((c) => c.value === v));
  switch (to.type) {
    case "short_text":
    case "long_text":
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      return NOT_COMPATIBLE;
    case "number": {
      const n = toNumber(value);
      return n === null ? NOT_COMPATIBLE : n;
    }
    case "date":
      return isIsoDate(value, to.options.withTime === true) ? value : NOT_COMPATIBLE;
    case "single_choice":
      if (Array.isArray(value)) return value.length === 1 && isChoice(value[0]) ? value[0] : NOT_COMPATIBLE;
      return isChoice(value) ? value : NOT_COMPATIBLE;
    case "multiple_choice": {
      const list = Array.isArray(value) ? value : [value];
      return list.every(isChoice) ? list : NOT_COMPATIBLE;
    }
    case "yes_no":
      return typeof value === "boolean" ? value : NOT_COMPATIBLE;
    case "person":
      if (to.options.multiple) {
        const list = Array.isArray(value) ? value : [value];
        return list.every(isUuid) ? list : NOT_COMPATIBLE;
      }
      if (Array.isArray(value)) return value.length === 1 && isUuid(value[0]) ? value[0] : NOT_COMPATIBLE;
      return isUuid(value) ? value : NOT_COMPATIBLE;
    case "file_upload":
      return Array.isArray(value) && value.every(isUuid) ? value : NOT_COMPATIBLE;
    case "content":
    case "signature":
      return NOT_COMPATIBLE;
  }
}

/**
 * Keeps answers whose key exists in the new definition, wherever the field moved.
 * Answers for removed keys, and answers that cannot be read as the new field type, go to retired.
 * New fields stay empty; defaults are not applied.
 */
export function migrateAnswers(fromDef: FormDefinition, toDef: FormDefinition, answers: Answers): MigrationResult {
  const out: Answers = {};
  const retired: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined) continue;
    const to = findField(toDef, key);
    if (!to) { retired[key] = value; continue; }
    const from = findField(fromDef, key);
    if (value === null || (from && from.type === to.type && sameShape(from, to))) { out[key] = value; continue; }
    const converted = convert(value, to);
    if (converted === NOT_COMPATIBLE) retired[key] = value;
    else out[key] = converted;
  }
  return { answers: out, retired };
}

function sameShape(from: FieldDef, to: FieldDef): boolean {
  if (to.type === "person") return (from.options.multiple === true) === (to.options.multiple === true);
  if (to.type !== "single_choice" && to.type !== "multiple_choice") return true;
  if (to.options.allowOther) return true;
  const allowed = new Set((to.options.choices ?? []).map((c) => c.value));
  return (from.options.choices ?? []).every((c) => allowed.has(c.value));
}
