import { NextRequest, NextResponse } from 'next/server';
import { JoinGameSchema } from '@/lib/validation';
import { joinGameSession, getAuthorizedGameState } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const body = await req.json();
    const parsed = JoinGameSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid nickname.' }, { status: 400 });
    const joined = await joinGameSession(params.code, parsed.data.nickname);
    const snapshot = await getAuthorizedGameState(joined.code, joined.participantId);
    return NextResponse.json({ code: joined.code, participantId: joined.participantId, storageMode: joined.storageMode, snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not join game.' }, { status: 400 });
  }
}
