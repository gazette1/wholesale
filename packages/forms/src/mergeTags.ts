/** Merge tags such as {{form.first_name}} in content fields, emails, and defaults. */
import type { Answers, FormDefinition } from "./definition";

export type MergeTagOptions = {
  /** Display labels per field key and stored value, for choice fields. */
  labels?: Record<string, Record<string, string>>;
  /** Escape HTML in replaced values. On by default. */
  escapeHtml?: boolean;
};

const TAG_RE = /\{\{\s*form\.([a-z][a-z0-9_]*)\s*\}\}/g;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function display(value: unknown, labels: Record<string, string> | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return labels?.[value] ?? value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (Array.isArray(value)) return value.map((v) => display(v, labels)).filter((s) => s !== "").join(", ");
  return "";
}

export function renderMergeTags(template: string, answers: Answers, opts: MergeTagOptions = {}): string {
  const escape = opts.escapeHtml !== false;
  return template.replace(TAG_RE, (_m, key: string) => {
    const text = display(answers[key], opts.labels?.[key]);
    return escape ? escapeHtml(text) : text;
  });
}

/** Field keys used by merge tags in a template. */
export function mergeTagKeys(template: string): string[] {
  return [...new Set([...template.matchAll(TAG_RE)].map((m) => m[1]!))];
}

/** Choice labels from a definition, ready for renderMergeTags. */
export function choiceLabels(def: Pick<FormDefinition, "sections">): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of def.sections) for (const f of s.fields) {
    if (f.options.choices) out[f.key] = Object.fromEntries(f.options.choices.map((c) => [c.value, c.label]));
  }
  return out;
}
