"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.classList.contains("dark");
    root.classList.toggle("dark", !next);
    localStorage.setItem("relayflow.theme", next ? "light" : "dark");
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      <Sun className="h-4 w-4 hidden dark:block" />
      <Moon className="h-4 w-4 block dark:hidden" />
    </Button>
  );
}