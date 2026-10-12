import type { Session } from "@/lib/auth";
import { SubjectForms } from "@/components/forms/task-window/subject-forms";

/** Forms section on the buyer page. Reads form data only, never deal numbers. */
export function BuyerForms({ session, buyerId }: { session: Session; buyerId: string }) {
  return <SubjectForms session={session} subject={{ kind: "buyer", id: buyerId }} />;
}
