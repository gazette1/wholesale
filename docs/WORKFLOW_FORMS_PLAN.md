# Workflow Forms in DealCalc: adaptation plan

Draft of 2026-10-12. Source: `docs/WORKFLOW_FORMS_SPEC.md`, which was written for a Twenty CRM app. This plan keeps the spec's product rules and replaces everything that depended on Twenty with the way this app already works. Open decisions are listed at the end and must be settled before the schema pass.

## What stays, what changes

| Spec | DealCalc version |
|---|---|
| Form, Version, Section, Field, Submission | Same terms, same rules |
| Forms attach to Twenty Person records | Forms attach to a lead, a buyer, or a contact. A submission has one subject record, and shows on that record's page |
| One Twenty custom object per form, created at publish | One `form_submissions` table for every form. Answers are a JSON document keyed by the field's stable key, with the pinned version id beside it. No runtime schema changes |
| Twenty roles and workspace members | The app's existing roles (admin, acquisitions, dispositions, viewer) and profiles. "Form admin" is a new capability granted to admins by default and to named profiles |
| Twenty sidebar entry, Forms tab, command menu | Sidebar entry "Forms"; a Forms tab on the lead and buyer pages; no command menu |
| Twenty's record timeline for history | The app's `activities` (on the subject record) plus a `form_events` table for the full field level history |
| Twenty background jobs for automations | The existing cron dispatcher (`/api/cron/dispatch`) and the outbound webhook service (`emitEvent`) |
| SendGrid for email | Resend, which the app already has behind the email boundary |
| Twilio for SMS | Twilio, already connected, behind the messaging boundary |
| Documenso for e-signatures | Not in release 1. A `signature` field type is reserved in the schema and rejected by the validator until a provider is chosen |
| Twenty sandbox constraints on the editor | None. The editor is an ordinary client component in this app |
| Twenty's Metadata API | Not needed |
| Standalone fill page for external people | `/fill/[token]`, a public route like `/share/[token]`, with a one-time code by SMS or email |

Everything the spec says about validation, conditional logic, roles, completion rules, approvals, send back, due dates, reminders, comments, retention, and the two admin purge carries over unchanged.

## Where it lives in the code

- `packages/forms`: a new pure TypeScript package, same discipline as `packages/engine`. Holds the form definition schema (zod), field types, the rule engine (conditions and actions), validation, role resolution, due date rules, merge tags, and version migration of answers. No I/O. Runs in the browser for instant reactions and on the server before any section completes. Tested with vitest.
- `packages/db/src/schema/forms.ts`: the tables below, one migration plus one RLS file.
- `apps/web/app/(app)/forms/*`: library, editor, submissions list, reports.
- `apps/web/app/(app)/forms/tasks/[id]`: the task window, one per section per submission, with its own link.
- `apps/web/app/fill/[token]`: the external fill page, outside the signed in shell.
- `apps/web/lib/services/forms.ts`: start a submission, open and complete sections, approvals, send back, reassign, snooze, version publish and migrate.
- `apps/web/lib/services/form-notifications.ts`: assignment, reminder, overdue, escalation, through the messaging boundary. Each profile keeps a notification preference (email, SMS, both) and a mobile number.
- Cron pass: reminders and overdue notices join the existing dispatcher next to alerts.

## Tables

All carry the shared `base` columns (id, org_id, created_at, updated_at) and row level security scoped by org, following `0001` and `0006`.

| Table | Holds |
|---|---|
| `forms` | name, category, status (draft, published, archived), owner profile, latest_version_id, settings (who may start, subject type: lead, buyer, contact, or none) |
| `form_versions` | form_id, number, definition (JSON: sections, fields, rules, roles, due date rules), published_at, published_by. Frozen once published |
| `form_submissions` | form_id, version_id, subject_type and subject_id, status (draft, in_progress, waiting_approval, sent_back, completed, archived), answers (JSON keyed by field key), started_by, completed_at, edited_after_completion flag, due_at |
| `form_tasks` | submission_id, section_key, status (not_started, open, completed, skipped), completion_rule (any, all, minimum) with minimum_count, due_at, snoozed_until, approval_outcome, sent_back_to_section_key |
| `form_task_assignees` | task_id, profile_id or external_party_id, completed_at. Several rows per task |
| `form_external_parties` | submission_id, contact_id or buyer_id, email, phone, token hash, expires_at, revoked_at, single_use, verified_at, last_code_sent_at |
| `form_comments` | submission_id, task_id, author profile or external party, body, document ids |
| `form_events` | submission_id, task_id, actor, kind (answer_changed, section_completed, approved, rejected, sent_back, reassigned, snoozed, version_migrated, automation_run, external_signin, purge), before, after, version_id |
| `form_ad_hoc_tasks` | Release 2 |

Files use the existing `documents` table with a `submission_id` column added. Notifications use the existing `messages` table. Audit entries also go to `audit_log` as today.

Why one submissions table instead of one per form: Drizzle migrations are reviewed SQL. Creating tables at runtime would bypass that, break the PGlite demo and the embedded migration ledger, and make row level security a moving target. A JSON answers column with the pinned version id gives the same per field reporting through a query that unnests keys, and the engine's version migration keeps old answers readable.

## Submission lifecycle in this app

1. Start: from a lead or buyer page ("Start a form"), from the library, from a public link, or from an inbound webhook or API call. The subject record is set at start and does not change.
2. Each section becomes a `form_tasks` row when it opens. Roles resolve in the spec's order: a person field earlier in the form, the subject's assigned profile (the lead owner stands in for "the requester's manager"), a role group, or a fixed profile.
3. The task window at `/forms/tasks/[id]` shows the header, assignees, this section's fields, visible earlier answers, comments and files, history, and the actions. Autosave every few seconds through a server action; the engine validates in the browser and the action validates again.
4. Completion follows the section's rule. The next section opens, its owners are notified, and the subject's timeline gets an activity.
5. Approvals: approve, reject, send back to a chosen section. Send back reopens that section and returns to the approver when it completes.
6. Completed is a status. Later edits are allowed for assignees and form admins, logged, and flagged.
7. Publishing a new version runs the engine's migration over every submission: new fields empty, renamed or moved fields keep their answers by stable key, removed fields' answers stay in `form_events`.

Live co-editing (two people seeing each other's keystrokes) is not in release 1. Autosave plus last write wins with both values kept in history covers the spec's data rule without a realtime channel.

## External people

- Internal users invite a contact or a buyer, or create a public link on a form that allows it.
- `/fill/[token]` verifies with a one-time code by SMS (Twilio) or email (Resend). No account.
- The page renders the same task window component with the parts their access hides removed. Answers save as they go.
- Links expire, can be revoked, and can be single use. Every external action is logged in `form_events` with the email or phone.
- Rate limits on code requests and attempts, and the same org scoping and token hashing the package share links use.

## Notifications and reminders

- Assignment, due soon, overdue, sent back, and @mention, by email, SMS, or both per profile preference. SMS goes through the existing messaging service, which already handles consent, STOP, and delivery status.
- Due dates are relative: submission start, previous section completion, or a date field, with a business days option from the engine.
- The cron pass finds due soon and overdue tasks, sends once per threshold, and escalates overdue tasks to an admin after a set delay. These reuse the `alerts` table so they show on the bell and the alerts page.

## Reporting

- Per form: a table with one row per submission and one column per field, built from the pinned version's field list, filterable, sortable, saved views, CSV through the existing export route.
- Summary: open submissions as on track, due soon, overdue; completions over time; by assignee and by section; average time per section.

## Retention and purge

- Deleting a form, submission, task, comment, or file sets `archived_at`. Nothing is removed from the database by delete.
- Purge of one person: two admin approval, removes that person's answers, files, comments, events, sign in records, and message logs, replaces their answers in shared submissions with "Removed on request", and writes a purge log entry. Twilio message records are deleted through Twilio's API as part of the purge.

## Release 1 (matches the spec's first release)

- Form builder: sections, the ten common field types (short text, long text, number, date, single choice, multiple choice, yes/no, person, file upload, content), required and format validation, show/hide and skip rules, roles, due date rules, preview, publish, versions.
- Submissions on leads and buyers, the Forms tab, the library, My tasks (added to the existing follow ups page), the task window.
- Multiple assignees with any, all, and minimum completion. Sequential handoff. Stop points. Parallel sections if the engine design makes it free, otherwise release 2.
- Single approver approvals with send back.
- External access by invite and public link with one-time codes.
- Autosave, due dates, reminders, overdue notices, escalation, email and SMS.
- Reports table, summary, CSV. Audit trail. Archive on delete. Purge.

## Release 2 and later

Tables (line items), lookups into leads, buyers, and cost defaults, calculated fields, checklist items, prepared emails, multi approver approvals, ad-hoc tasks, automations beyond notifications (webhook triggers, scheduled starts, follow-on forms), API endpoints under `/api/v1/forms`, signatures once a provider is chosen, AI and code sections, generating a form from a description.

## Reuse from the earlier Twenty build

The earlier build has a rule engine, a validator, a version migration, field type definitions, and three end to end suites. Once its code is located, the plan is to port the pure parts (definition schema, rules, validation, migration, merge tags) into `packages/forms` with their tests, and to rewrite the UI and data layer against this app. Anything that reached Twenty's Metadata API or front component sandbox is dropped.

## Open decisions before the schema pass

1. Subjects: leads and buyers in release 1, with contacts later, or all three now.
2. Whether the form admin capability is its own role or a flag on a profile. Recommendation: a boolean on `profiles`, since the role enum drives row level security elsewhere.
3. Whether external people may upload files in release 1. The spec's earlier build did not have it. Recommendation: yes, since the documents boundary already exists and the risk is the same as the lead page upload.
4. The first three forms Ous wants to run, so release 1 is tested on real work. Candidates from the pipeline: seller intake, property walkthrough, contractor bid, closing checklist, buyer onboarding.
5. Where My tasks lives: inside the existing follow ups page or its own page.
