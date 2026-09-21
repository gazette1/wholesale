import { redirect } from "next/navigation";
import { openPackage } from "@/lib/actions/packages";

/**
 * GET /packages/new?analysis=... opens the newest package for the analysis and only creates one when none exists,
 * so a refresh, the back button, or a link prefetch never piles up versions. New versions come from the button on the preview.
 */
export default async function NewPackagePage({ searchParams }: { searchParams: Promise<{ analysis?: string }> }) {
  const { analysis } = await searchParams;
  if (!analysis) redirect("/analyzer");
  await openPackage(analysis);
}
