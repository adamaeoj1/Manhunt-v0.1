import { NextRequest, NextResponse } from 'next/server';
import { GameActionSchema } from '@/lib/validation';
import { performGameAction, getAuthorizedGameState, normalizeRoomCode } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const cleanCode = normalizeRoomCode(params.code);
    const body = await req.json();
    const parsed = GameActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid game action payload.' }, { status: 400 });
    }
    const result = await performGameAction(cleanCode, parsed.data);
    const snapshot = await getAuthorizedGameState(cleanCode, parsed.data.participantId);
    return NextResponse.json({ ...result, snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Game action failed.' }, { status: 400 });
  }
}
