import { redirect } from "next/navigation";
import { createPackage } from "@/lib/actions/packages";

/** GET /packages/new?analysis=... creates a package and lands on its preview. */
export default async function NewPackagePage({ searchParams }: { searchParams: Promise<{ analysis?: string }> }) {
  const { analysis } = await searchParams;
  if (!analysis) redirect("/analyzer");
  await createPackage(analysis);
}
