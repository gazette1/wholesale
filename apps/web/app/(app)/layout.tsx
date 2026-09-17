import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { providerStatus } from "@dealcalc/integrations";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const status = providerStatus();
  const mocks = Object.entries(status).filter(([, v]) => v === "mock" || v === "pglite" || v === "dev").map(([k]) => k);
  const badge = mocks.length ? `Demo mode: ${mocks.join(", ")}` : undefined;
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar orgName={session.orgName} userName={session.fullName} role={session.role} authMode={session.authMode} providerBadge={badge} />
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-5 fade-in">{children}</div>
      </main>
    </div>
  );
}
