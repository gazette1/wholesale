import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Acquisitions CRM", template: "%s · Acquisitions CRM" },
  description: "Lead pipeline, property reports, deal analyzer, buyers, and deal packages.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
