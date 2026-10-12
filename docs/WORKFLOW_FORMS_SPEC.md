# Workflow Forms: source specification

Received from Russ on 2026-10-12 as the functional spec for a workflow forms product that was first built as a Twenty CRM app. On 2026-10-12 Russ decided it becomes a feature of this app instead. This file keeps the spec as received, so the adaptation can be checked against it. The parts that name Twenty, Documenso, SendGrid or the Twenty sandbox describe the earlier build and do not bind the DealCalc version. The adaptation plan lives in `docs/WORKFLOW_FORMS_PLAN.md`.

---

## Core concept

Every workflow is a form definition, and every time the workflow runs, one or more people fill out one copy of that form, including people outside your organization when the form is shared with them. The form is the whole process: its sections are the steps, its fields are the work, and its rules decide who does what and when.

| Term | What it is | Example |
|---|---|---|
| Form | The workflow definition, built by an admin | Employee onboarding |
| Version | A published, frozen snapshot of the form | Onboarding v3 |
| Section | A step of the workflow: a group of fields owned by one role | IT setup |
| Field | One question or action inside a section | Laptop serial number |
| Submission | One run of the form, with its answers and status | Onboarding for Jane Doe |

Rules that follow from this:

- Submissions always follow the latest version. Admins edit a draft; publishing creates a new version. Publishing a new version updates every submission, open or completed, to match it: new fields appear empty, renamed or moved fields keep their answers, and answers to removed fields stay in the submission's history.
- Fields keep a stable key across versions (for example `laptop_serial`), so reports, rules and integrations still work after a field is renamed or moved.
- A submission is the single record of the work. Answers, comments, files, approvals and history all live on it, and it is stored as one record on the form's own object (see Submission database).

## Form structure and field types

A form is an ordered list of sections, and each section holds fields. Every field shares a common set of settings, plus options specific to its type.

Settings every field has: label, help text, stable key, required flag, default value, read-only flag, hidden-by-default flag, and who can see it (all roles, or named roles only).

Section settings: title, description, owner role, due date rule, whether it needs approval, whether it can be skipped, and whether it is a stop point that later sections wait for.

Section types: Manual (people fill it), Approval, AI (runs a prompt over earlier answers and writes the result into fields) and Code (runs a script for a calculation or an API call). Automated sections run as soon as they open and show their output or error on the submission.

Merge tags let content, emails and default values reuse earlier answers, for example "Welcome {{form.first_name}}, you start on {{form.start_date}}."

| Field type | Captures | Type-specific options |
|---|---|---|
| Short text | One line of text | Min/max length, pattern (email, phone, URL, custom regex), placeholder |
| Long text | Paragraphs | Plain or rich text, character limit |
| Number | A number | Min/max, decimals, unit or currency, thousands separator |
| Date / time | A date, time or both | Earliest/latest allowed, business days only, time zone |
| Single choice | One option | Dropdown or radio buttons, options list, "Other" with text |
| Multiple choice | Several options | Checkboxes, min/max selections |
| Yes / No | A boolean | Labels for each answer |
| Person | One or more users | Limit to a group or role, single or multiple |
| File upload | Documents and images | Allowed file types, max size, max file count |
| Signature | A drawn or typed signature | Later release, signed through Documenso |
| Table | Repeating rows (line items) | Column definitions using the types above, min/max rows, column totals |
| Lookup | A record from a list or data set | Source list, which columns to show, filter |
| Calculated | A value derived from other fields | Formula; always read-only |
| Checklist item | A to-do that gets ticked | Optionally required before the section can be completed |
| Email | A prepared email sent from the form | To, cc, bcc, subject and body with merge tags; locked or editable before sending |
| Content | Instructions, images, video, links | Display only, captures no answer; supports merge tags |

## Validation

Validation runs on each field as it is filled and again when a section is completed; the server repeats every check so no one can skip a rule by editing the request.

- Required means required for this section to complete. A user can save a partial draft at any time; they cannot mark the section done with required fields empty.
- Hidden fields are never required. If a rule hides a required field, it stops blocking completion and its answer is kept in the record but hidden.
- Format checks come from the field type (valid email, number in range, date in the allowed window, file type and size).
- Cross-field checks compare answers: end date after start date, table total equals the approved budget, at least one of two fields filled.
- Errors are shown next to the field in plain words ("Enter a date after 12 Oct 2026"), and a section summary lists every field still blocking completion with a link to each.
- Uniqueness (optional per field): reject a value already used in another submission of the same form, such as an invoice number.

## Conditional logic

Rules let one form cover many cases: each rule reads as "when these conditions are true, do this action," and is built in a visual editor, not code.

Conditions test any earlier answer, the submitter's role or group, the submission's metadata (created date, form version) or a calculated value. Operators depend on the field type: equals, does not equal, contains, is empty, is not empty, greater/less than, before/after, is one of. Conditions combine with AND / OR groups.

| Action | Applies to | Example |
|---|---|---|
| Show / hide | A field or a whole section | Show "Visa details" when Country is not US |
| Require / make optional | A field | Require a receipt when Amount is over $75 |
| Set value | A field | Set Priority to High when Category is Security |
| Skip section | A section | Skip IT setup when Equipment needed is No |
| Assign | A section | Assign Legal review to Legal when Contract value is over $50,000 |
| Change due date | A section | Due in 1 business day when Priority is High |

Rules are evaluated instantly in the browser so the form reacts as people type, and re-evaluated on the server before any section is completed. Two guards keep logic predictable: a rule may only read fields that come before its target, and the editor rejects rule cycles.

## Roles, handoffs and approvals

Each section belongs to a role, and the form moves from person to person as sections are completed. Roles are placeholders in the form (Requester, Manager, IT, Finance) that resolve to real people when a submission starts or when its section opens.

How a role resolves to a person, in order of preference:

1. Named in a Person field earlier in the form ("Hiring manager")
2. Relative to the requester (their manager, from the user directory)
3. A team or group, where anyone in it can claim the section
4. A fixed person set by the admin

Multiple assignees. Any section, task or approval can be assigned to several people at once, and each section sets how it completes:

| Completion rule | Section is done when | Typical use |
|---|---|---|
| Any one | One assignee completes it | A shared queue such as "IT team" |
| All | Every assignee has completed their part | Each department head confirms |
| Minimum count | A set number of assignees have completed it | 2 of 3 reviewers sign off |

Each assignee's progress shows on the section, and checklist items inside it can be assigned to individual people.

People outside the organization. A form or a single section can be shared with external people (customers, vendors, candidates) by email invite or share link.

- External people verify with a one-time code sent by email or by text message (through Twilio); no account or password is needed.
- They see only the sections assigned to them and the earlier answers the form marks as visible to them.
- A public link can start a new submission (like a web form); an invite link opens one existing submission.
- Links can expire, be revoked, and be limited to one use; every external action is logged with the person's email.

Handoffs

- Sections run in order by default. An admin can mark sections as parallel so, for example, IT and Facilities work at the same time. A section marked as a stop point holds every later section until it is completed.
- When a section completes, the next owners are notified and the section appears in their task list.
- A section owner can reassign their section, and an admin can reassign any section; each reassignment is logged.
- Earlier sections become read-only to later roles, unless the form sends the submission back.

Approvals are a section type with three outcomes: Approve, Reject, or Send back with a comment. Send back reopens a chosen earlier section and returns to the approver when it is completed again. An approval can need one approver, any one of a group, or all of a group.

Ad-hoc tasks. Anyone working on a submission can add a one-off task with an assignee, due date and attachments, for work the form didn't plan for. It is tracked and reported on the submission but does not change the form.

Task windows. Every task (a section, an approval or an ad-hoc task) opens in its own window with its own link, so it can be opened in a separate browser tab, bookmarked, or sent in a notification that lands directly on it.

| Part of the window | What it shows |
|---|---|
| Header | Form name, the Person it is about, task name, status, due date |
| Assignees | Everyone assigned, with each person's progress and the completion rule (any one, all, or a minimum count) |
| Task fields | Only this task's fields, editable by its assignees |
| Earlier answers | A collapsible, read-only summary of the answers this task is allowed to see |
| Comments and files | This task's comment thread and attachments |
| History | Every change made in this task, with who and when |
| Actions | Complete, Approve / Reject / Send back (approvals), Reassign, Snooze |

Several assignees can have the same task window open at once and see each other's changes live. External people get the same window, minus the parts their access hides.

## Submission lifecycle

A submission moves through six statuses, and Completed is a status, not a lock: a completed submission can still be opened, viewed and edited.

Forms without an approval step go straight from In progress to Completed. After completion, the section assignees and form admins can still edit answers. Each later edit is logged, flagged on the submission as "edited after completion", and synced to the database and the CRM like any other change.

Section statuses run inside the submission: Not started, Open, Completed, Skipped (by a rule), with an Overdue flag when its due date passes.

While filling

- Answers autosave every few seconds and on leaving a field, so nothing is lost if the tab closes.
- Two people in the same section see each other's changes live, and the last write to a field wins with both values kept in history.
- Files upload in the background while the person keeps filling.
- A submission can be started from a link with fields pre-filled through URL parameters.

Due dates and reminders

- Each section's due date is set relative to an event: the submission start, the previous section's completion, or a date field ("3 business days before Start date").
- Owners get a reminder before the due date and a notice when it passes; overdue sections can escalate to the owner's manager after a set delay.
- Owners can snooze a section, and the submission's overall due date is the latest of its section due dates.

Comments and the inbox

- Each section has its own comment thread, and comments can carry files.
- An @mention sends the comment to that person's inbox, which also lists their open sections, pending approvals and snoozed items, with an unread count.
- People can subscribe to a submission or a whole form to be notified of every change.

## Automations and integrations

Automations react to events on a submission and act without anyone clicking; each one is a trigger, optional conditions (the same builder as form rules) and one or more actions.

| Trigger | Typical action |
|---|---|
| Submission started | Post to a Slack or Teams channel |
| Section completed | Email the next owner with a link; push answers to another system |
| Field changed | Update a record in a CRM or spreadsheet |
| Approved / rejected | Notify the requester; start a follow-on form |
| Section due date set or changed | Add or move a calendar event |
| Section overdue | Remind the owner, then escalate to their manager |
| Submission completed | Generate a PDF of the answers; archive files to storage; add a row to a data set |
| Data set row created, updated or deleted | Start a submission, or update the submissions that reference that row |
| Incoming webhook | Start a submission with fields pre-filled from another system |
| Schedule | Start a submission every Monday or on the 1st of each month |

Every automation run is logged with its input, result and any error, and failed runs can be retried. Admins can test an automation against a sample submission before turning it on. Outgoing webhooks and an API let other systems read submissions and start new ones.

Twilio: text messages. Twilio sends every message that goes by phone instead of email, by SMS only.

- Notifications and reminders by SMS: new task assigned, due soon, overdue, sent back. Each person chooses email, SMS or both.
- Share links by text: send an external person their task link by SMS, using the phone number on their Person record.
- Phone verification: external people can receive their one-time sign-in code by SMS.
- Opt-out: replies such as STOP are honored and recorded on the Person, and no further texts go to that number.
- Delivery tracking: every message, its delivery status and any reply are logged on the submission and on the Person's timeline.

Documenso: e-signatures. Signatures go through Documenso, self-hosted beside the CRM. A Signature field in a task sends a document generated from the form's answers to Documenso. The signer signs it there, and the signed PDF and its signing certificate come back to the submission as files. The task completes only when every required signer has signed. This stays in a later release.

## Running inside Twenty CRM (earlier build)

The earlier build ran the editor and the internal filling experience inside Twenty as a Twenty app: a TypeScript package that adds custom objects, server-side logic functions and sandboxed React front components to a workspace.

| Where in Twenty | What people do there | Twenty building block |
|---|---|---|
| Sidebar entry "Forms" | Open the Forms library | Navigation menu item pointing at a saved view of the Form object |
| Form record page | Build the form: sections, fields, rules, assignees, versions | Page layout with the editor as a full-height front component widget |
| Person pages | See that record's submissions, start a new one, fill assigned sections | A "Forms" tab added to the standard Person page layout |
| Command menu (Cmd+K) | "Start a form for this record", "Open my tasks" | Command menu items |
| Task window | Work on one task in its own window | The Form task's own record page, with the task view as a full-height front component |
| App settings | CRM field mapping, email and e-signature settings | Settings menu item |
| AI chat | "Start the onboarding form for Acme" | Logic function exposed as an AI tool |

Forms library. Every form sits behind the single "Forms" link in the sidebar; no form gets its own sidebar link. The library lists all forms: name, category, owner, status (Draft, Published, Archived), latest version, open submissions, overdue submissions, last used. Find a form by search, filter by category, owner or status, group by category. Actions: open in the editor, start a submission, see its submissions, duplicate, archive. New form: start blank or copy an existing form. Submission objects stay out of the main navigation.

Twenty sandbox limits that shaped the editor (canvas renders nothing, no ResizeObserver, drag events carry no data, overlays clipped, unscoped CSS, no origin on outbound requests, front components still changing) led to these editor rules: draw flows in SVG or HTML, lay out with CSS grid and flexbox, reorder with pointer drag plus move buttons and keyboard shortcuts, edit field settings in a side panel not a popover, prefix every class, reach the backend through server functions, and keep a full page version of the editor as a fallback.

Data and sync in the earlier build: fixed objects Form, Form version and Form task; one custom object per form created at publish time through the Metadata API; submissions related to Person records; mapped answers written back to the Person; conflicts on mapped fields resolved latest wins with the overwritten value kept in history; external people filled a standalone page served by the app's public routes.

## Reporting, audit and permissions

Reporting. Each form has a table view with one row per submission and one column per field, filterable and sortable, with saved views and CSV export. A summary sorts open submissions into On track, Due soon and Overdue, counts completions over time, breaks both down by assignee and by section, and shows average time per section.

Data sets. Shared tables such as vendors, locations or price lists. Forms read them through Lookup fields, and automations can write to them.

Audit trail. Every change is recorded on the submission: who changed which field, the old and new value, when, and from which version of the form. Approvals, reassignments, send-backs and automation runs appear in the same history. Completed submissions stay editable, and every change after completion is recorded the same way.

Retention. All information is kept indefinitely; nothing in the tool is permanently deleted.

- Deleting a form, submission, task, comment or file archives it: it disappears from normal views but can be restored by an admin.
- Answers to hidden fields, fields removed in a new form version, and values overwritten by later edits all stay in the history.
- Text messages, emails, signed documents, automation runs and external people's sign-ins are logged and kept.

Privacy purge. The one exception is a legal deletion request (for example under GDPR). Only admins can run a purge, and only for one Person at a time.

1. An admin opens the purge from the Person record and enters the request reference.
2. A second admin approves it; nothing is removed on one person's say-so.
3. The tool removes that person's personal data everywhere it is stored: answers, files, comments, history entries, sign-in records, text message logs, signed documents, and the message records Twilio keeps.
4. Submissions that other people worked on stay, with the purged person's answers replaced by "Removed on request".
5. A purge log entry records who ran and approved it, when, and the request reference, but none of the purged data.

Older backups still hold the data until they expire under the backup schedule.

| Permission | Who has it by default |
|---|---|
| Build and publish the form | Form admins |
| Organize forms in folders | Folder admins; folder permissions apply to every form inside |
| Start a submission | Anyone the admin allows: a group, the whole org, or external people through a public link |
| Edit a section | Its assignees, before and after the submission is completed |
| Fill an assigned section as an external person | The invited person, after a one-time code by email or text |
| View a submission | Everyone assigned to any of its sections, plus form admins |
| Comment on a submission | Anyone who can view it, unless the form turns comments off |
| Share a read-only link to a submission | Off by default; form admins can turn it on |
| View hidden or restricted fields | Only the roles named on the field; never external people unless the field allows it |
| See reports for the form | Form admins and named viewers |

Data model sketch: Form, Form version, Sections, Fields and Rules. Submission, pinned Form version, Section states (owner, status, due date), Answers (one per field key), History events.

Field storage in the earlier build mapped each form field to a Twenty field type (text, rich text, number or currency, date or date time, select or multi select, boolean, relation, files, child object for tables, relation for lookups, matching type for calculated, nothing for content), created the object at first publish, deactivated removed fields, and let only the app write answers.

## Lessons from Process Street

- Load a submission in one request. Return the version definition, answers, section states and permissions together.
- Send only the user fields the screen shows.
- Give every section and field two IDs: one per version, and a group ID that survives versions.
- Store order as sortable keys, not positions, so inserting a field never renumbers the rest.
- Evaluate rules in the browser for speed and again on the server before any section is completed.
- Do not request assets a form does not have.

## Decisions recorded on 12 Oct 2026 (earlier build)

| Topic | Decision |
|---|---|
| Who fills a form | One or more people; every section, task and approval can have several assignees |
| External people | Can fill shared forms and sections, by email invite or share link |
| Form updates | Submissions always move to the latest version |
| Completed submissions | Marked complete, never locked; assignees and admins can still open and edit them |
| Finding forms | One "Forms" link in the sidebar opens a Forms library; forms get no sidebar links of their own |
| Working on a task | Each task opens in its own window, with its own link |
| Text messages | SMS only, through Twilio |
| E-signatures | Documenso, in a later release |
| Retention | All information is kept; deleting archives instead |
| Legal deletion requests | Admin-only purge of one Person's data, approved by a second admin |

Suggested first release: form builder with sections and the 10 most common field types (short and long text, number, date, single and multiple choice, yes/no, person, file upload, content); required fields and format validation; show/hide and skip rules; sections with multiple assignees and sequential handoff; external access by invite and share link; single-approver approvals with send back; drafts with autosave; due dates with reminders; email and SMS notifications; form versioning; a submission table per form with saved views and CSV export; the audit trail; a standalone fill page for external people.

Later: tables, lookups, calculated fields, signatures, parallel sections, multi-approver approvals, automations beyond email, API and webhooks, e-signatures, data sets, AI and Code sections, ad-hoc tasks, and generating a form with AI from a description or an uploaded document.

## Build status of the earlier Twenty build

Built: form editor with sections, all first-release field types, rules, preview, publish, versions; multiple assignees with any, all, or minimum completion; parallel sections and stop points; task windows with autosave, approvals, send back, reassign, snooze, history, comments and files; submissions as records of one object per form linked to People, with edits after completion flagged; Forms library, My tasks, Forms tab on Person pages; outside people with invite links, public links, one-time codes by email or SMS, standalone page; email (SendGrid) and SMS (Twilio) notifications, reminders, overdue notices, escalation, STOP handling, off until keys are added; copying answers to Person fields; retention and the two-admin purge; Forms admin role. Tested by 40 unit tests and three end-to-end suites.

Not built: Documenso e-signatures, file uploads on the outside page, lookups, tables, calculated fields, AI and Code sections, data sets, API and webhooks.

Where that build differed from the spec: answer fields were read-only in Twenty's screens rather than locked on the server; Twenty's record timeline could miss entries until a server restart; each form added one link field to the Person record; each member's notification choice and mobile number were stored on the workspace member record.
