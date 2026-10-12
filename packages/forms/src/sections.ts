/** Form order and section flow helpers. */
import type { CompletionRule, FieldDef, FormDefinition, SectionDef } from "./definition";
import { sortByOrder } from "./order";
import type { Evaluation } from "./rules";

export type SectionState = "not_started" | "open" | "completed" | "skipped";

export function orderedSections(def: Pick<FormDefinition, "sections">): SectionDef[] {
  return sortByOrder(def.sections);
}

export type PositionedField = { field: FieldDef; section: SectionDef; sectionIndex: number; index: number };

/** Every field in form order: section order, then field order within the section. */
export function orderedFields(def: Pick<FormDefinition, "sections">): PositionedField[] {
  const out: PositionedField[] = [];
  orderedSections(def).forEach((section, sectionIndex) => {
    for (const field of sortByOrder(section.fields)) out.push({ field, section, sectionIndex, index: out.length });
  });
  return out;
}

export function findField(def: Pick<FormDefinition, "sections">, key: string): FieldDef | undefined {
  for (const s of def.sections) for (const f of s.fields) if (f.key === key) return f;
  return undefined;
}

function isDone(key: string, state: Record<string, SectionState>, evaluation?: Pick<Evaluation, "skippedSections" | "sectionVisible">): boolean {
  const s = state[key] ?? "not_started";
  if (s === "completed" || s === "skipped") return true;
  return isSkippedByRules(key, evaluation);
}

function isSkippedByRules(key: string, evaluation?: Pick<Evaluation, "skippedSections" | "sectionVisible">): boolean {
  if (!evaluation) return false;
  return evaluation.skippedSections.includes(key) || evaluation.sectionVisible[key] === false;
}

/** Runs of adjacent sections. Sections that share a parallelGroup with their neighbor form one run. */
export function sectionBlocks(def: Pick<FormDefinition, "sections">): SectionDef[][] {
  const blocks: SectionDef[][] = [];
  for (const s of orderedSections(def)) {
    const last = blocks[blocks.length - 1];
    if (last && s.parallelGroup && last[0]!.parallelGroup === s.parallelGroup) last.push(s);
    else blocks.push([s]);
  }
  return blocks;
}

/**
 * Which not started sections should open now, and which the rules skip or hide.
 * Sections run in order; a parallel run opens together; a stop point holds every later section.
 */
export function nextSectionsToOpen(
  def: Pick<FormDefinition, "sections">,
  state: Record<string, SectionState>,
  evaluation?: Pick<Evaluation, "skippedSections" | "sectionVisible">,
): { open: string[]; skip: string[] } {
  const open: string[] = [];
  const skip: string[] = [];
  for (const block of sectionBlocks(def)) {
    let blocked = false;
    for (const s of block) {
      const current = state[s.key] ?? "not_started";
      if (current === "not_started" && isSkippedByRules(s.key, evaluation)) {
        skip.push(s.key);
        continue;
      }
      if (isDone(s.key, state, evaluation)) continue;
      blocked = true;
      if (current === "not_started") open.push(s.key);
      if (s.stopPoint) break;
    }
    if (blocked) break;
  }
  return { open, skip };
}

/** True when every section is completed, skipped, or skipped by the rules. */
export function allSectionsDone(
  def: Pick<FormDefinition, "sections">,
  state: Record<string, SectionState>,
  evaluation?: Pick<Evaluation, "skippedSections" | "sectionVisible">,
): boolean {
  return def.sections.every((s) => isDone(s.key, state, evaluation));
}

/** Minimum counts above the number of assignees are capped at the number of assignees, so a task cannot stall. */
export function isTaskComplete(rule: CompletionRule, assigneeCount: number, completedCount: number): boolean {
  if (assigneeCount <= 0) return false;
  if (rule.type === "any") return completedCount >= 1;
  if (rule.type === "all") return completedCount >= assigneeCount;
  return completedCount >= Math.min(rule.count ?? 1, assigneeCount);
}
