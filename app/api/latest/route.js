import { NextResponse } from 'next/server';
import { getLatestDetail } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/latest[?date=YYYY-MM-DD] -> LatestDetail (see README schemas).
// Defaults to the most recent ingested day, matching the prototype's `latest`
// export; accepts an optional ?date= so a specific day/period's detail can be
// fetched too (a forward-looking improvement flagged in the design handoff).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || undefined;
  const latest = getLatestDetail(date);
  if (!latest) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(latest);
}
