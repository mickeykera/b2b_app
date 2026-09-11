import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Enter your account email and we&apos;ll send you a one-time reset link.
        </p>
        <ForgotForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <a className="underline" href="/login">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}