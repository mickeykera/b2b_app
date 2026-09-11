import { Workflow } from "lucide-react";

import { requirePageSession } from "@/lib/session";
import { env } from "@/lib/env";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLinks } from "@/components/nav-links";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="h-4 w-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{env.APP_NAME}</div>
            <div className="text-[10px] text-muted-foreground">Automations</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          <NavLinks />
        </nav>
        <div className="border-t border-border p-2">
          <div className="truncate rounded-md px-2.5 py-1.5 text-xs text-muted-foreground">
            {session.name ?? session.email}
          </div>
          <div className="px-2.5 py-1 text-[10px] text-muted-foreground">
            {env.APP_NAME} v0.1.0
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 md:hidden">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Workflow className="h-4 w-4" aria-hidden />
            </div>
            <span className="text-sm font-semibold">{env.APP_NAME}</span>
          </div>
          <div className="hidden text-sm text-muted-foreground md:block">
            Workspace ·{" "}
            <span className="font-medium text-foreground">{env.APP_NAME}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}