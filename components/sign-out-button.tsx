"use client";

import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";

export function SignOutButton() {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function signOut() {
    setWorking(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={working}>
      {working ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <LogOut className="h-3.5 w-3.5" />
      )}
      Sign out
    </Button>
  );
}