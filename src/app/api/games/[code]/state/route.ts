import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedGameState } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const viewerId = req.nextUrl.searchParams.get('participantId') || '';
    if (!viewerId) return NextResponse.json({ error: 'participantId query parameter is required.' }, { status: 400 });
    const snapshot = await getAuthorizedGameState(params.code, viewerId);
    return NextResponse.json({ snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not fetch game state.' }, { status: 404 });
  }
}
