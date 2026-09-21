export type SavedViewEntity = "leads" | "buyers";

/**
 * The URL filter keys a saved view may store, per entity. Leads mirrors LeadFilters without sort, dir, and paging.
 * TODO(phase2): buyers lists q and state only because that is all listBuyers takes today. Extend it when the buyers list gets more filters.
 */
export const VIEW_FILTER_KEYS: Record<SavedViewEntity, readonly string[]> = {
  leads: ["q", "stage", "assigned", "source", "status", "tag", "due", "issue", "untouched", "created", "offer", "createdFrom", "createdTo"],
  buyers: ["q", "state"],
};

/**
 * Column keys a leads view may store, matching the `key` of every entry in COLUMNS in app/(app)/leads/page.tsx.
 * Keep the two lists in sync by hand; there is nothing that checks it at build time.
 */
export const LEAD_COLUMN_KEYS = ["address", "contact", "stage", "followUp", "attempts", "asking", "motivation", "source", "assigned", "created"] as const;

