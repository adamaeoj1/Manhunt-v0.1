import { NextRequest, NextResponse } from 'next/server';
import {
  CreateGameSchema,
  JoinGameSchema,
  GameActionSchema,
  SubmitLocationSchema,
} from '@/lib/validation';
import {
  createGameSession,
  joinGameSession,
  performGameAction,
  submitParticipantGps,
  getAuthorizedGameState,
  getRoomPreview,
  getRadioClip,
  getPhotoRequestMedia,
  normalizeRoomCode,
} from '@/lib/game-engine';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(req: NextRequest) {
  try {
    const rawCode = req.nextUrl.searchParams.get('code') || '';
    const cleanCode = normalizeRoomCode(rawCode);
    const isPreview = req.nextUrl.searchParams.get('preview') === '1';

    if (isPreview) {
      if (cleanCode.length !== 6) {
        return NextResponse.json(
          { error: 'Valid 6-character room code is required.' },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      const preview = await getRoomPreview(cleanCode);
      if (!preview) {
        return NextResponse.json(
          { error: `Room "${cleanCode}" was not found or has expired.` },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }
      return NextResponse.json({ preview }, { headers: NO_STORE_HEADERS });
    }

    const clipId = req.nextUrl.searchParams.get('clipId');
    if (clipId) {
      if (!cleanCode) {
        return NextResponse.json(
          { error: 'Valid room code is required.' },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      const clip = await getRadioClip(cleanCode, clipId);
      if (!clip) {
        return NextResponse.json(
          { error: 'Radio clip was not found or expired.' },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }
      return NextResponse.json({ clip }, { headers: NO_STORE_HEADERS });
    }

    const photoRequestId = req.nextUrl.searchParams.get('photoRequestId');
    const photoHiderId = req.nextUrl.searchParams.get('photoHiderId');
    if (photoRequestId || photoHiderId) {
      if (!cleanCode) {
        return NextResponse.json(
          { error: 'Valid room code is required.' },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      const photo = await getPhotoRequestMedia(cleanCode, {
        photoRequestId: photoRequestId || undefined,
        hiderId: photoHiderId || undefined,
      });
      if (!photo) {
        return NextResponse.json(
          { error: 'Requested photo was not found or expired.' },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }
      return NextResponse.json({ photo }, { headers: NO_STORE_HEADERS });
    }

    const viewerId = (req.nextUrl.searchParams.get('participantId') || '').trim();
    const sinceRaw = Number(req.nextUrl.searchParams.get('since') || '0');
    const includeMedia = req.nextUrl.searchParams.get('includeMedia') === '1';

    if (!cleanCode || !viewerId) {
      return NextResponse.json(
        { error: 'Both code and participantId query parameters are required.' },
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const op = typeof body?.op === 'string' ? body.op.toUpperCase() : 'CREATE';

    if (op === 'JOIN') {
      const cleanCode = normalizeRoomCode(body.code || '');
      if (cleanCode.length !== 6) {
        return NextResponse.json(
          { error: 'Please enter a valid 6-character room code.' },
          { status: 400 }
        );
      }
      const parsed = JoinGameSchema.safeParse({ nickname: body.nickname });
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid nickname.' },
          { status: 400 }
        );
      }
      const joined = await joinGameSession(cleanCode, parsed.data.nickname);
      const snapshot = await getAuthorizedGameState(joined.code, joined.participantId, {
        includeMedia: true,
      });
      return NextResponse.json({
        code: joined.code,
        participantId: joined.participantId,
        storageMode: joined.storageMode,
        snapshot,
      });
    }

    if (op === 'ACTION') {
      const cleanCode = normalizeRoomCode(body.code || '');
      const { op: _op, code: _code, ...actionPayload } = body;
      const parsed = GameActionSchema.safeParse(actionPayload);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid game action payload.' },
          { status: 400 }
        );
      }
      const result = await performGameAction(cleanCode, parsed.data);
      const snapshot = await getAuthorizedGameState(cleanCode, parsed.data.participantId);
      return NextResponse.json({ ...result, snapshot });
    }

    if (op === 'LOCATION') {
      const cleanCode = normalizeRoomCode(body.code || '');
      const { op: _op, code: _code, ...locPayload } = body;
      const parsed = SubmitLocationSchema.safeParse(locPayload);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid GPS coordinates.' },
          { status: 400 }
        );
      }
      const result = await submitParticipantGps({ code: cleanCode, ...parsed.data });
      const snapshot = await getAuthorizedGameState(cleanCode, parsed.data.participantId);
      return NextResponse.json({
        updatedAt: result.updatedAt,
        boundaryCheck: result.boundaryCheck,
        snapshot,
      });
    }

    // Default: CREATE
    const parsed = CreateGameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid game configuration.' },
        { status: 400 }
      );
    }
    const created = await createGameSession(parsed.data);
    const snapshot = await getAuthorizedGameState(created.code, created.participantId, {
      includeMedia: true,
    });
    return NextResponse.json({
      code: created.code,
      participantId: created.participantId,
      storageMode: created.storageMode,
      snapshot,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Could not process game request.' },
      { status: 400 }
    );
  }
}
