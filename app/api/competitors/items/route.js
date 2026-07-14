import { NextResponse } from 'next/server';
import { getCompetitorItems } from '@/lib/competitorDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/competitors/items[?date=][&brand=][&type=bad_news|new_article]
// -> item[]. Defaults to the most recent report date; brand/type filter the
// detail list shown when drilling into one brand's row.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || undefined;
  const brand = searchParams.get('brand') || undefined;
  const type = searchParams.get('type') || undefined;
  const items = getCompetitorItems({ date, brand, type });
  return NextResponse.json(items);
}
