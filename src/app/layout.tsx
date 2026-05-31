import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Social Autopilot",
  description: "AI drafts your social posts; you approve them each morning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white">
                  ✓
                </span>
                Social Autopilot
              </Link>
              <nav className="flex items-center gap-4 text-sm text-slate-600">
                <Link href="/" className="hover:text-slate-900">
                  Review queue
                </Link>
                <Link href="/analytics" className="hover:text-slate-900">
                  Analytics
                </Link>
                <Link href="/connections" className="hover:text-slate-900">
                  Connections
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
