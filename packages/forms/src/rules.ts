/** The rule engine. Pure: the same inputs always give the same evaluation. */
import type {
  AppRole, Answers, Condition, ConditionGroup, DueRule, FieldDef, FieldType, FormDefinition, Operator,
} from "./definition";
import { orderedFields, orderedSections } from "./sections";
import { isEmptyValue, normalizeText, toBoolean, toNumber, toTime } from "./values";

export type EvaluationContext = {
  starterRole?: AppRole;
  versionNumber?: number;
  createdAt?: Date;
  now: Date;
  timeZone: string;
};

export type Evaluation = {
  /** False for fields hidden by a rule, hidden by default, or inside a hidden or skipped section. */
  fieldVisible: Record<string, boolean>;
  /** True only for visible fields that are required after the rules run. */
  fieldRequired: Record<string, boolean>;
  sectionVisible: Record<string, boolean>;
  skippedSections: string[];
  assignments: Record<string, string>;
  dueRules: Record<string, DueRule | undefined>;
  setValues: Record<string, unknown>;
  answers: Answers;
};

export type ValueKind = "text" | "number" | "date" | "boolean" | "list";

function kindOfField(type: FieldType | "signature" | undefined, value: unknown): ValueKind {
  switch (type) {
    case "number": return "number";
    case "date": return "date";
    case "yes_no": return "boolean";
    case "multiple_choice":
    case "file_upload": return "list";
    case "person": return Array.isArray(value) ? "list" : "text";
    default: return Array.isArray(value) ? "list" : "text";
  }
}

function scalarEquals(kind: ValueKind, a: unknown, b: unknown): boolean {
  if (kind === "number") {
    const x = toNumber(a), y = toNumber(b);
    return x !== null && y !== null && x === y;
  }
  if (kind === "date") {
    const x = toTime(a), y = toTime(b);
    return x !== null && y !== null && x === y;
  }
  if (kind === "boolean") {
    const x = toBoolean(a), y = toBoolean(b);
    return x !== null && x === y;
  }
  return normalizeText(a) === normalizeText(b);
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isEmptyValue(value) ? [] : [value];
}

function compareOrdered(kind: ValueKind, a: unknown, b: unknown): number | null {
  if (kind === "date") {
    const x = toTime(a), y = toTime(b);
    return x === null || y === null ? null : x - y;
  }
  const x = toNumber(a), y = toNumber(b);
  return x === null || y === null ? null : x - y;
}

/** Applies one operator to an actual value, using the field type to pick text, number, date, yes/no, or list rules. */
export function applyOperator(op: Operator, kind: ValueKind, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "is_empty": return isEmptyValue(actual);
    case "is_not_empty": return !isEmptyValue(actual);
    case "equals":
    case "not_equals": {
      let eq: boolean;
      if (kind === "list") {
        const a = asList(actual).map(normalizeText), e = asList(expected).map(normalizeText);
        eq = a.length === e.length && e.every((v) => a.includes(v));
      } else {
        eq = !isEmptyValue(actual) && scalarEquals(kind, actual, expected);
      }
      return op === "equals" ? eq : !eq;
    }
    case "contains": {
      if (isEmptyValue(actual)) return false;
      if (Array.isArray(actual)) {
        const a = actual.map(normalizeText);
        return asList(expected).every((v) => a.includes(normalizeText(v)));
      }
      const needle = normalizeText(expected);
      return needle !== "" && normalizeText(actual).includes(needle);
    }
    case "is_one_of": {
      if (isEmptyValue(actual)) return false;
      const options = asList(expected);
      if (Array.isArray(actual)) return actual.some((a) => options.some((o) => scalarEquals("text", a, o)));
      return options.some((o) => scalarEquals(kind === "list" ? "text" : kind, actual, o));
    }
    case "gt": case "after": { const c = compareOrdered(op === "after" ? "date" : kind, actual, expected); return c !== null && c > 0; }
    case "lt": case "before": { const c = compareOrdered(op === "before" ? "date" : kind, actual, expected); return c !== null && c < 0; }
    case "gte": { const c = compareOrdered(kind, actual, expected); return c !== null && c >= 0; }
    case "lte": { const c = compareOrdered(kind, actual, expected); return c !== null && c <= 0; }
  }
}

export function isConditionGroup(c: Condition | ConditionGroup): c is ConditionGroup {
  return (c as ConditionGroup).combinator !== undefined;
}

export type ConditionReader = (c: Condition) => { kind: ValueKind; value: unknown };

export function evaluateGroup(group: ConditionGroup, read: ConditionReader): boolean {
  const results = group.conditions.map((c) => {
    if (isConditionGroup(c)) return evaluateGroup(c, read);
    const { kind, value } = read(c);
    return applyOperator(c.op, kind, value, c.value);
  });
  return group.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
}

/** Field keys a condition group reads, nested groups included. */
export function conditionFieldKeys(group: ConditionGroup): string[] {
  const keys: string[] = [];
  for (const c of group.conditions) {
    if (isConditionGroup(c)) keys.push(...conditionFieldKeys(c));
    else if (c.source.kind === "field") keys.push(c.source.key);
  }
  return keys;
}

/**
 * Runs the rules once, in definition order. Rules read hidden fields as empty, and set_value
 * results are visible to later rules. validateDefinition makes this single pass complete.
 */
export function evaluate(def: FormDefinition, answers: Answers, context: EvaluationContext): Evaluation {
  const positioned = orderedFields(def);
  const sections = orderedSections(def);
  const fieldsByKey = new Map<string, FieldDef>(positioned.map((p) => [p.field.key, p.field]));
  const sectionOf = new Map<string, string>(positioned.map((p) => [p.field.key, p.section.key]));

  const ownVisible: Record<string, boolean> = {};
  const required: Record<string, boolean> = {};
  for (const { field } of positioned) {
    ownVisible[field.key] = !field.hiddenByDefault;
    required[field.key] = field.required && field.type !== "content";
  }
  const sectionVisible: Record<string, boolean> = {};
  const assignments: Record<string, string> = {};
  const dueRules: Record<string, DueRule | undefined> = {};
  for (const s of sections) {
    sectionVisible[s.key] = true;
    assignments[s.key] = s.ownerRole;
    dueRules[s.key] = s.dueRule;
  }
  const skipped = new Set<string>();
  const current: Answers = { ...answers };
  const setValues: Record<string, unknown> = {};

  const visibleNow = (key: string): boolean => {
    const sk = sectionOf.get(key);
    return ownVisible[key] === true && sk !== undefined && sectionVisible[sk] === true && !skipped.has(sk);
  };

  const read: ConditionReader = (c) => {
    if (c.source.kind === "meta") {
      if (c.source.key === "starter_role") return { kind: "text", value: context.starterRole };
      if (c.source.key === "version") return { kind: "number", value: context.versionNumber };
      return { kind: "date", value: context.createdAt ? context.createdAt.toISOString() : undefined };
    }
    const field = fieldsByKey.get(c.source.key);
    const value = field && visibleNow(field.key) ? current[c.source.key] : undefined;
    return { kind: kindOfField(field?.type, value), value };
  };

  for (const rule of def.rules) {
    if (!evaluateGroup(rule.when, read)) continue;
    for (const a of rule.then) {
      switch (a.kind) {
        case "show":
        case "hide":
          if (a.target.kind === "field") ownVisible[a.target.key] = a.kind === "show";
          else sectionVisible[a.target.key] = a.kind === "show";
          break;
        case "require": required[a.fieldKey] = true; break;
        case "optional": required[a.fieldKey] = false; break;
        case "set_value": current[a.fieldKey] = a.value; setValues[a.fieldKey] = a.value; break;
        case "skip_section": skipped.add(a.sectionKey); break;
        case "assign": assignments[a.sectionKey] = a.roleKey; break;
        case "change_due": dueRules[a.sectionKey] = a.dueRule; break;
      }
    }
  }

  const fieldVisible: Record<string, boolean> = {};
  const fieldRequired: Record<string, boolean> = {};
  for (const { field } of positioned) {
    fieldVisible[field.key] = visibleNow(field.key);
    fieldRequired[field.key] = fieldVisible[field.key]! && required[field.key] === true;
  }
  return {
    fieldVisible, fieldRequired, sectionVisible,
    skippedSections: sections.filter((s) => skipped.has(s.key)).map((s) => s.key),
    assignments, dueRules, setValues, answers: current,
  };
}
