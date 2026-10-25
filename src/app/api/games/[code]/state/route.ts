import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedGameState, normalizeRoomCode } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const cleanCode = normalizeRoomCode(params.code);
    const viewerId = (req.nextUrl.searchParams.get('participantId') || '').trim();
    const sinceRaw = Number(req.nextUrl.searchParams.get('since') || '0');
    const includeMedia = req.nextUrl.searchParams.get('includeMedia') === '1';

    if (!viewerId) {
      return NextResponse.json({ error: 'participantId query parameter is required.' }, { status: 400 });
    }
    const snapshot = await getAuthorizedGameState(cleanCode, viewerId, {
      sinceMs: Number.isFinite(sinceRaw) ? sinceRaw : 0,
      includeMedia,
    });
    return NextResponse.json({ snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not fetch game state.' }, { status: 404 });
  }
}
