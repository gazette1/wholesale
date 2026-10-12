import type { CompletionRule } from "@dealcalc/forms";
import type { SubmissionStatus, TaskStatus } from "@/lib/forms/types";
import type { BadgeTone } from "@/components/ui/badge";

/** Formats an ISO instant in the form's time zone, so the server render and the browser agree. */
export function fmtWhen(iso: string | null | undefined, timeZone: string, withTime = true): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: BadgeTone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  open: { label: "Open", tone: "info" },
  completed: { label: "Completed", tone: "good" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const SUBMISSION_STATUS: Record<SubmissionStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  waiting_approval: { label: "Waiting for approval", tone: "warn" },
  sent_back: { label: "Sent back", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  archived: { label: "Archived", tone: "neutral" },
};

export function ruleText(rule: CompletionRule, total: number): string {
  if (rule.type === "all") return "Every assignee must complete their part.";
  if (rule.type === "minimum") {
    const n = rule.count ?? 1;
    return `At least ${n} ${n === 1 ? "assignee" : "assignees"} must complete their part${total ? ` (${total} assigned)` : ""}.`;
  }
  return "Any one assignee can complete this section.";
}

export const HISTORY_LABEL: Record<string, string> = {
  section_opened: "Opened the section",
  section_completed: "Completed the section",
  commented: "Added a comment",
  answer_changed: "Changed an answer",
  approved: "Approved",
  rejected: "Rejected",
  sent_back: "Sent the submission back",
  reassigned: "Reassigned the section",
  snoozed: "Snoozed the section",
};

export function historyLabel(kind: string): string {
  const known = HISTORY_LABEL[kind];
  if (known) return known;
  const text = kind.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
