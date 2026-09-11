import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { listRuns } from "@/lib/data/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  const url = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const result = await listRuns(session.org, query.data);
  return NextResponse.json(result);
}