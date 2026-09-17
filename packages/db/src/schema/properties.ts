import { pgTable, text, uuid, boolean, jsonb, numeric, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base, occupancyEnum, conditionEnum, relationshipEnum, consentEnum } from "./_shared";
import { orgs } from "./identity";

export type Phone = { number: string; type: "mobile" | "landline" | "voip" | "unknown"; isPrimary?: boolean; label?: string };
export type EmailAddress = { address: string; isPrimary?: boolean; label?: string };
export type Photo = { url: string; caption?: string; source?: string; takenAt?: string };

export const properties = pgTable("properties", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  county: text("county"),
  lat: numeric("lat", { precision: 10, scale: 7 }),
  lng: numeric("lng", { precision: 10, scale: 7 }),
  apn: text("apn"),
  propertyType: text("property_type"),
  beds: numeric("beds", { precision: 4, scale: 1 }),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  sqft: integer("sqft"),
  lotSqft: integer("lot_sqft"),
  yearBuilt: integer("year_built"),
  units: integer("units").notNull().default(1),
  occupancy: occupancyEnum("occupancy").notNull().default("unknown"),
  condition: conditionEnum("condition").notNull().default("unknown"),
  photos: jsonb("photos").$type<Photo[]>().notNull().default([]),
  notes: text("notes"),
}, (t) => [
  index("properties_org_idx").on(t.orgId),
  index("properties_address_idx").on(t.orgId, t.state, t.city, t.addressLine1),
]);

export const contacts = pgTable("contacts", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  phones: jsonb("phones").$type<Phone[]>().notNull().default([]),
  emails: jsonb("emails").$type<EmailAddress[]>().notNull().default([]),
  mailingAddress: text("mailing_address"),
  relationship: relationshipEnum("relationship").notNull().default("owner"),
  smsConsent: consentEnum("sms_consent").notNull().default("unknown"),
  smsConsentAt: timestamp("sms_consent_at", { withTimezone: true }),
  emailConsent: consentEnum("email_consent").notNull().default("unknown"),
  doNotContact: boolean("do_not_contact").notNull().default(false),
  notes: text("notes"),
}, (t) => [index("contacts_org_idx").on(t.orgId), index("contacts_name_idx").on(t.orgId, t.lastName, t.firstName)]);

export const propertyContacts = pgTable("property_contacts", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  role: relationshipEnum("role").notNull().default("owner"),
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [uniqueIndex("property_contacts_unique").on(t.propertyId, t.contactId)]);
