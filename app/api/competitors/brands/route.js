import { NextResponse } from 'next/server';
import { getCompetitorBrandsForDate } from '@/lib/competitorDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/competitors/brands[?date=YYYY-MM-DD] -> { date, brands: [...] }
// Defaults to the most recent report date. One row per monitored brand:
// badNews/newArticles counts, riskLevel, note.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || undefined;
  const result = getCompetitorBrandsForDate(date);
  return NextResponse.json(result);
}
