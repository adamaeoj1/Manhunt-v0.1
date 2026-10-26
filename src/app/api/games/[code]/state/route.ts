import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedGameState, normalizeRoomCode } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const cleanCode = normalizeRoomCode(params.code);
    const viewerId = (req.nextUrl.searchParams.get('participantId') || '').trim();
    const sinceRaw = Number(req.nextUrl.searchParams.get('since') || '0');
    const includeMedia = req.nextUrl.searchParams.get('includeMedia') === '1';

    if (!viewerId) {
      return NextResponse.json(
        { error: 'participantId query parameter is required.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const snapshot = await getAuthorizedGameState(cleanCode, viewerId, {
      sinceMs: Number.isFinite(sinceRaw) ? sinceRaw : 0,
      includeMedia,
    });
    return NextResponse.json({ snapshot }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Could not fetch game state.' },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
}
