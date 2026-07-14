import { NextResponse } from 'next/server';
import { getSourcesByDay } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/sources -> { [date]: Source[] } (see README schemas) — replaces the
// static `sourcesByDay` export the design prototype used to import.
export async function GET() {
  const sourcesByDay = getSourcesByDay();
  return NextResponse.json(sourcesByDay);
}
