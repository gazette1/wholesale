/** Pure helpers that change a form definition for the editor. Each returns a new definition. */
import {
  keyBetween, keysBetween, sortByOrder, APP_ROLES,
  type FieldDef, type FieldType, type FormDefinition, type RoleDef, type RuleAction, type SectionDef, type ConditionGroup, type Condition, type Rule,
} from "@dealcalc/forms";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Short text", long_text: "Long text", number: "Number", date: "Date", single_choice: "Single choice",
  multiple_choice: "Multiple choice", yes_no: "Yes or no", person: "Person", file_upload: "File upload", content: "Content (display only)",
};

export const ROLE_LABELS: Record<(typeof APP_ROLES)[number], string> = { admin: "Admin", acquisitions: "Acquisitions", dispositions: "Dispositions", viewer: "Viewer" };

export function emptyDefinition(): FormDefinition {
  return { schemaVersion: 1, roles: [], sections: [], rules: [] };
}

/** Parses a stored draft without throwing. Returns null when the draft cannot be read. */
export function safeClone(def: FormDefinition): FormDefinition {
  return JSON.parse(JSON.stringify(def)) as FormDefinition;
}

export function slugKey(label: string, taken: Set<string>, fallback: string): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!/^[a-z]/.test(base)) base = base ? `${fallback}_${base}` : fallback;
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

export function allFieldKeys(def: FormDefinition): Set<string> {
  return new Set(def.sections.flatMap((s) => s.fields.map((f) => f.key)));
}
export function allSectionKeys(def: FormDefinition): Set<string> {
  return new Set(def.sections.map((s) => s.key));
}

export function findFieldLocation(def: FormDefinition, key: string): { section: SectionDef; field: FieldDef } | null {
  for (const s of def.sections) {
    const f = s.fields.find((x) => x.key === key);
    if (f) return { section: s, field: f };
  }
  return null;
}

function lastOrder(items: { order: string }[]): string | null {
  const sorted = sortByOrder(items);
  return sorted.length ? sorted[sorted.length - 1]!.order : null;
}

/* ------------------------------- roles ------------------------------- */

export function addRole(def: FormDefinition, label: string): { def: FormDefinition; key: string } {
  const key = slugKey(label, new Set(def.roles.map((r) => r.key)), "role");
  const role: RoleDef = { key, label, resolution: [{ kind: "subject_owner" }] };
  return { def: { ...def, roles: [...def.roles, role] }, key };
}

export function ensureRole(def: FormDefinition): { def: FormDefinition; key: string } {
  if (def.roles.length) return { def, key: def.roles[0]!.key };
  return addRole(def, "Owner");
}

/* ------------------------------ sections ------------------------------ */

export function addSection(def: FormDefinition): { def: FormDefinition; key: string } {
  const withRole = ensureRole(def);
  const taken = allSectionKeys(withRole.def);
  const key = slugKey(`step ${withRole.def.sections.length + 1}`, taken, "section");
  const section: SectionDef = {
    key, title: `Section ${withRole.def.sections.length + 1}`, order: keyBetween(lastOrder(withRole.def.sections), null),
    ownerRole: withRole.key, completionRule: { type: "any" }, needsApproval: false, skippable: false, stopPoint: false, allowExternal: false, fields: [],
  };
  return { def: { ...withRole.def, sections: [...withRole.def.sections, section] }, key };
}

export function updateSection(def: FormDefinition, key: string, patch: Partial<SectionDef>): FormDefinition {
  return { ...def, sections: def.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

export function deleteSection(def: FormDefinition, key: string): FormDefinition {
  return { ...def, sections: def.sections.filter((s) => s.key !== key) };
}

function orderBetweenSiblings<T extends { order: string }>(siblings: T[], index: number): string {
  // siblings exclude the moved item and are sorted; index is the insertion position.
  const prev = index > 0 ? siblings[index - 1]!.order : null;
  const next = index < siblings.length ? siblings[index]!.order : null;
  return keyBetween(prev, next);
}

/** Moves a section so it sits at insertion index `toIndex` among the other sections. */
export function moveSectionTo(def: FormDefinition, key: string, toIndex: number): FormDefinition {
  const others = sortByOrder(def.sections.filter((s) => s.key !== key));
  const idx = Math.max(0, Math.min(toIndex, others.length));
  let order: string;
  try { order = orderBetweenSiblings(others, idx); } catch { return rekeySections(def, key, idx); }
  return { ...def, sections: def.sections.map((s) => (s.key === key ? { ...s, order } : s)) };
}

function rekeySections(def: FormDefinition, key: string, idx: number): FormDefinition {
  const moved = def.sections.find((s) => s.key === key);
  if (!moved) return def;
  const list = sortByOrder(def.sections.filter((s) => s.key !== key));
  list.splice(idx, 0, moved);
  const orders = keysBetween(null, null, list.length);
  const byKey = new Map(list.map((s, i) => [s.key, orders[i]!]));
  return { ...def, sections: def.sections.map((s) => ({ ...s, order: byKey.get(s.key)! })) };
}

export function moveSectionBy(def: FormDefinition, key: string, delta: -1 | 1): FormDefinition {
  const sorted = sortByOrder(def.sections);
  const i = sorted.findIndex((s) => s.key === key);
  const target = i + delta;
  if (i < 0 || target < 0 || target >= sorted.length) return def;
  return moveSectionTo(def, key, target);
}

/* ------------------------------- fields ------------------------------- */

export function defaultOptionsFor(type: FieldType): FieldDef["options"] {
  if (type === "single_choice") return { choices: [{ value: "option_1", label: "Option 1" }, { value: "option_2", label: "Option 2" }], display: "dropdown" };
  if (type === "multiple_choice") return { choices: [{ value: "option_1", label: "Option 1" }, { value: "option_2", label: "Option 2" }], display: "checkboxes" };
  return {};
}

export function addField(def: FormDefinition, sectionKey: string, type: FieldType = "short_text"): { def: FormDefinition; key: string } {
  const section = def.sections.find((s) => s.key === sectionKey);
  if (!section) return { def, key: "" };
  const label = `New ${FIELD_TYPE_LABELS[type].toLowerCase().replace(" (display only)", "")}`;
  const key = slugKey(label, allFieldKeys(def), "field");
  const field: FieldDef = {
    key, type, label, order: keyBetween(lastOrder(section.fields), null), required: false, readOnly: false, hiddenByDefault: false,
    visibleToRoles: [], visibleToExternal: false, unique: false, options: defaultOptionsFor(type),
  };
  return { def: updateSection(def, sectionKey, { fields: [...section.fields, field] }), key };
}

export function updateField(def: FormDefinition, key: string, patch: Partial<FieldDef>): FormDefinition {
  return { ...def, sections: def.sections.map((s) => (s.fields.some((f) => f.key === key) ? { ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) } : s)) };
}

export function deleteField(def: FormDefinition, key: string): FormDefinition {
  return { ...def, sections: def.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) })) };
}

/** Moves a field into `toSectionKey` at insertion index `toIndex` among that section's other fields. */
export function moveFieldTo(def: FormDefinition, key: string, toSectionKey: string, toIndex: number): FormDefinition {
  const loc = findFieldLocation(def, key);
  const target = def.sections.find((s) => s.key === toSectionKey);
  if (!loc || !target) return def;
  const others = sortByOrder(target.fields.filter((f) => f.key !== key));
  const idx = Math.max(0, Math.min(toIndex, others.length));
  let order: string;
  let rekey: Map<string, string> | null = null;
  try { order = orderBetweenSiblings(others, idx); } catch {
    const list = [...others];
    list.splice(idx, 0, loc.field);
    const orders = keysBetween(null, null, list.length);
    rekey = new Map(list.map((f, i) => [f.key, orders[i]!]));
    order = rekey.get(key)!;
  }
  const moved: FieldDef = { ...loc.field, order };
  return {
    ...def,
    sections: def.sections.map((s) => {
      let fields = s.fields.filter((f) => f.key !== key);
      if (s.key === toSectionKey) {
        fields = [...fields, moved];
        if (rekey) fields = fields.map((f) => ({ ...f, order: rekey!.get(f.key) ?? f.order }));
      }
      return { ...s, fields };
    }),
  };
}

export function moveFieldBy(def: FormDefinition, key: string, delta: -1 | 1): FormDefinition {
  const loc = findFieldLocation(def, key);
  if (!loc) return def;
  const sorted = sortByOrder(loc.section.fields);
  const i = sorted.findIndex((f) => f.key === key);
  const target = i + delta;
  if (target < 0 || target >= sorted.length) return def;
  return moveFieldTo(def, key, loc.section.key, target);
}

/* --------------------------- renaming a field key --------------------------- */

function renameInGroup(group: ConditionGroup, from: string, to: string): ConditionGroup {
  return {
    ...group,
    conditions: group.conditions.map((c) => {
      if ((c as ConditionGroup).combinator !== undefined) return renameInGroup(c as ConditionGroup, from, to);
      const cond = c as Condition;
      return cond.source.kind === "field" && cond.source.key === from ? { ...cond, source: { kind: "field" as const, key: to } } : cond;
    }),
  };
}

function renameInAction(a: RuleAction, from: string, to: string): RuleAction {
  const fix = (k: string) => (k === from ? to : k);
  switch (a.kind) {
    case "show": case "hide": return a.target.kind === "field" ? { ...a, target: { kind: "field", key: fix(a.target.key) } } : a;
    case "require": case "optional": return { ...a, fieldKey: fix(a.fieldKey) };
    case "set_value": return { ...a, fieldKey: fix(a.fieldKey) };
    case "change_due": return { ...a, dueRule: a.dueRule.fieldKey ? { ...a.dueRule, fieldKey: fix(a.dueRule.fieldKey) } : a.dueRule };
    default: return a;
  }
}

/** Renames a field key and every reference to it in rules, due rules, roles, and date bounds. */
export function renameFieldKey(def: FormDefinition, from: string, to: string): FormDefinition {
  if (from === to) return def;
  return {
    ...def,
    roles: def.roles.map((r) => ({ ...r, resolution: r.resolution.map((src) => (src.kind === "person_field" && src.fieldKey === from ? { ...src, fieldKey: to } : src)) })),
    sections: def.sections.map((s) => ({
      ...s,
      dueRule: s.dueRule?.fieldKey === from ? { ...s.dueRule, fieldKey: to } : s.dueRule,
      fields: s.fields.map((f) => {
        const o = { ...f.options };
        if (o.earliest === `field:${from}`) o.earliest = `field:${to}`;
        if (o.latest === `field:${from}`) o.latest = `field:${to}`;
        return f.key === from ? { ...f, key: to, options: o } : { ...f, options: o };
      }),
    })),
    rules: def.rules.map((r) => ({ ...r, when: renameInGroup(r.when, from, to), then: r.then.map((a) => renameInAction(a, from, to)) })),
  };
}

/* ---------------------------------- rules ---------------------------------- */

export function newRuleId(def: FormDefinition): string {
  const used = new Set(def.rules.map((r) => r.id));
  let n = def.rules.length + 1;
  while (used.has(`rule_${n}`)) n++;
  return `rule_${n}`;
}

export function newRule(def: FormDefinition): Rule {
  const first = def.sections.flatMap((s) => sortByOrder(s.fields))[0];
  const cond: Condition = { source: first ? { kind: "field", key: first.key } : { kind: "meta", key: "starter_role" }, op: "is_not_empty" };
  const last = def.sections.flatMap((s) => sortByOrder(s.fields)).filter((f) => f.key !== first?.key).pop();
  const then: RuleAction[] = [last ? { kind: "show", target: { kind: "field", key: last.key } } : { kind: "show", target: { kind: "section", key: def.sections[0]?.key ?? "section_1" } }];
  return { id: newRuleId(def), when: { combinator: "and", conditions: [cond] }, then };
}

export function pathKey(path: string): { section?: number; field?: number; rule?: number } {
  const s = /sections\.(\d+)/.exec(path);
  const f = /fields\.(\d+)/.exec(path);
  const r = /^rules\.(\d+)/.exec(path);
  return { section: s ? Number(s[1]) : undefined, field: f ? Number(f[1]) : undefined, rule: r ? Number(r[1]) : undefined };
}

/* ------------------------------ drag and drop ------------------------------ */

export function applyDrop(
  def: FormDefinition,
  item: { kind: "section" | "field"; id: string },
  target: { kind: "section" | "field"; id: string; after: boolean },
): FormDefinition {
  if (item.kind === "section") {
    if (target.kind !== "section") return def;
    const others = sortByOrder(def.sections.filter((s) => s.key !== item.id));
    const i = others.findIndex((s) => s.key === target.id);
    if (i < 0) return def;
    return moveSectionTo(def, item.id, i + (target.after ? 1 : 0));
  }
  if (target.kind === "section") {
    const section = def.sections.find((s) => s.key === target.id);
    if (!section) return def;
    return moveFieldTo(def, item.id, section.key, section.fields.filter((f) => f.key !== item.id).length);
  }
  const loc = findFieldLocation(def, target.id);
  if (!loc) return def;
  const others = sortByOrder(loc.section.fields.filter((f) => f.key !== item.id));
  const i = others.findIndex((f) => f.key === target.id);
  if (i < 0) return def;
  return moveFieldTo(def, item.id, loc.section.key, i + (target.after ? 1 : 0));
}
