import type { Metadata } from "next";

import { env } from "@/lib/env";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${env.APP_NAME} — Workflow Automation`,
    template: `%s · ${env.APP_NAME}`,
  },
  description:
    "Multi-tenant B2B workflow automation and integrations: webhooks, DAG execution, audit, and dead-letter observability.",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("relayflow.theme")==="dark"||(!localStorage.getItem("relayflow.theme")&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}