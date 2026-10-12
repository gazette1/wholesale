import type { Metadata } from "next";
import { getExternalActor, resolveFillLink } from "@/lib/services/form-access";
import { listPartyTasks, loadFillWindow } from "@/lib/forms/fill";
import { FillSignIn } from "./sign-in";
import { FillTask } from "./fill-task";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Form" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const STATUS_LABEL: Record<string, string> = { not_started: "Not started", open: "Open", completed: "Completed", skipped: "Skipped" };

function Shell({ orgName, formName, children }: { orgName?: string; formName?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-[860px] mx-auto">
        <header className="mb-6 border-b border-border pb-4">
          {orgName ? <div className="text-[13px] text-fg-3">{orgName}</div> : null}
          {formName ? <h1 className="text-lg font-semibold text-fg">{formName}</h1> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-fg-2 max-w-md">{children}</p>;
}

export default async function FillPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ task?: string | string[] }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const notFound = <Shell><Message>This link is not available. Ask the person who sent it for a new link.</Message></Shell>;
  if (!TOKEN_RE.test(token)) return notFound;

  const link = await resolveFillLink(token);
  if (link.status === "not_found") return notFound;
  if (link.status === "expired") return <Shell><Message>This link has expired. Ask the person who sent it for a new link.</Message></Shell>;
  if (link.status === "revoked") return <Shell><Message>This link is no longer active.</Message></Shell>;
  if (link.status === "used") return <Shell><Message>This link has already been used. Your answers were sent. You can close this page.</Message></Shell>;

  const head = { orgName: link.orgName, formName: link.formName };
  const actor = await getExternalActor(token);
  if (!actor) {
    return (
      <Shell {...head}>
        <p className="text-[14px] text-fg-2 mb-6 max-w-md">Enter the one time code we send you to open this form.</p>
        <FillSignIn token={token} kind={link.kind ?? "invite"} maskedEmail={link.maskedEmail} maskedPhone={link.maskedPhone} />
      </Shell>
    );
  }

  const tasks = await listPartyTasks(actor);
  if (tasks.length === 0) return <Shell {...head}><Message>There is nothing for you to fill in right now.</Message></Shell>;
  const requested = Array.isArray(sp.task) ? sp.task[0] : sp.task;
  const { selectedId, data } = await loadFillWindow(actor, tasks, requested);
  const done = data?.task.status === "completed";

  return (
    <Shell {...head}>
      {tasks.length > 1 ? (
        <nav aria-label="Your sections" className="mb-6">
          <ul className="flex flex-wrap gap-2">
            {tasks.map((t) => (
              <li key={t.taskId}>
                <a href={`/fill/${token}?task=${t.taskId}`} aria-current={t.taskId === selectedId ? "page" : undefined}
                  className={`inline-block rounded-md border px-3 py-1.5 text-[13px] ${t.taskId === selectedId ? "border-brand text-fg font-medium" : "border-border text-fg-2"}`}>
                  {t.sectionTitle} <span className="text-fg-3">({STATUS_LABEL[t.status] ?? t.status})</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {done ? <p role="status" className="mb-4 text-[14px] text-good">Your answers were sent. You can close this page.</p> : null}
      {data ? <FillTask token={token} data={data} /> : <Message>This section is not available to you.</Message>}
    </Shell>
  );
}
