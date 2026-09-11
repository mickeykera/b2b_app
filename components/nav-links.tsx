"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Activity, FileKey2, History, Settings, Zap } from "lucide-react";

import { cn } from "@/components/ui";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: BarChart3 },
  { href: "/workflows", label: "Workflows", icon: Zap },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/credentials", label: "Credentials", icon: FileKey2 },
  { href: "/audit", label: "Audit", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 p-2">
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              active && "bg-accent text-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}