import { NextRequest, NextResponse } from 'next/server';
import { CreateGameSchema } from '@/lib/validation';
import { createGameSession, getAuthorizedGameState } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateGameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid game configuration.' }, { status: 400 });
    }
    const created = await createGameSession(parsed.data);
    const snapshot = await getAuthorizedGameState(created.code, created.participantId);
    return NextResponse.json({ code: created.code, participantId: created.participantId, storageMode: created.storageMode, snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not create game session.' }, { status: 400 });
  }
}
