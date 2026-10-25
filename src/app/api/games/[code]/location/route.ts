import { NextRequest, NextResponse } from 'next/server';
import { SubmitLocationSchema } from '@/lib/validation';
import { submitParticipantGps, getAuthorizedGameState, normalizeRoomCode } from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const cleanCode = normalizeRoomCode(params.code);
    const body = await req.json();
    const parsed = SubmitLocationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid GPS coordinates.' }, { status: 400 });
    }
    const result = await submitParticipantGps({ code: cleanCode, ...parsed.data });
    const snapshot = await getAuthorizedGameState(cleanCode, parsed.data.participantId);
    return NextResponse.json({
      updatedAt: result.updatedAt,
      boundaryCheck: result.boundaryCheck,
      snapshot,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'GPS submission rejected.' }, { status: 400 });
  }
}
