import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md rounded-lg border border-border bg-surface p-6 text-center">
        <h1 className="text-base font-semibold">Not found</h1>
        <p className="text-[13px] text-fg-2 mt-2">This link does not lead anywhere. It may have expired or been turned off.</p>
        <Link href="/" className="inline-block mt-4 text-[13px] text-brand hover:underline">Go to the start page</Link>
      </div>
    </div>
  );
}
