import { AcceptInviteForm } from "./accept-invite-form";

export const metadata = { title: "Accept invitation" };

export default function InvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">
          Join your team workspace
        </h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Set your name and a password to activate your account.
        </p>
        <AcceptInviteForm />
      </div>
    </main>
  );
}