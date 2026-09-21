import { pgTable, text, uuid, boolean, jsonb, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base } from "./_shared";
import { orgs, profiles } from "./identity";

/**
 * Inbound API keys. Other software (Zapier, Make, PropStream exports, web forms,
 * a dialer) posts leads to /api/v1/leads with one of these. Only the SHA-256 hash
 * is stored; the key itself is shown once when created.
 */
export const apiKeys = pgTable("api_keys", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  /** Lead source name applied to leads created with this key. */
  defaultSource: text("default_source"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("api_keys_hash").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)]);

/** Outbound webhooks. Each endpoint receives a signed JSON POST for the events it subscribes to. */
export const webhookEndpoints = pgTable("webhook_endpoints", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  lastStatus: integer("last_status"),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => [index("webhook_endpoints_org_idx").on(t.orgId)]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  statusCode: integer("status_code"),
  ok: boolean("ok").notNull().default(false),
  error: text("error"),
  durationMs: integer("duration_ms"),
}, (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt)]);
