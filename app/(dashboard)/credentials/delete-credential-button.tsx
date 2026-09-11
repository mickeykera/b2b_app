"use client";

import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";

export function DeleteCredentialButton({ credentialId }: { credentialId: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function remove() {
    if (!confirm("Delete this credential? Actions referencing it will fail.")) return;
    setWorking(true);
    try {
      await fetch(`/api/credentials/${credentialId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={remove}
      disabled={working}
      aria-label="Delete credential"
      className="text-muted-foreground hover:text-destructive"
    >
      {working ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </Button>
  );
}