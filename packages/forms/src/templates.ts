/** The three seeded template forms. Pure data, parsed through the definition schema by the tests and the seed. */
import type { FormDefinitionInput, FormSettings } from "./definition";

export type FormTemplate = {
  slug: "seller_intake" | "property_walkthrough" | "contractor_bid";
  name: string;
  category: string;
  description: string;
  settings: Partial<FormSettings>;
  definition: FormDefinitionInput;
};

const CONDITION_CHOICES = [
  { value: "1", label: "1 - Needs full replacement" },
  { value: "2", label: "2 - Poor" },
  { value: "3", label: "3 - Fair" },
  { value: "4", label: "4 - Good" },
  { value: "5", label: "5 - Like new" },
];

const acquisitionsRole = { key: "acquisitions", label: "Acquisitions", resolution: [{ kind: "subject_owner" as const }, { kind: "role_group" as const, role: "acquisitions" as const }] };

export const SELLER_INTAKE: FormTemplate = {
  slug: "seller_intake",
  name: "Seller intake",
  category: "Acquisitions",
  description: "Filled by acquisitions after the first call with a seller.",
  settings: { subjectType: "lead" },
  definition: {
    roles: [acquisitionsRole],
    sections: [
      {
        key: "seller_and_property", title: "Seller and property", order: "a0", ownerRole: "acquisitions",
        dueRule: { from: "submission_start", offset: 1, unit: "business_days" },
        fields: [
          { key: "seller_name", type: "short_text", label: "Seller name", order: "a0", required: true },
          { key: "seller_phone", type: "short_text", label: "Best phone", order: "a1", options: { pattern: "phone" } },
          { key: "seller_email", type: "short_text", label: "Email", order: "a2", options: { pattern: "email" } },
          { key: "relationship", type: "single_choice", label: "Relationship to the property", order: "a3", required: true, options: { display: "dropdown", choices: [
            { value: "owner", label: "Owner" }, { value: "heir", label: "Heir" }, { value: "agent", label: "Agent" }, { value: "attorney", label: "Attorney" }, { value: "other", label: "Other" },
          ] } },
          { key: "occupancy", type: "single_choice", label: "Who lives there now", order: "a4", required: true, options: { display: "radio", choices: [
            { value: "owner", label: "Owner" }, { value: "tenant", label: "Tenant" }, { value: "vacant", label: "Vacant" },
          ] } },
          { key: "tenant_lease_end", type: "date", label: "Lease end date", order: "a5", hiddenByDefault: true },
          { key: "beds", type: "number", label: "Bedrooms", order: "a6", options: { min: 0, max: 20, decimals: 0 } },
          { key: "baths", type: "number", label: "Bathrooms", order: "a7", options: { min: 0, max: 20, decimals: 1 } },
        ],
      },
      {
        key: "motivation", title: "Motivation and timeline", order: "a1", ownerRole: "acquisitions",
        fields: [
          { key: "reason_selling", type: "long_text", label: "Why are they selling", order: "a0", required: true, options: { maxLength: 2000 } },
          { key: "situations", type: "multiple_choice", label: "Situations that apply", order: "a1", options: { display: "checkboxes", choices: [
            { value: "probate", label: "Probate or inherited" }, { value: "foreclosure", label: "Behind on payments" }, { value: "divorce", label: "Divorce" },
            { value: "repairs", label: "Too many repairs" }, { value: "relocation", label: "Relocating" }, { value: "tax", label: "Tax delinquent" },
          ] } },
          { key: "motivation_score", type: "number", label: "Motivation, 1 to 10", order: "a2", required: true, options: { min: 1, max: 10, decimals: 0 } },
          { key: "close_by", type: "date", label: "Wants to close by", order: "a3" },
        ],
      },
      {
        key: "price_and_terms", title: "Price and terms", order: "a2", ownerRole: "acquisitions",
        fields: [
          { key: "asking_price", type: "number", label: "Asking price", order: "a0", options: { min: 0, decimals: 0, currency: true } },
          { key: "mortgage_owed", type: "yes_no", label: "Is a mortgage owed", order: "a1" },
          { key: "mortgage_balance", type: "number", label: "Approximate balance", order: "a2", hiddenByDefault: true, options: { min: 0, decimals: 0, currency: true } },
          { key: "open_to_terms", type: "yes_no", label: "Open to creative terms", order: "a3" },
          { key: "next_step", type: "long_text", label: "Next step agreed on the call", order: "a4", required: true },
        ],
      },
    ],
    rules: [
      { id: "show_lease_end", when: { combinator: "and", conditions: [{ source: { kind: "field", key: "occupancy" }, op: "equals", value: "tenant" }] }, then: [{ kind: "show", target: { kind: "field", key: "tenant_lease_end" } }] },
      { id: "show_balance", when: { combinator: "and", conditions: [{ source: { kind: "field", key: "mortgage_owed" }, op: "equals", value: true }] }, then: [{ kind: "show", target: { kind: "field", key: "mortgage_balance" } }, { kind: "require", fieldKey: "mortgage_balance" }] },
    ],
  },
};

export const PROPERTY_WALKTHROUGH: FormTemplate = {
  slug: "property_walkthrough",
  name: "Property walkthrough",
  category: "Acquisitions",
  description: "Condition notes and photos from a walkthrough of the property.",
  settings: { subjectType: "lead" },
  definition: {
    roles: [acquisitionsRole],
    sections: [
      {
        key: "exterior", title: "Exterior", order: "a0", ownerRole: "acquisitions",
        dueRule: { from: "submission_start", offset: 3, unit: "business_days" },
        fields: [
          { key: "walk_date", type: "date", label: "Walkthrough date", order: "a0", required: true },
          { key: "roof_condition", type: "single_choice", label: "Roof condition", order: "a1", required: true, options: { display: "dropdown", choices: CONDITION_CHOICES } },
          { key: "siding_condition", type: "single_choice", label: "Siding and windows", order: "a2", options: { display: "dropdown", choices: CONDITION_CHOICES } },
          { key: "exterior_photos", type: "file_upload", label: "Exterior photos", order: "a3", options: { allowedTypes: ["image/jpeg", "image/png", "image/heic", "image/webp"], maxFiles: 20, maxSizeMb: 25 } },
        ],
      },
      {
        key: "interior", title: "Interior", order: "a1", ownerRole: "acquisitions",
        fields: [
          { key: "kitchen_condition", type: "single_choice", label: "Kitchen", order: "a0", required: true, options: { display: "dropdown", choices: CONDITION_CHOICES } },
          { key: "bath_condition", type: "single_choice", label: "Bathrooms", order: "a1", required: true, options: { display: "dropdown", choices: CONDITION_CHOICES } },
          { key: "flooring_condition", type: "single_choice", label: "Flooring", order: "a2", options: { display: "dropdown", choices: CONDITION_CHOICES } },
          { key: "water_damage", type: "yes_no", label: "Signs of water damage", order: "a3" },
          { key: "water_damage_notes", type: "long_text", label: "Where and how bad", order: "a4", hiddenByDefault: true },
          { key: "interior_photos", type: "file_upload", label: "Interior photos", order: "a5", options: { allowedTypes: ["image/jpeg", "image/png", "image/heic", "image/webp"], maxFiles: 40, maxSizeMb: 25 } },
        ],
      },
      {
        key: "systems", title: "Systems and summary", order: "a2", ownerRole: "acquisitions",
        fields: [
          { key: "hvac_age", type: "number", label: "HVAC age in years", order: "a0", options: { min: 0, max: 80, decimals: 0 } },
          { key: "electrical_panel", type: "single_choice", label: "Electrical panel", order: "a1", options: { display: "radio", choices: [
            { value: "breakers", label: "Breakers" }, { value: "fuses", label: "Fuses" }, { value: "unknown", label: "Not seen" },
          ] } },
          { key: "overall_condition", type: "single_choice", label: "Overall condition", order: "a2", required: true, options: { display: "radio", choices: CONDITION_CHOICES } },
          { key: "rehab_notes", type: "long_text", label: "Rehab scope notes", order: "a3", required: true },
        ],
      },
    ],
    rules: [
      { id: "show_water_notes", when: { combinator: "and", conditions: [{ source: { kind: "field", key: "water_damage" }, op: "equals", value: true }] }, then: [{ kind: "show", target: { kind: "field", key: "water_damage_notes" } }, { kind: "require", fieldKey: "water_damage_notes" }] },
    ],
  },
};

export const CONTRACTOR_BID: FormTemplate = {
  slug: "contractor_bid",
  name: "Contractor bid",
  category: "Rehab",
  description: "Acquisitions sets the scope, an outside contractor bids through an invite link, and acquisitions approves.",
  settings: { subjectType: "lead" },
  definition: {
    roles: [
      acquisitionsRole,
      { key: "contractor", label: "Contractor", resolution: [{ kind: "external" }] },
    ],
    sections: [
      {
        key: "scope", title: "Scope of work", order: "a0", ownerRole: "acquisitions",
        fields: [
          { key: "scope_summary", type: "long_text", label: "Scope of work", order: "a0", required: true, visibleToExternal: true },
          { key: "access_notes", type: "short_text", label: "Access instructions", order: "a1", visibleToExternal: true },
          { key: "bid_due", type: "date", label: "Bid due by", order: "a2", required: true, visibleToExternal: true },
        ],
      },
      {
        key: "bid", title: "Contractor bid", order: "a1", ownerRole: "contractor", allowExternal: true,
        dueRule: { from: "date_field", fieldKey: "bid_due", offset: 0, unit: "days" },
        fields: [
          { key: "company_name", type: "short_text", label: "Company name", order: "a0", required: true, visibleToExternal: true },
          { key: "contact_email", type: "short_text", label: "Contact email", order: "a1", required: true, visibleToExternal: true, options: { pattern: "email" } },
          { key: "bid_amount", type: "number", label: "Total bid", order: "a2", required: true, visibleToExternal: true, options: { min: 0, decimals: 0, currency: true } },
          { key: "duration_days", type: "number", label: "Days to complete", order: "a3", required: true, visibleToExternal: true, options: { min: 1, max: 365, decimals: 0 } },
          { key: "licensed_insured", type: "yes_no", label: "Licensed and insured", order: "a4", required: true, visibleToExternal: true },
          { key: "bid_document", type: "file_upload", label: "Bid document", order: "a5", visibleToExternal: true, options: { allowedTypes: ["application/pdf", "image/jpeg", "image/png"], maxFiles: 5, maxSizeMb: 25 } },
          { key: "bid_notes", type: "long_text", label: "Exclusions and notes", order: "a6", visibleToExternal: true },
        ],
      },
      {
        key: "approval", title: "Bid approval", order: "a2", ownerRole: "acquisitions", needsApproval: true,
        dueRule: { from: "previous_section", offset: 2, unit: "business_days" },
        fields: [
          { key: "approval_notes", type: "long_text", label: "Approval notes", order: "a0" },
        ],
      },
    ],
    rules: [],
  },
};

export const FORM_TEMPLATES: FormTemplate[] = [SELLER_INTAKE, PROPERTY_WALKTHROUGH, CONTRACTOR_BID];
