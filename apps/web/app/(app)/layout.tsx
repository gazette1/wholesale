import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { providerStatus } from "@dealcalc/integrations";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const status = providerStatus();
  const mocks = Object.entries(status).filter(([, v]) => v === "mock" || v === "pglite" || v === "dev").map(([k]) => k);
  const badge = mocks.length ? `Demo mode: ${mocks.join(", ")}` : undefined;
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar orgName={session.orgName} userName={session.fullName} role={session.role} authMode={session.authMode} providerBadge={badge} />
      <main className="flex-1 min-w-0">
        {demo ? <div className="bg-warn-soft text-warn text-xs px-4 py-1.5 border-b border-[#f3d9b0]">Shared demo. Sample data resets on its own, nothing is sent to sellers, and no real keys are connected.</div> : null}
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-5 fade-in">{children}</div>
      </main>
    </div>
  );
}
