import { requirePageSession } from "@/lib/session";
import { listCredentials } from "@/lib/data/credentials";
import { WorkflowBuilder } from "./workflow-builder";

export const metadata = { title: "New workflow" };
export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  const session = await requirePageSession();
  const credentials = await listCredentials(session.org);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">New workflow</h2>
        <p className="text-sm text-muted-foreground">
          Pick a trigger, then an action. The generated pipeline is a validated
          DAG you can edit later from the workflow page.
        </p>
      </div>
      <WorkflowBuilder
        credentials={credentials.map((credential) => ({
          id: credential.id,
          name: credential.name,
          provider: credential.provider,
        }))}
      />
    </div>
  );
}