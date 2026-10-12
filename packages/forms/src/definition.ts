/**
 * The form definition contract. Stored as JSON in form_versions.definition and form drafts.
 * Every other part of this package, the database seed, and the web app read this shape.
 */
import { z } from "zod";

export const DEFINITION_SCHEMA_VERSION = 1;

/** The ten release 1 field types. */
export const FIELD_TYPES = [
  "short_text", "long_text", "number", "date", "single_choice",
  "multiple_choice", "yes_no", "person", "file_upload", "content",
] as const;
/** Reserved for a later release. Accepted by the schema so drafts can hold it, rejected by validateDefinition. */
export const RESERVED_FIELD_TYPES = ["signature"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type AnyFieldType = FieldType | (typeof RESERVED_FIELD_TYPES)[number];

/** The app's existing roles. A role group resolves to every active profile with that role. */
export const APP_ROLES = ["admin", "acquisitions", "dispositions", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

const key = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Keys use lower case letters, digits, and underscores, and start with a letter");
/** Sortable order key. Compared as plain strings, so inserting never renumbers siblings. */
const orderKey = z.string().min(1).max(64);

export const choiceSchema = z.object({ value: z.string().min(1), label: z.string().min(1) });

export const fieldOptionsSchema = z.object({
  // short_text
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.enum(["email", "phone", "url", "custom"]).optional(),
  regex: z.string().optional(),
  placeholder: z.string().optional(),
  // long_text
  rich: z.boolean().optional(),
  // number
  min: z.number().optional(),
  max: z.number().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  unit: z.string().optional(),
  currency: z.boolean().optional(),
  thousandsSeparator: z.boolean().optional(),
  // date (ISO dates, YYYY-MM-DD)
  earliest: z.string().optional(),
  latest: z.string().optional(),
  businessDaysOnly: z.boolean().optional(),
  withTime: z.boolean().optional(),
  // single_choice and multiple_choice
  choices: z.array(choiceSchema).optional(),
  display: z.enum(["dropdown", "radio", "checkboxes"]).optional(),
  allowOther: z.boolean().optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
  // yes_no
  yesLabel: z.string().optional(),
  noLabel: z.string().optional(),
  // person
  multiple: z.boolean().optional(),
  limitToRole: z.enum(APP_ROLES).optional(),
  // file_upload
  allowedTypes: z.array(z.string()).optional(),
  maxSizeMb: z.number().positive().optional(),
  maxFiles: z.number().int().positive().optional(),
  // content (display only, supports merge tags)
  body: z.string().optional(),
}).strict();
export type FieldOptions = z.infer<typeof fieldOptionsSchema>;

export const fieldSchema = z.object({
  key,
  type: z.enum([...FIELD_TYPES, ...RESERVED_FIELD_TYPES]),
  label: z.string().min(1),
  help: z.string().optional(),
  order: orderKey,
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  readOnly: z.boolean().default(false),
  hiddenByDefault: z.boolean().default(false),
  /** Role keys from definition.roles that may see the field. Empty means every role. */
  visibleToRoles: z.array(key).default([]),
  /** External people never see a field unless this is true. */
  visibleToExternal: z.boolean().default(false),
  /** Reject a value already used in another submission of the same form. */
  unique: z.boolean().default(false),
  options: fieldOptionsSchema.default({}),
});
export type FieldDef = z.infer<typeof fieldSchema>;

export const dueRuleSchema = z.object({
  from: z.enum(["submission_start", "previous_section", "date_field"]),
  fieldKey: key.optional(),
  /** Negative offsets count back, for example 3 business days before a date field. */
  offset: z.number().int(),
  unit: z.enum(["hours", "days", "business_days"]),
});
export type DueRule = z.infer<typeof dueRuleSchema>;

export const completionRuleSchema = z.object({
  type: z.enum(["any", "all", "minimum"]),
  count: z.number().int().positive().optional(),
});
export type CompletionRule = z.infer<typeof completionRuleSchema>;

export const sectionSchema = z.object({
  key,
  title: z.string().min(1),
  description: z.string().optional(),
  order: orderKey,
  ownerRole: key,
  completionRule: completionRuleSchema.default({ type: "any" }),
  dueRule: dueRuleSchema.optional(),
  /** An approval step: approve, reject, or send back to an earlier section. */
  needsApproval: z.boolean().default(false),
  skippable: z.boolean().default(false),
  /** Later sections wait until this one is completed or skipped, even within a parallel group. */
  stopPoint: z.boolean().default(false),
  /** Adjacent sections that share a group name open together. */
  parallelGroup: z.string().optional(),
  /** May be assigned to an external party through an invite link. */
  allowExternal: z.boolean().default(false),
  fields: z.array(fieldSchema).default([]),
});
export type SectionDef = z.infer<typeof sectionSchema>;

/** Role resolution sources, tried in this order of preference when listed in this order. */
export const roleSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person_field"), fieldKey: key }),
  z.object({ kind: z.literal("subject_owner") }),
  z.object({ kind: z.literal("starter") }),
  z.object({ kind: z.literal("role_group"), role: z.enum(APP_ROLES) }),
  z.object({ kind: z.literal("fixed_profile"), profileId: z.string().uuid() }),
  z.object({ kind: z.literal("external") }),
]);
export type RoleSource = z.infer<typeof roleSourceSchema>;

export const roleSchema = z.object({
  key,
  label: z.string().min(1),
  resolution: z.array(roleSourceSchema).min(1),
});
export type RoleDef = z.infer<typeof roleSchema>;

export const OPERATORS = [
  "equals", "not_equals", "contains", "is_empty", "is_not_empty",
  "gt", "lt", "gte", "lte", "before", "after", "is_one_of",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const conditionSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), key }),
  z.object({ kind: z.literal("meta"), key: z.enum(["starter_role", "version", "created_at"]) }),
]);

export const conditionSchema = z.object({
  source: conditionSourceSchema,
  op: z.enum(OPERATORS),
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export type ConditionGroup = { combinator: "and" | "or"; conditions: (Condition | ConditionGroup)[] };
export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({ combinator: z.enum(["and", "or"]), conditions: z.array(z.union([conditionSchema, conditionGroupSchema])) }),
);

const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), key }),
  z.object({ kind: z.literal("section"), key }),
]);

export const ruleActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("show"), target }),
  z.object({ kind: z.literal("hide"), target }),
  z.object({ kind: z.literal("require"), fieldKey: key }),
  z.object({ kind: z.literal("optional"), fieldKey: key }),
  z.object({ kind: z.literal("set_value"), fieldKey: key, value: z.unknown() }),
  z.object({ kind: z.literal("skip_section"), sectionKey: key }),
  z.object({ kind: z.literal("assign"), sectionKey: key, roleKey: key }),
  z.object({ kind: z.literal("change_due"), sectionKey: key, dueRule: dueRuleSchema }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  when: conditionGroupSchema,
  then: z.array(ruleActionSchema).min(1),
});
export type Rule = z.infer<typeof ruleSchema>;

export const formDefinitionSchema = z.object({
  schemaVersion: z.literal(DEFINITION_SCHEMA_VERSION).default(DEFINITION_SCHEMA_VERSION),
  roles: z.array(roleSchema).default([]),
  sections: z.array(sectionSchema).default([]),
  rules: z.array(ruleSchema).default([]),
});
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
/** Input form before defaults are applied, as stored drafts may omit defaulted keys. */
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;

/** Answers keyed by field stable key. File fields hold document ids; person fields hold profile ids. */
export type Answers = Record<string, unknown>;

/** Per form settings stored on forms.settings, outside the versioned definition. */
export const formSettingsSchema = z.object({
  subjectType: z.enum(["lead", "buyer", "none"]).default("lead"),
  /** Roles allowed to start a submission. Empty means every role except viewer. */
  whoMayStart: z.array(z.enum(APP_ROLES)).default([]),
  allowPublicLink: z.boolean().default(false),
  commentsEnabled: z.boolean().default(true),
  timeZone: z.string().default("America/New_York"),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export function parseDefinition(input: unknown): FormDefinition {
  return formDefinitionSchema.parse(input);
}
