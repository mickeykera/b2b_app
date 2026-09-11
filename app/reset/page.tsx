import { Suspense } from "react";

import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Your reset link is active. Pick something you haven&apos;t used here
          before.
        </p>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}