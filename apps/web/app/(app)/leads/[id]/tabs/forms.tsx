import type { Session } from "@/lib/auth";
import { SubjectForms } from "@/components/forms/task-window/subject-forms";

/** Forms tab on the lead page. */
export function FormsTab({ session, leadId }: { session: Session; leadId: string }) {
  return <SubjectForms session={session} subject={{ kind: "lead", id: leadId }} />;
}
