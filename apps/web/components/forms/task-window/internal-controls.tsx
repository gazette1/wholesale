"use client";
/**
 * Actions only signed in team members get: approval decisions, reassign, snooze, and outside invites.
 * The task window loads this file only in internal mode, so the external page never ships it.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveFormTask, rejectFormTask, sendBackFormTask, reassignFormTask, snoozeFormTask, inviteFormParty, revokeFormParty } from "@/lib/actions/forms";
import type { FieldError, TaskWindowData } from "@/lib/forms/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { fmtWhen } from "./format";

type Team = { id: string; name: string }[];
type Outcome = { ok: boolean; error?: string; message?: string; errors?: FieldError[] };

export default function InternalControls({ data, team, flush, onBlocked }: {
  data: TaskWindowData;
  team: Team;
  /** Saves pending answers first. Resolves false when the save did not go through. */
  flush: () => Promise<boolean>;
  onBlocked: (message: string, errors: FieldError[]) => void;
}) {
  const router = useRouter();
  const p = data.permissions;
  const taskId = data.task.id;
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [comment, setComment] = useState("");
  const [backTo, setBackTo] = useState(data.sendBackTargets[0]?.key ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [addMode, setAddMode] = useState(false);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  function run(fn: () => Promise<Outcome>, opts: { saveFirst?: boolean; after?: (o: Outcome) => void } = {}) {
    if (busy.current) return;
    busy.current = true;
    setNote(null);
    start(async () => {
      try {
        if (opts.saveFirst && !(await flush())) { setNote({ tone: "bad", text: "Your answers could not be saved. Try again." }); return; }
        const res = await fn();
        if (!res.ok) {
          if (res.errors?.length) onBlocked(res.error ?? "Some answers need attention.", res.errors);
          setNote({ tone: "bad", text: res.error ?? "That did not work. Try again." });
          return;
        }
        setNote({ tone: "good", text: res.message ?? "Done." });
        opts.after?.(res);
        router.refresh();
      } catch {
        setNote({ tone: "bad", text: "Something went wrong. Try again." });
      } finally {
        busy.current = false;
      }
    });
  }

  const external = data.assignees.filter((a) => a.kind === "external" && a.externalPartyId);

  return (
    <div className="space-y-4">
      {note ? <Alert tone={note.tone === "good" ? "good" : "bad"}>{note.text}</Alert> : null}

      {p.canApprove ? (
        <Card>
          <CardHeader title="Decision" description="Approve, reject, or send this back to an earlier section." />
          <CardBody className="space-y-3">
            <Field label="Decision comment"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="primary" loading={pending} onClick={() => run(() => approveFormTask(taskId, comment.trim() || undefined), { saveFirst: true, after: () => setComment("") })}>Approve</Button>
              <Button type="button" variant="danger" loading={pending} onClick={() => run(() => rejectFormTask(taskId, comment.trim() || undefined), { saveFirst: true, after: () => setComment("") })}>Reject</Button>
            </div>
            {data.sendBackTargets.length ? (
              <div className="space-y-2 border-t border-border pt-3">
                <Field label="Send back to">
                  <Select value={backTo} onChange={(e) => setBackTo(e.target.value)}>
                    {data.sendBackTargets.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
                  </Select>
                </Field>
                <p className="text-xs text-fg-3">Send back needs a decision comment.</p>
                <Button type="button" variant="outline" loading={pending} onClick={() => {
                  if (!comment.trim()) { setNote({ tone: "bad", text: "Write a decision comment before sending this back." }); return; }
                  run(() => sendBackFormTask(taskId, backTo, comment.trim()), { saveFirst: true, after: () => setComment("") });
                }}>Send back</Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {p.canReassign ? (
        <Card>
          <CardHeader title="Reassign" description="Choose who works on this section." />
          <CardBody className="space-y-3">
            <fieldset className="max-h-40 overflow-y-auto space-y-1">
              <legend className="text-xs font-medium text-fg-2 mb-1">Team members</legend>
              {team.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="h-4 w-4" checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />
                  {t.name}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4" checked={addMode} onChange={(e) => setAddMode(e.target.checked)} />Add to the current assignees instead of replacing them</label>
            <Button type="button" variant="outline" loading={pending} onClick={() => {
              if (!picked.length) { setNote({ tone: "bad", text: "Choose at least one team member." }); return; }
              run(() => reassignFormTask(taskId, picked, addMode ? "add" : "replace"), { after: () => setPicked([]) });
            }}>Reassign</Button>
          </CardBody>
        </Card>
      ) : null}

      {p.canSnooze ? (
        <Card>
          <CardHeader title="Snooze" description={data.task.snoozedUntil ? `Snoozed until ${fmtWhen(data.task.snoozedUntil, data.form.timeZone, false)}.` : "Hide this task from your list until a date."} />
          <CardBody className="space-y-3">
            <Field label="Snooze until"><Input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Button type="button" variant="outline" loading={pending} onClick={() => {
                if (!snoozeDate) { setNote({ tone: "bad", text: "Choose a snooze date." }); return; }
                // Morning of the chosen day in this browser's time zone.
                run(() => snoozeFormTask(taskId, new Date(`${snoozeDate}T08:00:00`).toISOString()), { after: () => setSnoozeDate("") });
              }}>Snooze</Button>
              {data.task.snoozedUntil ? <Button type="button" variant="ghost" loading={pending} onClick={() => run(() => snoozeFormTask(taskId, null))}>End snooze</Button> : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {p.canInvite ? (
        <InviteCard data={data} busy={pending} setNote={setNote} link={inviteLink} setLink={setInviteLink} />
      ) : null}

      {external.length ? (
        <Card>
          <CardHeader title="Outside people" description="Revoking a link ends that person's access to this section." />
          <CardBody>
            <ul className="space-y-2">
              {external.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="truncate min-w-0">{a.name}</span>
                  <Button type="button" variant="ghost" size="sm" className="text-bad" aria-label={`Revoke link for ${a.name}`} loading={pending}
                    onClick={() => { if (window.confirm(`Revoke the link for ${a.name}?`)) run(() => revokeFormParty(a.externalPartyId!)); }}>Revoke link</Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function InviteCard({ data, busy, setNote, link, setLink }: {
  data: TaskWindowData; busy: boolean; setNote: (n: { tone: "good" | "bad"; text: string } | null) => void; link: string | null; setLink: (l: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [days, setDays] = useState("14");
  const [singleUse, setSingleUse] = useState(true);
  const [sending, start] = useTransition();
  const fired = useRef(false);
  const [copied, setCopied] = useState(false);

  function invite() {
    if (fired.current) return;
    if (!email.trim() && !phone.trim()) { setNote({ tone: "bad", text: "Enter an email address or a mobile number so the person can verify." }); return; }
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) { setNote({ tone: "bad", text: "Enter an expiry between 1 and 90 days." }); return; }
    fired.current = true;
    setNote(null);
    start(async () => {
      try {
        const res = await inviteFormParty({
          submissionId: data.task.submissionId, sectionKeys: [data.task.sectionKey], name: name.trim() || undefined,
          email: email.trim() || undefined, phone: phone.trim() || undefined, expiresInDays: n, singleUse,
        });
        if (!res.ok) { setNote({ tone: "bad", text: res.error }); return; }
        setLink(res.url ?? null);
        setCopied(false);
        setName(""); setEmail(""); setPhone("");
        setNote({ tone: "good", text: "Invite created. Copy the link below now, it is shown once." });
      } catch {
        setNote({ tone: "bad", text: "Something went wrong. Try again." });
      } finally {
        fired.current = false;
      }
    });
  }

  return (
    <Card>
      <CardHeader title="Invite outside person" description="They see only this section, after a one time code sent to their email or phone." />
      <CardBody className="space-y-2">
        <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></Field>
        <Field label="Mobile number"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></Field>
        <Field label="Link expires in (days)"><Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} />Single use link</label>
        <Button type="button" variant="outline" loading={sending || busy} onClick={invite}>Invite outside person</Button>
        {link ? (
          <div className="rounded-md border border-border bg-surface-2 p-2 space-y-1">
            <label className="block text-xs font-medium text-fg-2" htmlFor="invite-link">Invite link</label>
            <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs" />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}); }}>Copy link</Button>
              {copied ? <span role="status" className="text-xs text-good">Copied</span> : null}
              <Button type="button" size="sm" variant="ghost" onClick={() => setLink(null)}>Hide link</Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
