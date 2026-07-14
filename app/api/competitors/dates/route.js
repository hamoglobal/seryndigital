import { NextResponse } from 'next/server';
import { getCompetitorDates } from '@/lib/competitorDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/competitors/dates -> string[] (ISO dates), ascending — every report
// date ingested for the "Đối Thủ" (competitor) page's date picker.
export async function GET() {
  const dates = getCompetitorDates();
  return NextResponse.json(dates);
}
