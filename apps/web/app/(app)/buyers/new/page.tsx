import { requireSession, requireCan } from "@/lib/auth";
import { PageHeader } from "@/components/ui/misc";
import { NewBuyerForm } from "./form";

export const metadata = { title: "New buyer" };

export default async function NewBuyerPage() {
  const session = await requireSession();
  requireCan(session, "buyer:write");
  return (
    <>
      <PageHeader title="New buyer" crumbs={[{ label: "Buyers", href: "/buyers" }, { label: "New" }]} description="Contact details now, the full buy box on the next page." />
      <NewBuyerForm />
    </>
  );
}
