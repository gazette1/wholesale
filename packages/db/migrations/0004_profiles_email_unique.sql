-- One email per org, whatever its letter case. A login claims its profile by email, so duplicates made the role a login received arbitrary.
-- Any duplicates that already exist are kept but set aside: the oldest row keeps the address, later rows are deactivated and get a marker
-- appended so the index can be created. Nothing is deleted.
UPDATE "profiles" SET "active" = false, "email" = "email" || '.duplicate.' || "id"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "org_id", lower("email") ORDER BY "created_at", "id") AS rn FROM "profiles"
  ) ranked WHERE ranked.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_org_email_unique" ON "profiles" USING btree ("org_id",lower("email"));
