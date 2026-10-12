/** Answer validation, run as people type and again on the server before a section completes. */
import type { Answers, FieldDef, FormDefinition } from "./definition";
import { evaluate, type EvaluationContext } from "./rules";
import { orderedSections } from "./sections";
import { sortByOrder } from "./order";
import { formatDay, isEmptyValue, isIsoDate, isUuid, isoDay, toNumber, weekdayOf } from "./values";

export type FieldError = { fieldKey: string; message: string };
export type SectionValidation = { ok: boolean; errors: FieldError[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Ten US digits after removing everything else; a leading country code 1 is allowed. */
export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function decimalPlaces(n: number): number {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Format checks for one non empty answer. Returns a plain message, or null when the value is acceptable.
 * Empty values pass here; requiredness is checked by validateSection.
 * Cross field check: a date field whose earliest option is "field:<key>" must be after that field's date.
 */
export function validateAnswer(field: FieldDef, value: unknown, answers: Answers = {}): string | null {
  if (isEmptyValue(value)) return null;
  const o = field.options;
  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") return "Enter text";
      const len = value.trim().length;
      if (o.minLength !== undefined && len < o.minLength) return `Enter at least ${plural(o.minLength, "character")}`;
      if (o.maxLength !== undefined && len > o.maxLength) return `Enter no more than ${plural(o.maxLength, "character")}`;
      if (field.type === "long_text") return null;
      if (o.pattern === "email" && !isValidEmail(value)) return "Enter a valid email address";
      if (o.pattern === "phone" && !isValidPhone(value)) return "Enter a 10 digit phone number";
      if (o.pattern === "url" && !isValidUrl(value)) return "Enter a web address that starts with http:// or https://";
      if (o.pattern === "custom" && o.regex) {
        let re: RegExp | null = null;
        try { re = new RegExp(o.regex); } catch { re = null; }
        if (re && !re.test(value)) return "Enter a value in the expected format";
      }
      return null;
    }
    case "number": {
      const n = toNumber(value);
      if (n === null) return "Enter a number";
      if (o.min !== undefined && n < o.min) return `Enter a number no smaller than ${o.min}`;
      if (o.max !== undefined && n > o.max) return `Enter a number no larger than ${o.max}`;
      if (o.decimals !== undefined && decimalPlaces(n) > o.decimals) {
        return o.decimals === 0 ? "Enter a whole number" : `Enter a number with no more than ${plural(o.decimals, "decimal place")}`;
      }
      return null;
    }
    case "date": {
      if (!isIsoDate(value, o.withTime === true)) return "Enter a valid date";
      const day = isoDay(value);
      if (o.earliest) {
        if (o.earliest.startsWith("field:")) {
          const other = answers[o.earliest.slice(6)];
          if (isIsoDate(other, true) && day <= isoDay(other)) return `Enter a date after ${formatDay(other)}`;
        } else if (isIsoDate(o.earliest) && day < o.earliest) return `Enter a date on or after ${formatDay(o.earliest)}`;
      }
      if (o.latest) {
        if (o.latest.startsWith("field:")) {
          const other = answers[o.latest.slice(6)];
          if (isIsoDate(other, true) && day >= isoDay(other)) return `Enter a date before ${formatDay(other)}`;
        } else if (isIsoDate(o.latest) && day > o.latest) return `Enter a date on or before ${formatDay(o.latest)}`;
      }
      if (o.businessDaysOnly) {
        const wd = weekdayOf(day);
        if (wd === 0 || wd === 6) return "Choose a weekday, Monday to Friday";
      }
      return null;
    }
    case "single_choice": {
      if (typeof value !== "string") return "Choose one option";
      if (!o.allowOther && !(o.choices ?? []).some((c) => c.value === value)) return "Choose one of the listed options";
      return null;
    }
    case "multiple_choice": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "Choose from the listed options";
      if (!o.allowOther && value.some((v) => !(o.choices ?? []).some((c) => c.value === v))) return "Choose only the listed options";
      if (new Set(value).size !== value.length) return "Choose each option only once";
      if (o.minSelections !== undefined && value.length < o.minSelections) return `Choose at least ${plural(o.minSelections, "option")}`;
      if (o.maxSelections !== undefined && value.length > o.maxSelections) return `Choose no more than ${plural(o.maxSelections, "option")}`;
      return null;
    }
    case "yes_no":
      return typeof value === "boolean" ? null : "Choose Yes or No";
    case "person": {
      if (Array.isArray(value)) {
        if (!o.multiple) return "Choose one person";
        return value.every(isUuid) ? null : "Choose people from the list";
      }
      return isUuid(value) ? null : "Choose a person from the list";
    }
    case "file_upload": {
      if (!Array.isArray(value) || !value.every(isUuid)) return "Upload files through the file picker";
      if (o.maxFiles !== undefined && value.length > o.maxFiles) return `Attach no more than ${plural(o.maxFiles, "file")}`;
      return null;
    }
    case "content":
      return null;
    case "signature":
      return "Signature fields are not available yet";
  }
}

export type ValidateSectionOptions = {
  /** Returns false when the value is already used in another submission of the same form. */
  isUnique?: (fieldKey: string, value: unknown) => boolean;
};

/** Checks one section before it completes. Hidden fields are never required and are not format checked. */
export function validateSection(
  def: FormDefinition,
  sectionKey: string,
  answers: Answers,
  context: EvaluationContext,
  opts: ValidateSectionOptions = {},
): SectionValidation {
  const section = orderedSections(def).find((s) => s.key === sectionKey);
  if (!section) return { ok: false, errors: [{ fieldKey: "", message: `The section "${sectionKey}" does not exist` }] };
  const ev = evaluate(def, answers, context);
  const errors: FieldError[] = [];
  for (const field of sortByOrder(section.fields)) {
    if (!ev.fieldVisible[field.key] || field.type === "content") continue;
    const value = ev.answers[field.key];
    if (isEmptyValue(value)) {
      if (ev.fieldRequired[field.key]) errors.push({ fieldKey: field.key, message: "This field is required" });
      continue;
    }
    const message = validateAnswer(field, value, ev.answers);
    if (message) { errors.push({ fieldKey: field.key, message }); continue; }
    if (field.unique && opts.isUnique && !opts.isUnique(field.key, value)) {
      errors.push({ fieldKey: field.key, message: "This value is already used in another submission of this form" });
    }
  }
  return { ok: errors.length === 0, errors };
}
