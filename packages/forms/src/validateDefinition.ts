/** Checks a form definition before it is saved or published. Messages are written for the form editor. */
import {
  formDefinitionSchema, type ConditionGroup, type DueRule, type FormDefinition, type RuleAction,
} from "./definition";
import { isValidOrderKey } from "./order";
import { conditionFieldKeys, isConditionGroup } from "./rules";
import { orderedFields, orderedSections } from "./sections";
import { isIsoDate } from "./values";

export type DefinitionError = { path: string; message: string };
export type DefinitionValidation = { ok: boolean; errors: DefinitionError[] };

type Target = { kind: "field" | "section"; key: string };

/** The field or section an action changes. */
export function actionTarget(a: RuleAction): Target {
  switch (a.kind) {
    case "show": case "hide": return a.target;
    case "require": case "optional": case "set_value": return { kind: "field", key: a.fieldKey };
    case "skip_section": case "assign": case "change_due": return { kind: "section", key: a.sectionKey };
  }
}

/** True when the action can change what a rule reads from the field: its value or its visibility. */
function changesFieldRead(a: RuleAction, fieldKey: string, sectionKey: string | undefined): boolean {
  if (a.kind === "set_value") return a.fieldKey === fieldKey;
  if (a.kind === "show" || a.kind === "hide") {
    return a.target.kind === "field" ? a.target.key === fieldKey : a.target.key === sectionKey;
  }
  if (a.kind === "skip_section") return a.sectionKey === sectionKey;
  return false;
}

function walkConditions(group: ConditionGroup, path: string, visit: (c: Exclude<ConditionGroup["conditions"][number], ConditionGroup>, path: string) => void): void {
  group.conditions.forEach((c, i) => {
    const p = `${path}.conditions.${i}`;
    if (isConditionGroup(c)) walkConditions(c, p, visit);
    else visit(c, p);
  });
}

export function validateDefinition(input: unknown): DefinitionValidation {
  const parsed = formDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const def: FormDefinition = parsed.data;
  const errors: DefinitionError[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });

  const roleKeys = new Set<string>();
  def.roles.forEach((r, i) => {
    if (roleKeys.has(r.key)) add(`roles.${i}.key`, `The role key "${r.key}" is used more than once`);
    roleKeys.add(r.key);
  });

  const sectionKeys = new Set<string>();
  const fieldTypes = new Map<string, string>();
  const fieldSection = new Map<string, string>();
  def.sections.forEach((s, si) => {
    if (sectionKeys.has(s.key)) add(`sections.${si}.key`, `The section key "${s.key}" is used more than once`);
    sectionKeys.add(s.key);
    s.fields.forEach((f, fi) => {
      if (fieldTypes.has(f.key)) add(`sections.${si}.fields.${fi}.key`, `The field key "${f.key}" is used more than once`);
      else { fieldTypes.set(f.key, f.type); fieldSection.set(f.key, s.key); }
    });
  });

  const checkDueRule = (rule: DueRule, path: string) => {
    if (rule.from !== "date_field") return;
    if (!rule.fieldKey) add(`${path}.fieldKey`, "Choose the date field this due date counts from");
    else if (fieldTypes.get(rule.fieldKey) !== "date") add(`${path}.fieldKey`, `The due date must count from a date field, and "${rule.fieldKey}" is not one`);
  };

  def.roles.forEach((r, ri) => {
    r.resolution.forEach((src, i) => {
      if (src.kind === "person_field" && fieldTypes.get(src.fieldKey) !== "person") {
        add(`roles.${ri}.resolution.${i}.fieldKey`, `The role "${r.label}" must read a person field, and "${src.fieldKey}" is not one`);
      }
    });
  });

  def.sections.forEach((s, si) => {
    const sp = `sections.${si}`;
    if (!isValidOrderKey(s.order)) add(`${sp}.order`, "The order key uses characters outside 0-9, A-Z, and a-z");
    if (!roleKeys.has(s.ownerRole)) add(`${sp}.ownerRole`, `The section "${s.title}" is owned by the role "${s.ownerRole}", which does not exist`);
    if (s.completionRule.type === "minimum" && !s.completionRule.count) add(`${sp}.completionRule.count`, "A minimum completion rule needs a count");
    if (s.dueRule) checkDueRule(s.dueRule, `${sp}.dueRule`);
    s.fields.forEach((f, fi) => {
      const fp = `${sp}.fields.${fi}`;
      const o = f.options;
      if (!isValidOrderKey(f.order)) add(`${fp}.order`, "The order key uses characters outside 0-9, A-Z, and a-z");
      if (f.type === "signature") add(`${fp}.type`, "Signature fields are not available yet");
      if ((f.type === "single_choice" || f.type === "multiple_choice")) {
        if (!o.choices || o.choices.length === 0) add(`${fp}.options.choices`, `The field "${f.label}" needs at least one choice`);
        else {
          const seen = new Set<string>();
          for (const c of o.choices) {
            if (seen.has(c.value)) add(`${fp}.options.choices`, `The choice value "${c.value}" is used more than once`);
            seen.add(c.value);
          }
        }
      }
      if (o.minLength !== undefined && o.maxLength !== undefined && o.minLength > o.maxLength) add(`${fp}.options.minLength`, "The minimum length is larger than the maximum length");
      if (o.min !== undefined && o.max !== undefined && o.min > o.max) add(`${fp}.options.min`, "The minimum is larger than the maximum");
      if (o.minSelections !== undefined && o.maxSelections !== undefined && o.minSelections > o.maxSelections) add(`${fp}.options.minSelections`, "The minimum number of selections is larger than the maximum");
      if (o.pattern === "custom") {
        if (!o.regex) add(`${fp}.options.regex`, "A custom pattern needs a regular expression");
        else { try { new RegExp(o.regex); } catch { add(`${fp}.options.regex`, "The regular expression is not valid"); } }
      }
      for (const bound of ["earliest", "latest"] as const) {
        const v = o[bound];
        if (v === undefined) continue;
        if (v.startsWith("field:")) {
          const ref = v.slice(6);
          if (fieldTypes.get(ref) !== "date") add(`${fp}.options.${bound}`, `The ${bound} date must refer to a date field, and "${ref}" is not one`);
        } else if (!isIsoDate(v)) add(`${fp}.options.${bound}`, `The ${bound} date must be a date such as 2026-10-12`);
      }
      f.visibleToRoles.forEach((rk, i) => {
        if (!roleKeys.has(rk)) add(`${fp}.visibleToRoles.${i}`, `The role "${rk}" does not exist`);
      });
    });
  });

  // Rule references, then guard 1 (rules read only earlier fields), then rule order, then guard 2 (no loops).
  const positions = new Map(orderedFields(def).map((p) => [p.field.key, p]));
  const sectionIndex = new Map(orderedSections(def).map((s, i) => [s.key, i]));
  const ruleIds = new Set<string>();
  def.rules.forEach((rule, ri) => {
    const rp = `rules.${ri}`;
    const name = rule.label ?? rule.id;
    if (ruleIds.has(rule.id)) add(`${rp}.id`, `The rule id "${rule.id}" is used more than once`);
    ruleIds.add(rule.id);
    walkConditions(rule.when, `${rp}.when`, (c, cp) => {
      if (c.source.kind === "field" && !fieldTypes.has(c.source.key)) add(`${cp}.source.key`, `The rule "${name}" reads the field "${c.source.key}", which does not exist`);
      if (c.op === "is_one_of" && (!Array.isArray(c.value) || c.value.length === 0)) add(`${cp}.value`, `The rule "${name}" needs at least one value for "is one of"`);
    });
    const reads = conditionFieldKeys(rule.when).filter((k) => fieldTypes.has(k));
    rule.then.forEach((a, ai) => {
      const ap = `${rp}.then.${ai}`;
      const t = actionTarget(a);
      if (t.kind === "field" && !fieldTypes.has(t.key)) { add(ap, `The rule "${name}" changes the field "${t.key}", which does not exist`); return; }
      if (t.kind === "section" && !sectionKeys.has(t.key)) { add(ap, `The rule "${name}" changes the section "${t.key}", which does not exist`); return; }
      if (a.kind === "assign" && !roleKeys.has(a.roleKey)) add(`${ap}.roleKey`, `The rule "${name}" assigns the role "${a.roleKey}", which does not exist`);
      if (a.kind === "change_due") checkDueRule(a.dueRule, `${ap}.dueRule`);
      for (const k of reads) {
        const from = positions.get(k)!;
        const ok = t.kind === "field" ? from.index < positions.get(t.key)!.index : from.sectionIndex < sectionIndex.get(t.key)!;
        if (!ok) {
          add(ap, t.kind === "field"
            ? `The rule "${name}" reads "${k}", which comes after or at the field "${t.key}" it changes. A rule may only read fields that come before its target`
            : `The rule "${name}" reads "${k}", which is not in a section before "${t.key}". A rule may only read fields in earlier sections when it changes a section`);
        }
      }
    });
    for (const k of reads) {
      for (let later = ri + 1; later < def.rules.length; later++) {
        const other = def.rules[later]!;
        if (other.then.some((a) => changesFieldRead(a, k, fieldSection.get(k)))) {
          add(rp, `The rule "${name}" reads "${k}", which the later rule "${other.label ?? other.id}" changes. Move "${name}" below that rule`);
        }
      }
    }
  });

  const cycle = findRuleCycle(def);
  if (cycle) add("rules", `These rules depend on each other in a loop: ${cycle.join(" then ")}`);

  return { ok: errors.length === 0, errors };
}

/** A loop in rule dependencies as a list of field and section keys, or null. */
export function findRuleCycle(def: FormDefinition): string[] | null {
  const edges = new Map<string, Set<string>>();
  const edge = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a)!.add(b);
  };
  for (const s of def.sections) for (const f of s.fields) edge(`section ${s.key}`, `field ${f.key}`);
  for (const rule of def.rules) {
    const reads = conditionFieldKeys(rule.when);
    for (const a of rule.then) {
      const t = actionTarget(a);
      for (const k of reads) edge(`field ${k}`, `${t.kind} ${t.key}`);
    }
  }
  const color = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    color.set(n, 1);
    stack.push(n);
    for (const m of edges.get(n) ?? []) {
      const c = color.get(m);
      if (c === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (c === undefined) { const found = visit(m); if (found) return found; }
    }
    stack.pop();
    color.set(n, 2);
    return null;
  };
  for (const n of edges.keys()) {
    if (!color.has(n)) { const found = visit(n); if (found) return found; }
  }
  return null;
}
