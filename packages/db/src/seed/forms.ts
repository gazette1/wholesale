/** Seeds the three Workflow Forms templates as published version 1 forms. Used by bootstrap() and seed(). */
import { eq } from "drizzle-orm";
import { FORM_TEMPLATES, parseDefinition, formSettingsSchema } from "@dealcalc/forms";
import type { Db } from "../client";
import { forms, formVersions } from "../schema";

export async function seedFormTemplates(db: Db, orgId: string, ownerId: string | null): Promise<string[]> {
  const ids: string[] = [];
  for (const t of FORM_TEMPLATES) {
    const definition = parseDefinition(t.definition);
    const settings = formSettingsSchema.parse(t.settings);
    const [form] = await db.insert(forms).values({
      orgId, name: t.name, description: t.description, category: t.category, status: "published",
      ownerId, draftDefinition: definition, settings, templateSlug: t.slug,
    }).returning();
    const [version] = await db.insert(formVersions).values({
      orgId, formId: form!.id, number: 1, definition, publishedBy: ownerId,
    }).returning();
    await db.update(forms).set({ latestVersionId: version!.id }).where(eq(forms.id, form!.id));
    ids.push(form!.id);
  }
  return ids;
}
