"use client";
/**
 * The task window: one section of a form submission, with its fields, people, comments, and history.
 * Internal mode serves signed in team members and adds approval, reassign, snooze, and invite controls.
 * External mode serves an outside person on a fill link and carries only what the data holds.
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateAnswer, type FieldDef } from "@dealcalc/forms";
import type { FieldError, TaskWindowData } from "@/lib/forms/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Select, Textarea, Field } from "@/components/ui/input";
import { useServerForm } from "@/components/ui/action-form";
import { FieldInput, displayValue, labelsFor, type ChangeOptions } from "./field-input";
import { SUBMISSION_STATUS, TASK_STATUS, fmtWhen, historyLabel, ruleText } from "./task-window/format";

// Loaded only in internal mode, so the external page never ships the internal actions.
const InternalControls = dynamic(() => import("./task-window/internal-controls"), { ssr: false });

export type TaskWindowActions = {
  save: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; errors?: { fieldKey: string; message: string }[]; evaluation?: TaskWindowData["evaluation"] }>;
  complete: () => Promise<{ ok: boolean; error?: string; errors?: { fieldKey: string; message: string }[] }>;
  comment: (form: FormData) => Promise<{ ok: boolean; error?: string }>;
  upload: (fieldKey: string, form: FormData) => Promise<{ ok: boolean; error?: string; id?: string }>;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };
type Summary = { message: string; errors: FieldError[] };

const SAVE_INTERVAL_MS = 3000;

export function TaskWindow(props: { data: TaskWindowData; mode: "internal" | "external"; actions: TaskWindowActions; team?: { id: string; name: string; role?: string }[] }) {
  const { data, mode, actions } = props;
  const team = useMemo(() => props.team ?? [], [props.team]);
  const router = useRouter();
  const external = mode === "external";
  const tz = data.form.timeZone;

  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...data.answers }));
  const [evaluation, setEvaluation] = useState(data.evaluation);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const fileUrls = Object.fromEntries(Object.entries(data.files ?? {}).map(([id, f]) => [id, f.url]));
  const [fileNames, setFileNames] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(data.files ?? {}).map(([id, f]) => [id, f.name])));

  const valuesRef = useRef(values);
  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const lastSaveOk = useRef(true);
  const summaryRef = useRef<HTMLDivElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // A refresh brings new server data (for example after a handoff). Take it when nothing is waiting to be saved.
  useEffect(() => {
    if (dirty.current.size === 0 && !inflight.current) {
      valuesRef.current = { ...data.answers };
      setValues(valuesRef.current);
      setEvaluation(data.evaluation);
    }
  }, [data]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inflight.current) await inflight.current;
    if (dirty.current.size === 0) return lastSaveOk.current;
    const keys = [...dirty.current];
    dirty.current.clear();
    const patch: Record<string, unknown> = {};
    for (const k of keys) patch[k] = valuesRef.current[k] ?? null;
    setSave({ kind: "saving" });
    const job = (async () => {
      try {
        const res = await actionsRef.current.save(patch);
        if (!res.ok) {
          for (const k of keys) dirty.current.add(k);
          lastSaveOk.current = false;
          setSave({ kind: "error", message: res.error ?? "Could not save your answers." });
          return;
        }
        lastSaveOk.current = true;
        const bad = new Map((res.errors ?? []).map((e) => [e.fieldKey, e.message]));
        setErrors((prev) => {
          const next = { ...prev };
          for (const k of keys) { if (bad.has(k)) next[k] = bad.get(k)!; else delete next[k]; }
          return next;
        });
        if (res.evaluation) {
          setEvaluation(res.evaluation);
          // Values a rule set arrive here. Keep anything the person has typed since.
          const set = res.evaluation.setValues;
          const apply = Object.keys(set).filter((k) => !dirty.current.has(k));
          if (apply.length) {
            const next = { ...valuesRef.current };
            for (const k of apply) next[k] = set[k];
            valuesRef.current = next;
            setValues(next);
          }
        }
        setSave({ kind: "saved" });
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s)), 4000);
      } catch {
        for (const k of keys) dirty.current.add(k);
        lastSaveOk.current = false;
        setSave({ kind: "error", message: "Could not save your answers. Check your connection." });
      }
    })();
    inflight.current = job;
    await job;
    if (inflight.current === job) inflight.current = null;
    return lastSaveOk.current;
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; void flush(); }, SAVE_INTERVAL_MS);
  }, [flush]);

  const fieldMap = useMemo(() => new Map(data.section.fields.map((f) => [f.key, f])), [data.section.fields]);
  const allFields = useMemo(() => [...data.section.fields, ...data.earlierSections.flatMap((s) => s.fields)], [data]);
  const labels = useMemo(() => labelsFor(allFields), [allFields]);

  const change = useCallback((field: FieldDef, value: unknown, opts?: ChangeOptions) => {
    const next = { ...valuesRef.current, [field.key]: value };
    valuesRef.current = next;
    setValues(next);
    dirty.current.add(field.key);
    setNote(null);
    // Clear a shown error as soon as the value is acceptable; new errors appear when the person leaves the field.
    setErrors((prev) => {
      if (!(field.key in prev)) return prev;
      const msg = value === null || value === "" ? null : validateAnswer(field, value, next);
      if (msg) return prev;
      const copy = { ...prev };
      delete copy[field.key];
      return copy;
    });
    if (opts?.immediate) void flush(); else schedule();
  }, [flush, schedule]);

  const blur = useCallback((field: FieldDef) => {
    const value = valuesRef.current[field.key];
    const msg = value === null || value === undefined || value === "" ? null : validateAnswer(field, value, valuesRef.current);
    setErrors((prev) => {
      if (msg) return { ...prev, [field.key]: msg };
      if (!(field.key in prev)) return prev;
      const copy = { ...prev };
      delete copy[field.key];
      return copy;
    });
    if (dirty.current.size) void flush();
  }, [flush]);

  const upload = useCallback(async (fieldKey: string, file: File) => {
    const form = new FormData();
    form.set("fieldKey", fieldKey);
    form.set("file", file);
    const res = await actionsRef.current.upload(fieldKey, form);
    if (res.ok && res.id) {
      const id = res.id;
      setFileNames((prev) => ({ ...prev, [id]: file.name }));
      const held = Array.isArray(valuesRef.current[fieldKey]) ? (valuesRef.current[fieldKey] as unknown[]) : [];
      const next = { ...valuesRef.current, [fieldKey]: [...held, id] };
      valuesRef.current = next;
      setValues(next);
    }
    return res;
  }, []);

  const showBlocked = useCallback((message: string, errs: FieldError[]) => {
    setSummary({ message, errors: errs });
    setErrors((prev) => {
      const next = { ...prev };
      for (const e of errs) if (e.fieldKey) next[e.fieldKey] = e.message;
      return next;
    });
    setTimeout(() => summaryRef.current?.focus(), 0);
  }, []);

  async function complete() {
    if (completing) return;
    setCompleting(true);
    setSummary(null);
    setNote(null);
    try {
      if (!(await flush())) { showBlocked("Your answers could not be saved. Try again.", []); return; }
      const res = await actions.complete();
      if (res.ok) {
        setNote("This section is complete.");
        router.refresh();
      } else {
        showBlocked(res.error ?? "Some answers still need attention.", res.errors ?? []);
      }
    } catch {
      showBlocked("Something went wrong. Try again.", []);
    } finally {
      setCompleting(false);
    }
  }

  function jumpTo(fieldKey: string, e: React.MouseEvent) {
    const el = document.getElementById(`field-${fieldKey}`);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: "center" });
    el.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
  }

  const p = data.permissions;
  const visibleFields = data.section.fields.filter((f) => evaluation.fieldVisible[f.key] !== false);
  // Inputs stay disabled until the page hydrates, so nothing typed into the server HTML is lost.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const editable = p.canEdit;
  const taskStatus = TASK_STATUS[data.task.status];
  const subStatus = SUBMISSION_STATUS[data.submission.status];
  const doneCount = data.assignees.filter((a) => a.completedAt).length;
  const fieldLabel = (key: string | null) => (key ? allFields.find((f) => f.key === key)?.label ?? "an answer" : "");
  const historyValue = (key: string | null, v: unknown) => {
    const f = key ? allFields.find((x) => x.key === key) : undefined;
    return f ? displayValue(f, v, team) : v === null || v === undefined ? "empty" : String(v);
  };

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <p className="text-xs text-fg-3">
          {data.form.name}
          {data.submission.subjectLabel ? <> · {!external && data.submission.leadId ? <Link href={`/leads/${data.submission.leadId}?tab=forms`} className="hover:underline">{data.submission.subjectLabel}</Link> : !external && data.submission.buyerId ? <Link href={`/buyers/${data.submission.buyerId}`} className="hover:underline">{data.submission.subjectLabel}</Link> : data.submission.subjectLabel}</> : null}
        </p>
        <h1 className="text-lg font-semibold leading-6">{data.section.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={taskStatus.tone}>{taskStatus.label}</Badge>
          {!external ? <Badge tone={subStatus.tone}>{subStatus.label}</Badge> : null}
          {data.task.dueAt ? <span className="text-xs text-fg-3">Due {fmtWhen(data.task.dueAt, tz, false)}</span> : null}
          {data.task.snoozedUntil && new Date(data.task.snoozedUntil).getTime() > Date.now() ? <Badge tone="neutral">Snoozed until {fmtWhen(data.task.snoozedUntil, tz, false)}</Badge> : null}
          {data.submission.editedAfterCompletion ? <Badge tone="warn">Edited after completion</Badge> : null}
          {data.section.needsApproval ? <Badge tone="brand">Approval</Badge> : null}
        </div>
        {data.section.description ? <p className="text-[13px] text-fg-2">{data.section.description}</p> : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Card>
            <CardHeader title="Answers" description={editable ? "Changes save automatically." : p.canEdit ? undefined : "This section is read only for you."}
              actions={<span role="status" aria-live="polite" className={save.kind === "error" ? "text-xs text-bad" : "text-xs text-fg-3"}>{save.kind === "saving" ? "Saving" : save.kind === "saved" ? "Saved" : save.kind === "error" ? save.message : ""}</span>} />
            <CardBody className="space-y-4">
              {summary ? (
                <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-[#f3c0c0] bg-bad-soft px-3 py-2 text-[13px] text-bad focus:outline-none focus-visible:ring-2 focus-visible:ring-bad/40">
                  <p className="font-medium">{summary.message}</p>
                  {summary.errors.length ? (
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">
                      {summary.errors.map((e, i) => {
                        const label = fieldMap.get(e.fieldKey)?.label;
                        return <li key={`${e.fieldKey}-${i}`}>{label ? <a href={`#field-${e.fieldKey}`} onClick={(ev) => jumpTo(e.fieldKey, ev)} className="underline">{label}</a> : null}{label ? ": " : ""}{e.message}</li>;
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {note ? <Alert tone="good">{note}</Alert> : null}
              {visibleFields.length === 0 ? <p className="text-[13px] text-fg-3">There are no fields to fill in for this section.</p> : null}
              {visibleFields.map((f) => (
                <FieldInput key={f.key} field={f} value={values[f.key]} answers={values} labels={labels} team={team} mode={mode}
                  required={evaluation.fieldRequired[f.key] === true} error={errors[f.key]} fileNames={fileNames} fileUrls={fileUrls}
                  disabled={!hydrated || !editable || f.readOnly || (external && f.type === "person")}
                  onChange={(v, o) => change(f, v, o)} onBlur={() => blur(f)} onUpload={upload} />
              ))}
              {p.canComplete ? (
                <div className="pt-2 border-t border-border">
                  <Button type="button" variant="primary" loading={completing} onClick={() => void complete()}>Complete section</Button>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {data.earlierSections.length ? (
            <details className="rounded-lg border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium">Earlier answers</summary>
              <div className="px-4 pb-4 space-y-4">
                {data.earlierSections.map((s) => (
                  <section key={s.key} aria-label={s.title}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3 mb-1">{s.title}</h3>
                    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      {s.fields.map((f) => (
                        <div key={f.key} className="min-w-0">
                          <dt className="text-xs text-fg-3">{f.label}</dt>
                          <dd className="text-[13px] text-fg whitespace-pre-wrap break-words">{displayValue(f, data.answers[f.key], team)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </details>
          ) : null}

          <CommentsCard data={data} mode={mode} comment={actions.comment} team={team} tz={tz} />
        </div>

        <div className="space-y-4 min-w-0">
          <Card>
            <CardHeader title="People" description={ruleText(data.task.completionRule, data.assignees.length)} />
            <CardBody>
              {external ? (
                <p className="text-[13px] text-fg-2">{doneCount} of {data.assignees.length} {data.assignees.length === 1 ? "person has" : "people have"} completed this section.</p>
              ) : data.assignees.length === 0 ? <p className="text-[13px] text-fg-3">No one is assigned.</p> : (
                <ul className="space-y-1.5">
                  {data.assignees.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate min-w-0">{a.name}{a.kind === "external" ? <span className="text-fg-3"> (outside)</span> : null}</span>
                      {a.completedAt ? <Badge tone="good">Done {fmtWhen(a.completedAt, tz, false)}</Badge> : <Badge tone="neutral">In progress</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {!external && data.assignees.length ? <p className="mt-2 text-xs text-fg-3">{doneCount} of {data.assignees.length} done.</p> : null}
            </CardBody>
          </Card>

          {!external ? <InternalControls data={data} team={team} flush={flush} onBlocked={showBlocked} /> : null}

          <HistoryCard data={data} external={external} tz={tz} fieldLabel={fieldLabel} historyValue={historyValue} />
        </div>
      </div>
    </div>
  );
}

function HistoryCard({ data, external, tz, fieldLabel, historyValue }: {
  data: TaskWindowData; external: boolean; tz: string; fieldLabel: (key: string | null) => string; historyValue: (key: string | null, v: unknown) => string;
}) {
  if (data.history.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium">History</summary>
      <ul className="px-4 pb-4 space-y-2">
        {data.history.map((h) => (
          <li key={h.id} className="text-[13px]">
            <div>{h.actorName}: {historyLabel(h.kind)}{h.fieldKey ? ` (${fieldLabel(h.fieldKey)})` : ""}</div>
            {!external && h.kind === "answer_changed" ? <div className="text-xs text-fg-3 break-words">From {historyValue(h.fieldKey, h.before)} to {historyValue(h.fieldKey, h.after)}</div> : null}
            <div className="text-xs text-fg-3">{fmtWhen(h.at, tz)}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CommentsCard({ data, mode, comment, team, tz }: { data: TaskWindowData; mode: "internal" | "external"; comment: TaskWindowActions["comment"]; team: { id: string; name: string }[]; tz: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const canPost = data.permissions.canComment && data.form.commentsEnabled;
  const { state, pending, onSubmit } = useServerForm(async (form) => {
    const r = await comment(form);
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error ?? "Could not post the comment." };
  }, {
    onSuccess: () => { setBody(""); setMentions([]); if (fileInput.current) fileInput.current.value = ""; router.refresh(); },
  });
  const pickable = team.filter((t) => !mentions.some((m) => m.id === t.id));

  return (
    <Card>
      <CardHeader title="Comments and files" />
      <CardBody className="space-y-4">
        {data.comments.length === 0 ? <p className="text-[13px] text-fg-3">No comments yet.</p> : (
          <ul className="space-y-3">
            {data.comments.map((c) => (
              <li key={c.id} className="text-[13px]">
                <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{c.authorName}</span><span className="text-xs text-fg-3">{fmtWhen(c.createdAt, tz)}</span></div>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
                {c.files.length ? <ul className="mt-1 text-xs text-fg-2 list-disc pl-5">{c.files.map((f) => { const url = data.files?.[f.documentId]?.url; return <li key={f.documentId}>{url ? <a href={url} className="underline" target="_blank" rel="noreferrer">{f.filename}</a> : f.filename}</li>; })}</ul> : null}
              </li>
            ))}
          </ul>
        )}
        {canPost ? (
          <form onSubmit={onSubmit} className="space-y-2 border-t border-border pt-3">
            <input type="hidden" name="taskId" value={data.task.id} />
            {mentions.map((m) => <input key={m.id} type="hidden" name="mentionIds" value={m.id} />)}
            <Field label="Comment"><Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} /></Field>
            {mode === "internal" && team.length ? (
              <div className="space-y-1">
                <Field label="Mention a team member">
                  <Select value="" onChange={(e) => {
                    const t = team.find((x) => x.id === e.target.value);
                    if (!t) return;
                    setMentions((m) => [...m, t]);
                    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${t.name} `);
                  }}>
                    <option value="">Choose a person</option>
                    {pickable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                {mentions.length ? <p className="text-xs text-fg-3">Mentioning {mentions.map((m) => m.name).join(", ")}.</p> : null}
              </div>
            ) : null}
            <div>
              <label htmlFor="comment-files" className="block text-xs font-medium text-fg-2 mb-1">Attach files</label>
              <input id="comment-files" ref={fileInput} type="file" name="files" multiple className="block w-full text-[13px] text-fg-2 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-2.5 file:py-1 file:text-xs" />
            </div>
            <Button type="submit" variant="outline" loading={pending}>Add comment</Button>
            {state && !state.ok && !pending ? <Alert tone="bad">{state.error}</Alert> : null}
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
