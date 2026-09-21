import { LinkButton } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="max-w-lg mx-auto mt-16 rounded-lg border border-border bg-surface p-6 text-center">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="text-[13px] text-fg-2 mt-2">That record does not exist, was deleted, or belongs to another workspace.</p>
      <div className="flex items-center justify-center gap-2 mt-4">
        <LinkButton href="/dashboard" variant="primary">Dashboard</LinkButton>
        <LinkButton href="/leads" variant="outline">Leads</LinkButton>
        <LinkButton href="/analyzer" variant="outline">Deal Analyzer</LinkButton>
      </div>
    </div>
  );
}
