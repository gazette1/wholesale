/** View types shared by the forms services, data queries, and screens. Plain data only. */
import type { CompletionRule, FieldDef, FieldError, FormSettings } from "@dealcalc/forms";

export type { FieldError };

export type FormStatus = "draft" | "published" | "archived";
export type SubmissionStatus = "draft" | "in_progress" | "waiting_approval" | "sent_back" | "completed" | "archived";
export type TaskStatus = "not_started" | "open" | "completed" | "skipped";
export type SubjectType = "lead" | "buyer" | "none";

export type FormLibraryRow = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  status: FormStatus;
  ownerId: string | null;
  ownerName: string | null;
  latestVersionNumber: number | null;
  subjectType: SubjectType;
  openCount: number;
  overdueCount: number;
  lastUsedAt: string | null;
  archivedAt: string | null;
};

export type FormLibraryFilters = {
  q?: string;
  category?: string;
  ownerId?: string;
  status?: FormStatus | "all";
};

export type FormVersionRow = { id: string; number: number; publishedAt: string; publishedByName: string | null };

export type FormDetail = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: FormStatus;
  ownerId: string | null;
  ownerName: string | null;
  settings: FormSettings;
  templateSlug: string | null;
  draftDefinition: unknown;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  versions: FormVersionRow[];
  archivedAt: string | null;
  lastUsedAt: string | null;
};

export type SubmissionTaskState = {
  taskId: string;
  sectionKey: string;
  roleKey: string | null;
  status: TaskStatus;
  dueAt: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  approvalOutcome: "approved" | "rejected" | "sent_back" | null;
  assigneeNames: string[];
};

export type SubmissionRow = {
  id: string;
  formId: string;
  formName: string;
  versionNumber: number;
  title: string | null;
  status: SubmissionStatus;
  subjectType: SubjectType;
  leadId: string | null;
  buyerId: string | null;
  subjectLabel: string | null;
  startedByName: string | null;
  createdAt: string;
  completedAt: string | null;
  dueAt: string | null;
  editedAfterCompletion: boolean;
  /** on_track, due_soon, or overdue for open submissions, null once finished. */
  health: "on_track" | "due_soon" | "overdue" | null;
  answers: Record<string, unknown>;
  tasks: SubmissionTaskState[];
};

export type SubmissionReport = {
  form: { id: string; name: string; versionNumber: number | null };
  /** Columns for the report table, from the latest published version. */
  fields: { key: string; label: string; type: string; sectionKey: string; sectionTitle: string }[];
  rows: SubmissionRow[];
  total: number;
};

export type SubmissionFilters = { status?: SubmissionStatus | "open" | "all"; q?: string; limit?: number };

export type FormSummary = {
  status: { onTrack: number; dueSoon: number; overdue: number };
  completionsPerWeek: { weekStart: string; count: number }[];
  openByAssignee: { profileId: string; name: string; count: number }[];
  openBySection: { sectionKey: string; title: string; count: number }[];
  /** hours is null until at least one task of that section has completed. */
  avgHoursBySection: { sectionKey: string; title: string; hours: number | null; samples: number }[];
};

export type MyTaskRow = {
  taskId: string;
  submissionId: string;
  formId: string;
  formName: string;
  sectionKey: string;
  sectionTitle: string;
  subjectLabel: string | null;
  needsApproval: boolean;
  status: TaskStatus;
  dueAt: string | null;
  snoozedUntil: string | null;
  overdue: boolean;
  unread: boolean;
};

export type MyTasks = {
  open: MyTaskRow[];
  approvals: MyTaskRow[];
  snoozed: MyTaskRow[];
  unreadCount: number;
};

/** Field visibility and requiredness for the fields the actor may see in this section. */
export type TaskEvaluation = {
  fieldVisible: Record<string, boolean>;
  fieldRequired: Record<string, boolean>;
  /** Values the rules set. Only keys the actor may see. */
  setValues: Record<string, unknown>;
};

export type TaskAssigneeView = {
  id: string;
  kind: "profile" | "external";
  name: string;
  profileId: string | null;
  externalPartyId: string | null;
  completedAt: string | null;
};

export type TaskCommentView = {
  id: string;
  authorName: string;
  authorKind: "profile" | "external" | "unknown";
  body: string;
  createdAt: string;
  files: { documentId: string; filename: string }[];
  mentionNames: string[];
};

export type TaskHistoryView = {
  id: string;
  kind: string;
  at: string;
  actorName: string;
  fieldKey: string | null;
  before: unknown;
  after: unknown;
};

export type TaskPermissions = {
  canEdit: boolean;
  canComplete: boolean;
  canApprove: boolean;
  canReassign: boolean;
  canSnooze: boolean;
  canComment: boolean;
  canInvite: boolean;
};

export type TaskWindowData = {
  task: {
    id: string;
    submissionId: string;
    sectionKey: string;
    roleKey: string | null;
    status: TaskStatus;
    completionRule: CompletionRule;
    dueAt: string | null;
    snoozedUntil: string | null;
    openedAt: string | null;
    completedAt: string | null;
    approvalOutcome: "approved" | "rejected" | "sent_back" | null;
    returnToSectionKey: string | null;
  };
  form: { id: string; name: string; versionNumber: number; commentsEnabled: boolean; timeZone: string };
  submission: {
    id: string;
    title: string | null;
    status: SubmissionStatus;
    subjectType: SubjectType;
    leadId: string | null;
    buyerId: string | null;
    /** Lead address, or the buyer's name only. */
    subjectLabel: string | null;
    startedByName: string | null;
    createdAt: string;
    dueAt: string | null;
    editedAfterCompletion: boolean;
  };
  section: {
    key: string;
    title: string;
    description: string | null;
    needsApproval: boolean;
    allowExternal: boolean;
    /** Only fields this actor may see. */
    fields: FieldDef[];
  };
  /** Answers for every field in `section.fields` and `earlierSections`, nothing else. */
  answers: Record<string, unknown>;
  earlierSections: { key: string; title: string; fields: FieldDef[] }[];
  evaluation: TaskEvaluation;
  assignees: TaskAssigneeView[];
  comments: TaskCommentView[];
  history: TaskHistoryView[];
  permissions: TaskPermissions;
  /** Earlier sections an approver may send this task back to. */
  sendBackTargets: { key: string; title: string }[];
};
