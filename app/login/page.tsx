import { Workflow } from "lucide-react";

import { env } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{env.APP_NAME}</h1>
          <p className="text-xs text-muted-foreground">
            Workflow automation & integrations
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signed-in sessions are protected with MFA-ready TOTP and scoped to a
          single organization.
        </p>
      </div>
    </main>
  );
}