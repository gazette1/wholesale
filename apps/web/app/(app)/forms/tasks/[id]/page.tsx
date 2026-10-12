import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/safe";
import { actorFromSession } from "@/lib/forms/actor";
import { loadTaskWindow } from "@/lib/services/forms";
import { markTaskSeen } from "@/lib/data/forms";
import { listProfiles } from "@/lib/data/leads";
import { saveFormAnswers, completeFormTask, addFormComment } from "@/lib/actions/forms";
import { uploadFormFile } from "@/lib/actions/form-files";
import { TaskWindow } from "@/components/forms/task-window";

export const metadata = { title: "Form task" };

export default async function FormTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const actor = actorFromSession(session);
  const data = await loadTaskWindow(actor, id);
  if (!data) notFound();
  await markTaskSeen(actor, id).catch(() => {});
  const team = (await listProfiles(session.orgId)).map((p) => ({ id: p.id, name: p.fullName, role: p.role }));

  return (
    <>
      <nav className="text-xs text-fg-3 mb-3 flex items-center gap-1 flex-wrap" aria-label="Breadcrumb">
        <Link href="/tasks" className="hover:text-fg">Follow ups</Link>
        <span>/</span>
        <span>Form task</span>
      </nav>
      <TaskWindow
        data={data}
        mode="internal"
        team={team}
        actions={{
          save: saveFormAnswers.bind(null, id),
          complete: completeFormTask.bind(null, id),
          comment: addFormComment.bind(null, null),
          upload: uploadFormFile.bind(null, id),
        }}
      />
    </>
  );
}
