import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="text-5xl font-semibold tracking-tight">404</div>
      <p className="text-sm text-muted-foreground">
        This page does not exist, or you do not have access to it.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Back to overview
      </Link>
    </main>
  );
}