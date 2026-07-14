import { NextResponse } from 'next/server';
import { getAllDays } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/days -> Day[] (see README schemas) — replaces the static `days` export
// the design prototype used to import from data/seryn-data.js.
export async function GET() {
  const days = getAllDays();
  return NextResponse.json(days);
}
