import crypto from 'crypto';
import {
  evaluatePlayBoundary,
  calculateDistanceMeters,
  GPS_UPDATE_INTERVAL_SECONDS,
  MAX_CAPTURE_DISTANCE_METERS,
  CatchVerificationMode,
  TeammateVisibilityMode,
  HunterVisibilityMode,
  TauntType,
} from './validation';
import { isSupabaseConfigured, getSupabaseAdminClient } from './supabase-server';

export type GameState = 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'FINISHED';
export type PlayerRole = 'HUNTER' | 'HIDER';
export type VisibleRole = PlayerRole | 'HIDDEN' | null;

export interface BoundaryConfig {
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface ParticipantRecord {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  ready: boolean;
  status: 'ACTIVE' | 'CAPTURED';
  capturedByNickname: string | null;
  capturesCount: number;
  gpsConsent: boolean;
  gpsDenied: boolean;
  audioUnlocked: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface LocationRecord {
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: number;
  distanceMeters: number;
  outsideMeters: number;
  isOutside: boolean;
}

export interface PhotoRequestRecord {
  id: string;
  hunterId: string;
  hiderId: string;
  status: 'PENDING' | 'SUBMITTED' | 'DECLINED' | 'EXPIRED';
  createdAt: number;
  expiresAt: number;
  photoDataUrl: string | null;
  submittedAt: number | null;
}

export interface SoundAlertRecord {
  id: string;
  hunterId: string;
  targetHiderId: string;
  deliveryStatus: string;
  createdAt: number;
}

export interface WalkieTalkieMessageRecord {
  id: string;
  senderId: string;
  senderNickname: string;
  senderRole: PlayerRole | null;
  audioDataUrl: string;
  disguised: boolean;
  durationSeconds: number;
  createdAt: number;
}

export interface TauntAlertRecord {
  id: string;
  senderId: string;
  senderNickname: string;
  senderRole: PlayerRole | null;
  tauntType: TauntType;
  createdAt: number;
}

export interface CaptureLogRecord {
  id: string;
  hunterId: string;
  hunterNickname: string;
  hiderId: string;
  hiderNickname: string;
  capturedAt: number;
}

export interface GameRecord {
  id: string;
  code: string;
  title: string;
  state: GameState;
  hostId: string;
  createdAt: number;
  countdownEndsAt: number | null;
  endsAt: number | null;
  pausedRemainingMs: number | null;
  winnerTeam: 'HUNTERS' | 'HIDERS' | 'NONE' | null;
  winReason: string | null;
  settings: {
    maxPlayers: number;
    hunterCount: number;
    durationMinutes: number;
    countdownSeconds: number;
    gpsIntervalSeconds: number;
    soundUsesPerHunter: number;
    soundCooldownSeconds: number;
    photoRequestsPerHider: number;
    ghostCloakUsesPerHider: number;
    walkieTalkieEnabled: boolean;
    hunterVisibilityMode: HunterVisibilityMode;
    catchVerificationMode: CatchVerificationMode;
    outOfBoundsGraceSeconds: number;
    teammateVisibility: TeammateVisibilityMode;
    shrinkingZone: boolean;
    initialRadiusMeters: number;
    boundary: BoundaryConfig;
  };
  participants: Map<string, ParticipantRecord>;
  secretRoles: Map<string, PlayerRole>;
  locations: Map<string, LocationRecord>;
  soundUsage: Map<string, { usedCount: number; cooldownUntil: number }>;
  soundAlerts: SoundAlertRecord[];
  walkieMessages: WalkieTalkieMessageRecord[];
  tauntAlerts: TauntAlertRecord[];
  capturesLog: CaptureLogRecord[];
  tauntCooldownByParticipant: Map<string, number>;
  photoRequestsByHider: Map<string, PhotoRequestRecord>;
  photoRequestCountByHider: Map<string, number>;
  outsideSinceByParticipant: Map<string, number>;
  ghostCloakByHider: Map<string, { usedCount: number; maxUses: number; activeUntil: number }>;
  catchPinsByHider: Map<string, string>;
}

const AVATAR_COLORS = ['#14532D', '#C2410C', '#0369A1', '#7E22CE', '#B45309', '#BE123C'];

const globalForManhunt = globalThis as unknown as {
  auiManhuntRooms?: Map<string, GameRecord>;
};

function getLocalRooms(): Map<string, GameRecord> {
  if (!globalForManhunt.auiManhuntRooms) {
    globalForManhunt.auiManhuntRooms = new Map<string, GameRecord>();
  }
  return globalForManhunt.auiManhuntRooms;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function generateSecureId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function csprngAssignRoles(participantIds: string[], hunterCount: number): Map<string, PlayerRole> {
  const shuffled = [...participantIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const roles = new Map<string, PlayerRole>();
  shuffled.forEach((id, idx) => {
    roles.set(id, idx < hunterCount ? 'HUNTER' : 'HIDER');
  });
  return roles;
}

function computeEffectiveRadiusMeters(game: GameRecord, now: number): number {
  const initialRadius = game.settings.initialRadiusMeters || game.settings.boundary.radiusMeters;
  if (!game.settings.shrinkingZone || (game.state !== 'ACTIVE' && game.state !== 'PAUSED')) {
    return initialRadius;
  }
  const totalMs = game.settings.durationMinutes * 60 * 1000;
  const remainingMs =
    game.state === 'PAUSED'
      ? game.pausedRemainingMs ?? totalMs
      : game.endsAt
      ? Math.max(0, game.endsAt - now)
      : totalMs;
  const elapsedMs = Math.max(0, totalMs - remainingMs);
  const halfMs = totalMs / 2;
  if (elapsedMs < halfMs) {
    return initialRadius;
  }
  // Shrink by 15% when entering the second half, and an additional 15% every 5 minutes thereafter
  const fiveMinutesMs = 5 * 60 * 1000;
  const shrinkSteps = Math.floor((elapsedMs - halfMs) / fiveMinutesMs) + 1;
  return Math.max(60, Math.round(initialRadius * Math.pow(0.85, shrinkSteps)));
}

function tickLocalLifecycle(game: GameRecord): void {
  const now = Date.now();
  if (game.state === 'COUNTDOWN' && game.countdownEndsAt && now >= game.countdownEndsAt) {
    game.state = 'ACTIVE';
  }
  if (game.state === 'ACTIVE' && game.endsAt && now >= game.endsAt) {
    const remainingHiders = Array.from(game.participants.values()).filter(
      (p) => game.secretRoles.get(p.id) === 'HIDER' && p.status === 'ACTIVE'
    );
    finishLocalGame(game, 'HIDERS', `Time expired with ${remainingHiders.length} Hider(s) still free on campus!`);
  }
  if (game.state === 'ACTIVE' || game.state === 'PAUSED') {
    const effectiveRadius = computeEffectiveRadiusMeters(game, now);
    if (game.settings.boundary.radiusMeters !== effectiveRadius) {
      game.settings.boundary.radiusMeters = effectiveRadius;
      // Re-evaluate participant boundary status when zone shrinks
      for (const [pid, loc] of Array.from(game.locations.entries())) {
        const check = evaluatePlayBoundary(loc.lat, loc.lng, loc.accuracy, game.settings.boundary);
        loc.distanceMeters = check.distanceMeters;
        loc.outsideMeters = check.outsideMeters;
        loc.isOutside = check.isOutsideWithGrace;
        if (loc.isOutside) {
          if (!game.outsideSinceByParticipant.has(pid)) {
            game.outsideSinceByParticipant.set(pid, now);
          }
        } else {
          game.outsideSinceByParticipant.delete(pid);
        }
      }
    }
  }
  for (const req of Array.from(game.photoRequestsByHider.values())) {
    if (req.status === 'PENDING' && now >= req.expiresAt) {
      req.status = 'EXPIRED';
    }
  }
}

function finishLocalGame(game: GameRecord, winnerTeam: 'HUNTERS' | 'HIDERS' | 'NONE', winReason: string): void {
  game.state = 'FINISHED';
  game.winnerTeam = winnerTeam;
  game.winReason = winReason;
  game.locations.clear();
  game.outsideSinceByParticipant.clear();
  for (const req of Array.from(game.photoRequestsByHider.values())) {
    req.photoDataUrl = null;
  }
}

export async function createGameSession(input: {
  hostNickname: string;
  title?: string;
  hunterCount: number;
  durationMinutes: number;
  countdownSeconds: number;
  gpsIntervalSeconds?: number;
  soundUses: number;
  soundCooldownSeconds: number;
  photoRequestsPerHider?: number;
  ghostCloakUsesPerHider?: number;
  walkieTalkieEnabled?: boolean;
  hunterVisibilityMode?: HunterVisibilityMode;
  catchVerificationMode?: CatchVerificationMode;
  outOfBoundsGraceSeconds?: number;
  teammateVisibility?: TeammateVisibilityMode;
  shrinkingZone?: boolean;
  boundary: BoundaryConfig;
}) {
  const cleanHostNickname = input.hostNickname.trim();
  if (cleanHostNickname.length < 3 || cleanHostNickname.length > 15) {
    throw new Error('Nickname must be between 3 and 15 characters.');
  }

  const code = generateRoomCode();
  const now = Date.now();
  const photoRequestsPerHider = input.photoRequestsPerHider ?? 1;
  const ghostCloakUsesPerHider = input.ghostCloakUsesPerHider ?? 1;
  const walkieTalkieEnabled = input.walkieTalkieEnabled ?? true;
  const hunterVisibilityMode: HunterVisibilityMode = input.hunterVisibilityMode ?? 'ALWAYS_LIVE';
  const gpsIntervalSeconds = input.gpsIntervalSeconds ?? GPS_UPDATE_INTERVAL_SECONDS;
  const catchVerificationMode: CatchVerificationMode = input.catchVerificationMode ?? 'PROXIMITY_20M';
  const outOfBoundsGraceSeconds = input.outOfBoundsGraceSeconds ?? 60;
  const teammateVisibility: TeammateVisibilityMode = input.teammateVisibility ?? 'SHOW_TEAMMATES';
  const shrinkingZone = Boolean(input.shrinkingZone);

  if (isSupabaseConfigured()) {
    const sb = getSupabaseAdminClient();
    const { data: gameRow, error: gErr } = await sb
      .from('games')
      .insert({
        code,
        title: input.title || 'AUI Campus Manhunt',
        state: 'LOBBY',
        hunter_count: input.hunterCount,
        duration_minutes: input.durationMinutes,
        countdown_seconds: input.countdownSeconds,
        sound_uses_per_hunter: input.soundUses,
        sound_cooldown_seconds: input.soundCooldownSeconds,
        boundary_lat: input.boundary.lat,
        boundary_lng: input.boundary.lng,
        boundary_radius_m: input.boundary.radiusMeters,
      })
      .select('*')
      .single();

    if (gErr || !gameRow) throw new Error(gErr?.message || 'Failed to create game in Supabase.');

    const { data: hostRow, error: pErr } = await sb
      .from('participants')
      .insert({
        game_id: gameRow.id,
        nickname: cleanHostNickname,
        avatar_color: AVATAR_COLORS[0],
        is_host: true,
        ready: false,
        status: 'ACTIVE',
      })
      .select('*')
      .single();

    if (pErr || !hostRow) throw new Error(pErr?.message || 'Failed to create host participant.');

    await sb.from('games').update({ host_participant_id: hostRow.id }).eq('id', gameRow.id);

    return { code, participantId: hostRow.id, storageMode: 'SUPABASE' as const };
  }

  const rooms = getLocalRooms();
  const hostId = generateSecureId('plr');
  const game: GameRecord = {
    id: generateSecureId('game'),
    code,
    title: (input.title || 'AUI Campus Manhunt').trim(),
    state: 'LOBBY',
    hostId,
    createdAt: now,
    countdownEndsAt: null,
    endsAt: null,
    pausedRemainingMs: null,
    winnerTeam: null,
    winReason: null,
    settings: {
      maxPlayers: 12,
      hunterCount: input.hunterCount,
      durationMinutes: input.durationMinutes,
      countdownSeconds: input.countdownSeconds,
      gpsIntervalSeconds,
      soundUsesPerHunter: input.soundUses,
      soundCooldownSeconds: input.soundCooldownSeconds,
      photoRequestsPerHider,
      ghostCloakUsesPerHider,
      walkieTalkieEnabled,
      hunterVisibilityMode,
      catchVerificationMode,
      outOfBoundsGraceSeconds,
      teammateVisibility,
      shrinkingZone,
      initialRadiusMeters: input.boundary.radiusMeters,
      boundary: { ...input.boundary },
    },
    participants: new Map(),
    secretRoles: new Map(),
    locations: new Map(),
    soundUsage: new Map(),
    soundAlerts: [],
    walkieMessages: [],
    tauntAlerts: [],
    capturesLog: [],
    tauntCooldownByParticipant: new Map(),
    photoRequestsByHider: new Map(),
    photoRequestCountByHider: new Map(),
    outsideSinceByParticipant: new Map(),
    ghostCloakByHider: new Map(),
    catchPinsByHider: new Map(),
  };

  game.participants.set(hostId, {
    id: hostId,
    nickname: cleanHostNickname,
    color: AVATAR_COLORS[0],
    isHost: true,
    ready: false,
    status: 'ACTIVE',
    capturedByNickname: null,
    capturesCount: 0,
    gpsConsent: false,
    gpsDenied: false,
    audioUnlocked: false,
    connected: true,
    joinedAt: now,
  });

  rooms.set(code, game);
  return { code, participantId: hostId, storageMode: 'LOCAL_MEMORY' as const };
}

export async function joinGameSession(code: string, nickname: string) {
  const cleanCode = code.trim().toUpperCase();
  const cleanName = nickname.trim();

  if (cleanName.length < 3 || cleanName.length > 15) {
    throw new Error('Nickname must be between 3 and 15 characters.');
  }

  if (isSupabaseConfigured() && !getLocalRooms().has(cleanCode)) {
    const sb = getSupabaseAdminClient();
    const { data: gameRow } = await sb.from('games').select('*').eq('code', cleanCode).single();
    if (!gameRow) throw new Error('Room code not found. Check the 6-character code with your host.');
    if (gameRow.state !== 'LOBBY') throw new Error('This game has already started.');

    const { data: existingPlayers } = await sb.from('participants').select('*').eq('game_id', gameRow.id);
    const list = existingPlayers || [];
    if (list.length >= 12) throw new Error('This game lobby is full (12 players max).');
    if (list.some((p) => p.nickname.trim().toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`Nickname "${cleanName}" is already taken in this lobby.`);
    }

    const color = AVATAR_COLORS[list.length % AVATAR_COLORS.length];
    const { data: newPlayer, error: pErr } = await sb
      .from('participants')
      .insert({
        game_id: gameRow.id,
        nickname: cleanName,
        avatar_color: color,
        is_host: false,
        ready: false,
        status: 'ACTIVE',
      })
      .select('*')
      .single();

    if (pErr || !newPlayer) throw new Error(pErr?.message || 'Could not join game.');
    return { code: cleanCode, participantId: newPlayer.id, storageMode: 'SUPABASE' as const };
  }

  const game = getLocalRooms().get(cleanCode);
  if (!game) throw new Error('Room code not found. Check the 6-character code with your host.');
  if (game.state !== 'LOBBY') throw new Error('This game has already started.');
  if (game.participants.size >= game.settings.maxPlayers) throw new Error('This game lobby is full.');
  for (const p of Array.from(game.participants.values())) {
    if (p.nickname.trim().toLowerCase() === cleanName.toLowerCase()) {
      throw new Error(`Nickname "${cleanName}" is already taken in this lobby.`);
    }
  }

  const participantId = generateSecureId('plr');
  const color = AVATAR_COLORS[game.participants.size % AVATAR_COLORS.length];
  game.participants.set(participantId, {
    id: participantId,
    nickname: cleanName,
    color,
    isHost: false,
    ready: false,
    status: 'ACTIVE',
    capturedByNickname: null,
    capturesCount: 0,
    gpsConsent: false,
    gpsDenied: false,
    audioUnlocked: false,
    connected: true,
    joinedAt: Date.now(),
  });

  return { code: cleanCode, participantId, storageMode: 'LOCAL_MEMORY' as const };
}

export async function submitParticipantGps(input: {
  code: string;
  participantId: string;
  lat: number;
  lng: number;
  accuracy: number;
  isManualFallback?: boolean;
}) {
  if (input.isManualFallback) {
    throw new Error('Manual or simulated coordinates are rejected. Real device GPS is required.');
  }
  if (
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng) ||
    !Number.isFinite(input.accuracy) ||
    input.lat < -90 ||
    input.lat > 90 ||
    input.lng < -180 ||
    input.lng > 180 ||
    input.accuracy <= 0 ||
    input.accuracy > 2500
  ) {
    throw new Error('Invalid or out-of-range GPS coordinates.');
  }

  const cleanCode = input.code.trim().toUpperCase();

  if (isSupabaseConfigured() && !getLocalRooms().has(cleanCode)) {
    const sb = getSupabaseAdminClient();
    const { data: gameRow } = await sb.from('games').select('*').eq('code', cleanCode).single();
    if (!gameRow) throw new Error('Game not found.');
    if (gameRow.state !== 'COUNTDOWN' && gameRow.state !== 'ACTIVE') {
      throw new Error('GPS updates are only accepted during COUNTDOWN or ACTIVE game states.');
    }

    const { data: pRow } = await sb
      .from('participants')
      .select('*')
      .eq('id', input.participantId)
      .eq('game_id', gameRow.id)
      .single();

    if (!pRow) throw new Error('Participant not found in this game.');
    if (!pRow.gps_consent) {
      throw new Error('Location consent is required before submitting GPS.');
    }
    if (pRow.status !== 'ACTIVE') throw new Error('Captured players do not transmit live GPS.');

    const boundaryCheck = evaluatePlayBoundary(input.lat, input.lng, input.accuracy, {
      lat: gameRow.boundary_lat,
      lng: gameRow.boundary_lng,
      radiusMeters: gameRow.boundary_radius_m,
    });
    if (boundaryCheck.distanceMeters > 25000) {
      throw new Error('GPS coordinates rejected: position is too far from the campus play area.');
    }

    const nowIso = new Date().toISOString();
    await sb.from('participant_locations').upsert({
      game_id: gameRow.id,
      participant_id: input.participantId,
      lat: input.lat,
      lng: input.lng,
      accuracy_m: Math.round(input.accuracy),
      outside_meters: boundaryCheck.outsideMeters,
      is_outside: boundaryCheck.isOutsideWithGrace,
      updated_at: nowIso,
    });

    await sb
      .from('participants')
      .update({ gps_consent: true, gps_denied: false, last_seen_at: nowIso })
      .eq('id', input.participantId);
    return { updatedAt: Date.now(), boundaryCheck };
  }

  const game = getLocalRooms().get(cleanCode);
  if (!game) throw new Error('Game not found.');
  tickLocalLifecycle(game);

  if (game.state !== 'COUNTDOWN' && game.state !== 'ACTIVE') {
    throw new Error('GPS updates are only accepted during COUNTDOWN or ACTIVE game states.');
  }

  const participant = game.participants.get(input.participantId);
  if (!participant) throw new Error('Participant not found in this game.');
  if (!participant.gpsConsent) throw new Error('Location consent is required before submitting GPS coordinates.');
  if (participant.status !== 'ACTIVE') throw new Error('Captured players do not share live locations.');

  const boundaryCheck = evaluatePlayBoundary(input.lat, input.lng, input.accuracy, game.settings.boundary);
  if (boundaryCheck.distanceMeters > 25000) {
    throw new Error('GPS coordinates rejected: position is too far from the campus play area.');
  }
  const updatedAt = Date.now();
  participant.gpsDenied = false;
  if (boundaryCheck.isOutsideWithGrace) {
    if (!game.outsideSinceByParticipant.has(input.participantId)) {
      game.outsideSinceByParticipant.set(input.participantId, updatedAt);
    }
  } else {
    game.outsideSinceByParticipant.delete(input.participantId);
  }
  game.locations.set(input.participantId, {
    lat: input.lat,
    lng: input.lng,
    accuracy: Math.round(input.accuracy),
    updatedAt,
    distanceMeters: boundaryCheck.distanceMeters,
    outsideMeters: boundaryCheck.outsideMeters,
    isOutside: boundaryCheck.isOutsideWithGrace,
  });

  return { updatedAt, boundaryCheck };
}

export async function performGameAction(code: string, payload: Record<string, unknown>) {
  const cleanCode = code.trim().toUpperCase();
  const action = String(payload.action);
  const participantId = String(payload.participantId);

  if (isSupabaseConfigured() && !getLocalRooms().has(cleanCode)) {
    return performSupabaseGameAction(cleanCode, action, participantId, payload);
  }

  const game = getLocalRooms().get(cleanCode);
  if (!game) throw new Error('Game not found.');
  tickLocalLifecycle(game);

  const actor = game.participants.get(participantId);
  if (!actor) throw new Error('Participant is not a member of this game.');

  switch (action) {
    case 'TOGGLE_READY': {
      if (game.state === 'LOBBY') actor.ready = !actor.ready;
      return { ok: true };
    }
    case 'UPDATE_RULES': {
      if (game.hostId !== participantId) throw new Error('Only the host can update game settings.');
      if (payload.walkieTalkieEnabled !== undefined) {
        game.settings.walkieTalkieEnabled = Boolean(payload.walkieTalkieEnabled);
      }
      if (payload.hunterVisibilityMode !== undefined) {
        const hVis = String(payload.hunterVisibilityMode);
        if (hVis === 'ALWAYS_LIVE' || hVis === 'RADAR_PING_15S' || hVis === 'HIDDEN') {
          game.settings.hunterVisibilityMode = hVis;
        }
      }
      if (game.state === 'LOBBY') {
        game.settings.hunterCount = Math.max(1, Math.min(5, Number(payload.hunterCount) || 1));
        game.settings.durationMinutes = Math.max(5, Math.min(90, Number(payload.durationMinutes) || 20));
        if (payload.countdownSeconds !== undefined) {
          game.settings.countdownSeconds = Math.max(0, Math.min(120, Number(payload.countdownSeconds)));
        }
        if (payload.gpsIntervalSeconds !== undefined) {
          game.settings.gpsIntervalSeconds = Math.max(10, Math.min(180, Number(payload.gpsIntervalSeconds)));
        }
        if (payload.soundUses !== undefined) {
          game.settings.soundUsesPerHunter = Math.max(1, Math.min(10, Number(payload.soundUses)));
        }
        if (payload.soundCooldownSeconds !== undefined) {
          game.settings.soundCooldownSeconds = Math.max(30, Math.min(300, Number(payload.soundCooldownSeconds)));
        }
        if (payload.photoRequestsPerHider !== undefined) {
          game.settings.photoRequestsPerHider = Math.max(0, Math.min(5, Number(payload.photoRequestsPerHider)));
        }
        if (payload.ghostCloakUsesPerHider !== undefined) {
          game.settings.ghostCloakUsesPerHider = Math.max(0, Math.min(5, Number(payload.ghostCloakUsesPerHider)));
        }
        if (payload.catchVerificationMode !== undefined) {
          const mode = String(payload.catchVerificationMode);
          if (mode === 'PROXIMITY_20M' || mode === 'CATCH_PIN' || mode === 'INSTANT_TAP') {
            game.settings.catchVerificationMode = mode;
          }
        }
        if (payload.outOfBoundsGraceSeconds !== undefined) {
          game.settings.outOfBoundsGraceSeconds = Math.max(15, Math.min(180, Number(payload.outOfBoundsGraceSeconds)));
        }
        if (payload.teammateVisibility !== undefined) {
          const vis = String(payload.teammateVisibility);
          if (vis === 'SHOW_TEAMMATES' || vis === 'HIDE_TEAMMATES') {
            game.settings.teammateVisibility = vis;
          }
        }
        if (payload.shrinkingZone !== undefined) {
          game.settings.shrinkingZone = Boolean(payload.shrinkingZone);
        }
        if (payload.boundaryRadiusMeters !== undefined) {
          const r = Math.max(80, Math.min(1500, Number(payload.boundaryRadiusMeters)));
          game.settings.boundary.radiusMeters = r;
          game.settings.initialRadiusMeters = r;
        }
      }
      return { ok: true };
    }
    case 'START_GAME': {
      if (game.hostId !== participantId) throw new Error('Only the host can start the game.');
      if (game.state !== 'LOBBY') throw new Error('Game has already started.');
      const players = Array.from(game.participants.values());
      if (players.length < 2) throw new Error('At least 2 players are required to start Manhunt.');
      if (game.settings.hunterCount >= players.length) {
        throw new Error(`With ${players.length} players, you can select at most ${players.length - 1} Hunter(s).`);
      }
      if (players.some((p) => !p.ready)) {
        throw new Error('All players in the lobby must be Ready before starting the game.');
      }

      const assigned = csprngAssignRoles(players.map((p) => p.id), game.settings.hunterCount);
      game.secretRoles = assigned;
      game.soundUsage.clear();
      game.soundAlerts = [];
      game.walkieMessages = [];
      game.tauntAlerts = [];
      game.capturesLog = [];
      game.tauntCooldownByParticipant.clear();
      game.photoRequestsByHider.clear();
      game.photoRequestCountByHider.clear();
      game.locations.clear();
      game.outsideSinceByParticipant.clear();
      game.ghostCloakByHider.clear();
      game.catchPinsByHider.clear();
      game.settings.boundary.radiusMeters = game.settings.initialRadiusMeters || game.settings.boundary.radiusMeters;

      const maxCloakUses = game.settings.ghostCloakUsesPerHider ?? 1;
      for (const [id, role] of Array.from(assigned.entries())) {
        if (role === 'HUNTER') {
          game.soundUsage.set(id, { usedCount: 0, cooldownUntil: 0 });
        } else {
          const randomPin = String(crypto.randomInt(10, 100));
          game.catchPinsByHider.set(id, randomPin);
          game.ghostCloakByHider.set(id, { usedCount: 0, maxUses: maxCloakUses, activeUntil: 0 });
        }
        const p = game.participants.get(id);
        if (p) {
          p.status = 'ACTIVE';
          p.capturedByNickname = null;
          p.capturesCount = 0;
        }
      }

      const now = Date.now();
      const countdownMs = game.settings.countdownSeconds * 1000;
      if (countdownMs > 0) {
        game.state = 'COUNTDOWN';
        game.countdownEndsAt = now + countdownMs;
        game.endsAt = game.countdownEndsAt + game.settings.durationMinutes * 60 * 1000;
      } else {
        game.state = 'ACTIVE';
        game.countdownEndsAt = now;
        game.endsAt = now + game.settings.durationMinutes * 60 * 1000;
      }
      return { ok: true };
    }
    case 'SET_CONSENT': {
      actor.gpsConsent = Boolean(payload.consent);
      actor.gpsDenied = Boolean(payload.denied);
      if (!actor.gpsConsent) game.locations.delete(participantId);
      return { ok: true };
    }
    case 'UNLOCK_AUDIO': {
      actor.audioUnlocked = true;
      return { ok: true };
    }
    case 'ACTIVATE_GHOST_CLOAK': {
      if (game.state !== 'ACTIVE') throw new Error('Ghost Cloak can only be activated during an active hunt.');
      if (game.secretRoles.get(participantId) !== 'HIDER') throw new Error('Only Hiders can activate Ghost Cloak.');
      if (actor.status !== 'ACTIVE') throw new Error('Captured Hiders cannot activate Ghost Cloak.');
      const maxUses = game.settings.ghostCloakUsesPerHider ?? 1;
      if (maxUses <= 0) {
        throw new Error('Ghost Cloak is disabled for this match.');
      }
      const now = Date.now();
      const existing = game.ghostCloakByHider.get(participantId) || {
        usedCount: 0,
        maxUses,
        activeUntil: 0,
      };
      if (now < existing.activeUntil) {
        throw new Error('Ghost Cloak is already active!');
      }
      if (existing.usedCount >= maxUses) {
        throw new Error(`All Ghost Cloak uses (${maxUses}) have already been used in this match.`);
      }
      const activeUntil = now + 60 * 1000;
      game.ghostCloakByHider.set(participantId, {
        usedCount: existing.usedCount + 1,
        maxUses,
        activeUntil,
      });
      return { ok: true, activeUntil, remainingUses: Math.max(0, maxUses - (existing.usedCount + 1)) };
    }
    case 'SEND_WALKIE_TALKIE': {
      if (!game.settings.walkieTalkieEnabled) {
        throw new Error('Walkie-Talkie radio is disabled by the host.');
      }
      const audioDataUrl = String(payload.audioDataUrl || '');
      if (!audioDataUrl) throw new Error('Audio clip is required.');
      const disguised = Boolean(payload.disguised);
      const durationSeconds = Math.max(0.5, Math.min(8, Number(payload.durationSeconds) || 3));
      const now = Date.now();

      const msg: WalkieTalkieMessageRecord = {
        id: generateSecureId('wt'),
        senderId: participantId,
        senderNickname: actor.nickname,
        senderRole: game.secretRoles.get(participantId) || null,
        audioDataUrl,
        disguised,
        durationSeconds,
        createdAt: now,
      };
      // Keep only recent messages (last 25s, max 8 clips) to keep memory light
      game.walkieMessages = game.walkieMessages
        .filter((m) => now - m.createdAt < 25000)
        .slice(-7);
      game.walkieMessages.push(msg);
      return { ok: true, messageId: msg.id };
    }
    case 'SEND_TAUNT': {
      const tauntTypeRaw = String(payload.tauntType || 'CATCH_ME');
      const validTypes: TauntType[] = ['CATCH_ME', 'I_SEE_YOU', 'AIRHORN', 'TOO_SLOW'];
      const tauntType: TauntType = validTypes.includes(tauntTypeRaw as TauntType)
        ? (tauntTypeRaw as TauntType)
        : 'CATCH_ME';

      const now = Date.now();
      const cooldownUntil = game.tauntCooldownByParticipant.get(participantId) || 0;
      if (now < cooldownUntil) {
        const waitSec = Math.ceil((cooldownUntil - now) / 1000);
        throw new Error(`Quick Taunt on cooldown (${waitSec}s left).`);
      }

      game.tauntCooldownByParticipant.set(participantId, now + 15 * 1000);
      const taunt: TauntAlertRecord = {
        id: generateSecureId('tnt'),
        senderId: participantId,
        senderNickname: actor.nickname,
        senderRole: game.secretRoles.get(participantId) || null,
        tauntType,
        createdAt: now,
      };
      game.tauntAlerts = game.tauntAlerts.filter((t) => now - t.createdAt < 20000).slice(-12);
      game.tauntAlerts.push(taunt);
      return { ok: true, tauntId: taunt.id };
    }
    case 'SEND_SOUND': {
      if (game.state !== 'ACTIVE') throw new Error('Sound alerts require an active game.');
      if (game.secretRoles.get(participantId) !== 'HUNTER') throw new Error('Only Hunters can send sound alerts.');
      const targetHiderId = String(payload.targetHiderId);
      if (game.secretRoles.get(targetHiderId) !== 'HIDER') throw new Error('Target must be a Hider.');
      const target = game.participants.get(targetHiderId);
      if (!target || target.status !== 'ACTIVE') throw new Error('Target Hider is no longer active.');

      const usage = game.soundUsage.get(participantId) || { usedCount: 0, cooldownUntil: 0 };
      const now = Date.now();
      if (usage.usedCount >= game.settings.soundUsesPerHunter) throw new Error('No sound alerts remaining.');
      if (now < usage.cooldownUntil) {
        const waitSec = Math.ceil((usage.cooldownUntil - now) / 1000);
        throw new Error(`Sound alert on cooldown (${waitSec}s left).`);
      }

      usage.usedCount += 1;
      usage.cooldownUntil = now + game.settings.soundCooldownSeconds * 1000;
      game.soundUsage.set(participantId, usage);

      const deliveryStatus = !target.connected
        ? 'Target offline'
        : target.audioUnlocked
        ? `Sound alert delivered to ${target.nickname} (4s Siren triggered)`
        : `Alert delivered to ${target.nickname} (waiting for them to tap Enable Sound)`;

      const alertRecord: SoundAlertRecord = {
        id: generateSecureId('snd'),
        hunterId: participantId,
        targetHiderId,
        deliveryStatus,
        createdAt: now,
      };
      game.soundAlerts.push(alertRecord);
      return { ok: true, deliveryStatus, alertId: alertRecord.id };
    }
    case 'REQUEST_PHOTO': {
      if (game.state !== 'ACTIVE') throw new Error('Photo requests require an active game.');
      if (game.secretRoles.get(participantId) !== 'HUNTER') throw new Error('Only Hunters can request a photo.');
      const maxPhotos = game.settings.photoRequestsPerHider ?? 1;
      if (maxPhotos <= 0) {
        throw new Error('Photo requests are disabled for this game.');
      }
      const targetHiderId = String(payload.targetHiderId);
      if (game.secretRoles.get(targetHiderId) !== 'HIDER') throw new Error('Target must be a Hider.');
      const target = game.participants.get(targetHiderId);
      if (!target || target.status !== 'ACTIVE') throw new Error('Target Hider is already caught.');
      const usedCount = game.photoRequestCountByHider.get(targetHiderId) || 0;
      const existingReq = game.photoRequestsByHider.get(targetHiderId);
      if (existingReq && existingReq.status === 'PENDING') {
        throw new Error(`${target.nickname} already has a pending photo request.`);
      }
      if (usedCount >= maxPhotos) {
        throw new Error(`${target.nickname}'s photo request limit (${maxPhotos}) was already reached this game.`);
      }

      const now = Date.now();
      const req: PhotoRequestRecord = {
        id: generateSecureId('photo'),
        hunterId: participantId,
        hiderId: targetHiderId,
        status: 'PENDING',
        createdAt: now,
        expiresAt: now + 90 * 1000,
        photoDataUrl: null,
        submittedAt: null,
      };
      game.photoRequestsByHider.set(targetHiderId, req);
      game.photoRequestCountByHider.set(targetHiderId, usedCount + 1);
      return { ok: true, photoRequestId: req.id };
    }
    case 'RESPOND_PHOTO': {
      const req = game.photoRequestsByHider.get(participantId);
      if (!req) throw new Error('No photo request found for your player.');
      if (req.status !== 'PENDING') throw new Error(`This photo request is already ${req.status.toLowerCase()}.`);
      if (payload.declined) {
        req.status = 'DECLINED';
        return { ok: true };
      }
      const dataUrl = String(payload.photoDataUrl || '');
      if (!dataUrl.startsWith('data:image/')) throw new Error('Valid captured image is required.');
      req.status = 'SUBMITTED';
      req.photoDataUrl = dataUrl;
      req.submittedAt = Date.now();
      return { ok: true };
    }
    case 'MARK_CAUGHT': {
      if (game.state !== 'ACTIVE') {
        throw new Error('Captures are only allowed when the hunt is actively running.');
      }
      const targetHiderId = String(payload.targetHiderId);
      const isHunter = game.secretRoles.get(participantId) === 'HUNTER';
      const isHost = game.hostId === participantId;
      const isSelf = participantId === targetHiderId;
      if (!isHunter && !isHost && !isSelf) throw new Error('Unauthorized capture action.');
      if (game.secretRoles.get(targetHiderId) !== 'HIDER') throw new Error('Only Hiders can be marked caught.');

      const target = game.participants.get(targetHiderId);
      if (!target) throw new Error('Target player not found.');
      if (target.status === 'CAPTURED') throw new Error('This Hider has already been captured.');

      if (!isSelf) {
        const mode = game.settings.catchVerificationMode || 'PROXIMITY_20M';
        if (mode === 'CATCH_PIN') {
          const expectedPin = game.catchPinsByHider.get(targetHiderId);
          const providedPin = String(payload.catchPin || '').trim();
          if (expectedPin && providedPin !== expectedPin) {
            throw new Error(
              `Invalid 2-Digit Catch PIN for ${target.nickname}. Ask them for the 2-digit code shown on their screen.`
            );
          }
        } else if (mode === 'PROXIMITY_20M') {
          if (!actor.gpsConsent || actor.gpsDenied) {
            throw new Error('Location sharing (GPS) must be enabled before capturing a player in Proximity mode.');
          }
          const actorLoc = game.locations.get(participantId);
          const targetLoc = game.locations.get(targetHiderId);
          if (isHunter && actorLoc && targetLoc) {
            const dist = calculateDistanceMeters(actorLoc.lat, actorLoc.lng, targetLoc.lat, targetLoc.lng);
            if (dist > MAX_CAPTURE_DISTANCE_METERS) {
              throw new Error(
                `Too far to capture (${Math.round(dist)}m away). You must be within ${MAX_CAPTURE_DISTANCE_METERS}m of ${target.nickname}.`
              );
            }
          }
        }
        // INSTANT_TAP mode requires neither PIN nor proximity check
      }

      target.status = 'CAPTURED';
      target.capturedByNickname = isSelf ? 'Self-reported' : actor.nickname;
      if (!isSelf) {
        actor.capturesCount = (actor.capturesCount || 0) + 1;
      }
      game.capturesLog.push({
        id: generateSecureId('cap'),
        hunterId: actor.id,
        hunterNickname: isSelf ? 'Self-reported' : actor.nickname,
        hiderId: target.id,
        hiderNickname: target.nickname,
        capturedAt: Date.now(),
      });
      game.locations.delete(targetHiderId);
      game.outsideSinceByParticipant.delete(targetHiderId);

      const remainingHiders = Array.from(game.participants.values()).filter(
        (p) => game.secretRoles.get(p.id) === 'HIDER' && p.status === 'ACTIVE'
      );
      if (remainingHiders.length === 0) {
        finishLocalGame(game, 'HUNTERS', 'All Hiders were caught on campus!');
      }
      return { ok: true };
    }
    case 'TOGGLE_PAUSE': {
      if (game.hostId !== participantId) throw new Error('Only the host can pause or resume.');
      const now = Date.now();
      if (game.state === 'ACTIVE' && game.endsAt) {
        game.pausedRemainingMs = Math.max(0, game.endsAt - now);
        game.state = 'PAUSED';
      } else if (game.state === 'PAUSED') {
        game.endsAt = now + (game.pausedRemainingMs || 60000);
        game.pausedRemainingMs = null;
        game.state = 'ACTIVE';
      }
      return { ok: true };
    }
    case 'EMERGENCY_STOP': {
      finishLocalGame(game, 'NONE', 'Game stopped early via Emergency / Host Stop.');
      return { ok: true };
    }
    case 'REMATCH': {
      if (game.hostId !== participantId) throw new Error('Only the host can start a rematch.');
      game.state = 'LOBBY';
      game.secretRoles.clear();
      game.locations.clear();
      game.soundUsage.clear();
      game.soundAlerts = [];
      game.walkieMessages = [];
      game.tauntAlerts = [];
      game.capturesLog = [];
      game.tauntCooldownByParticipant.clear();
      game.photoRequestsByHider.clear();
      game.photoRequestCountByHider.clear();
      game.outsideSinceByParticipant.clear();
      game.ghostCloakByHider.clear();
      game.catchPinsByHider.clear();
      game.settings.boundary.radiusMeters = game.settings.initialRadiusMeters || game.settings.boundary.radiusMeters;
      game.winnerTeam = null;
      game.winReason = null;
      for (const p of Array.from(game.participants.values())) {
        p.status = 'ACTIVE';
        p.ready = false;
        p.capturedByNickname = null;
        p.capturesCount = 0;
      }
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

async function performSupabaseGameAction(
  cleanCode: string,
  action: string,
  participantId: string,
  payload: Record<string, unknown>
) {
  const sb = getSupabaseAdminClient();
  const { data: gameRow } = await sb.from('games').select('*').eq('code', cleanCode).single();
  if (!gameRow) throw new Error('Game not found.');

  const { data: actorRow } = await sb
    .from('participants')
    .select('*')
    .eq('id', participantId)
    .eq('game_id', gameRow.id)
    .single();
  if (!actorRow) throw new Error('Unauthorized participant.');

  const now = Date.now();

  switch (action) {
    case 'TOGGLE_READY': {
      await sb.from('participants').update({ ready: !actorRow.ready }).eq('id', participantId);
      return { ok: true };
    }
    case 'UPDATE_RULES': {
      if (gameRow.host_participant_id !== participantId) throw new Error('Only the host can update game settings.');
      if (gameRow.state === 'LOBBY') {
        const updates: Record<string, unknown> = {
          hunter_count: Math.max(1, Math.min(4, Number(payload.hunterCount) || 1)),
          duration_minutes: Math.max(5, Math.min(90, Number(payload.durationMinutes) || 20)),
        };
        if (payload.countdownSeconds !== undefined) {
          updates.countdown_seconds = Math.max(0, Math.min(120, Number(payload.countdownSeconds)));
        }
        if (payload.soundUses !== undefined) {
          updates.sound_uses_per_hunter = Math.max(1, Math.min(10, Number(payload.soundUses)));
        }
        if (payload.soundCooldownSeconds !== undefined) {
          updates.sound_cooldown_seconds = Math.max(30, Math.min(300, Number(payload.soundCooldownSeconds)));
        }
        if (payload.boundaryRadiusMeters !== undefined) {
          updates.boundary_radius_m = Math.max(80, Math.min(1500, Number(payload.boundaryRadiusMeters)));
        }
        await sb.from('games').update(updates).eq('id', gameRow.id);
      }
      return { ok: true };
    }
    case 'START_GAME': {
      if (gameRow.host_participant_id !== participantId) throw new Error('Only the host can start the game.');
      if (gameRow.state !== 'LOBBY') throw new Error('Game already started.');

      const { data: allPlayers } = await sb.from('participants').select('*').eq('game_id', gameRow.id);
      const list = allPlayers || [];
      if (list.length < 2) throw new Error('Need at least 2 players to start.');
      if (gameRow.hunter_count >= list.length) {
        throw new Error(`With ${list.length} players, max Hunters is ${list.length - 1}.`);
      }
      if (list.some((p) => !p.ready)) {
        throw new Error('All players in the lobby must be Ready before starting the game.');
      }

      const assigned = csprngAssignRoles(list.map((p) => p.id), gameRow.hunter_count);
      await sb.from('participant_roles').delete().eq('game_id', gameRow.id);
      await sb.from('sound_ability_usage').delete().eq('game_id', gameRow.id);
      await sb.from('photo_requests').delete().eq('game_id', gameRow.id);
      await sb.from('participant_locations').delete().eq('game_id', gameRow.id);

      const roleRows = Array.from(assigned.entries()).map(([pid, role]) => ({
        game_id: gameRow.id,
        participant_id: pid,
        role,
      }));
      await sb.from('participant_roles').insert(roleRows);

      const hunterUsageRows = roleRows
        .filter((r) => r.role === 'HUNTER')
        .map((r) => ({
          game_id: gameRow.id,
          hunter_participant_id: r.participant_id,
          used_count: 0,
        }));
      if (hunterUsageRows.length > 0) await sb.from('sound_ability_usage').insert(hunterUsageRows);

      const countdownMs = (gameRow.countdown_seconds || 0) * 1000;
      const countdownEnds = new Date(now + countdownMs);
      const endsAt = new Date(countdownEnds.getTime() + gameRow.duration_minutes * 60 * 1000);

      await sb
        .from('games')
        .update({
          state: countdownMs > 0 ? 'COUNTDOWN' : 'ACTIVE',
          countdown_ends_at: countdownEnds.toISOString(),
          ends_at: endsAt.toISOString(),
        })
        .eq('id', gameRow.id);

      return { ok: true };
    }
    case 'SET_CONSENT': {
      const consent = Boolean(payload.consent);
      const denied = Boolean(payload.denied);
      await sb.from('participants').update({ gps_consent: consent, gps_denied: denied }).eq('id', participantId);
      if (!consent) {
        await sb.from('participant_locations').delete().eq('game_id', gameRow.id).eq('participant_id', participantId);
      }
      return { ok: true };
    }
    case 'UNLOCK_AUDIO': {
      await sb.from('participants').update({ audio_unlocked: true }).eq('id', participantId);
      return { ok: true };
    }
    case 'SEND_SOUND': {
      if (gameRow.state !== 'ACTIVE') throw new Error('Sound alerts require an active game.');
      const targetHiderId = String(payload.targetHiderId);
      const { data: callerRole } = await sb
        .from('participant_roles')
        .select('role')
        .eq('game_id', gameRow.id)
        .eq('participant_id', participantId)
        .single();
      if (!callerRole || callerRole.role !== 'HUNTER') throw new Error('Only Hunters can send sound alerts.');

      const { data: usageRow } = await sb
        .from('sound_ability_usage')
        .select('*')
        .eq('game_id', gameRow.id)
        .eq('hunter_participant_id', participantId)
        .single();

      const usedCount = usageRow?.used_count || 0;
      const cooldownUntil = usageRow?.cooldown_until ? new Date(usageRow.cooldown_until).getTime() : 0;

      if (usedCount >= gameRow.sound_uses_per_hunter) throw new Error('No sound alerts remaining.');
      if (now < cooldownUntil) {
        const waitSec = Math.ceil((cooldownUntil - now) / 1000);
        throw new Error(`Sound alert on cooldown (${waitSec}s left).`);
      }

      const nextCooldownIso = new Date(now + gameRow.sound_cooldown_seconds * 1000).toISOString();
      await sb.from('sound_ability_usage').upsert({
        game_id: gameRow.id,
        hunter_participant_id: participantId,
        used_count: usedCount + 1,
        cooldown_until: nextCooldownIso,
      });

      const { data: targetRow } = await sb.from('participants').select('*').eq('id', targetHiderId).single();
      const deliveryStatus = targetRow?.audio_unlocked
        ? `Sound alert delivered to ${targetRow.nickname} (4s Siren triggered)`
        : `Alert delivered to ${targetRow?.nickname || 'Hider'} (waiting for them to tap Enable Sound)`;

      await sb.from('sound_alerts').insert({
        game_id: gameRow.id,
        hunter_participant_id: participantId,
        target_participant_id: targetHiderId,
        delivery_status: deliveryStatus,
      });

      return { ok: true, deliveryStatus };
    }
    case 'REQUEST_PHOTO': {
      if (gameRow.state !== 'ACTIVE') throw new Error('Photo requests require an active game.');
      const targetHiderId = String(payload.targetHiderId);
      const { data: callerRole } = await sb
        .from('participant_roles')
        .select('role')
        .eq('game_id', gameRow.id)
        .eq('participant_id', participantId)
        .single();
      if (!callerRole || callerRole.role !== 'HUNTER') throw new Error('Only Hunters can request a photo.');

      const expiresIso = new Date(now + 90 * 1000).toISOString();
      const { error: prErr } = await sb.from('photo_requests').insert({
        game_id: gameRow.id,
        hunter_participant_id: participantId,
        target_participant_id: targetHiderId,
        status: 'PENDING',
        expires_at: expiresIso,
      });
      if (prErr) throw new Error('This Hider’s photo request has already been used for this match.');
      return { ok: true };
    }
    case 'RESPOND_PHOTO': {
      if (payload.declined) {
        await sb
          .from('photo_requests')
          .update({ status: 'DECLINED' })
          .eq('game_id', gameRow.id)
          .eq('target_participant_id', participantId);
        return { ok: true };
      }
      const dataUrl = String(payload.photoDataUrl || '');
      if (!dataUrl.startsWith('data:image/')) throw new Error('Valid captured image is required.');
      await sb
        .from('photo_requests')
        .update({
          status: 'SUBMITTED',
          photo_data_url: dataUrl,
          submitted_at: new Date().toISOString(),
        })
        .eq('game_id', gameRow.id)
        .eq('target_participant_id', participantId);
      return { ok: true };
    }
    case 'MARK_CAUGHT': {
      if (gameRow.state !== 'ACTIVE') {
        throw new Error('Captures are only allowed when the hunt is actively running.');
      }
      const targetHiderId = String(payload.targetHiderId);
      const isSelf = participantId === targetHiderId;

      if (!isSelf) {
        const { data: locs } = await sb
          .from('participant_locations')
          .select('*')
          .eq('game_id', gameRow.id)
          .in('participant_id', [participantId, targetHiderId]);
        const actorLoc = (locs || []).find((l) => l.participant_id === participantId);
        const targetLoc = (locs || []).find((l) => l.participant_id === targetHiderId);
        if (actorLoc && targetLoc) {
          const dist = calculateDistanceMeters(actorLoc.lat, actorLoc.lng, targetLoc.lat, targetLoc.lng);
          if (dist > MAX_CAPTURE_DISTANCE_METERS) {
            throw new Error(
              `Too far to capture (${Math.round(dist)}m away). You must be within ${MAX_CAPTURE_DISTANCE_METERS}m.`
            );
          }
        }
      }

      await sb.from('participants').update({ status: 'CAPTURED' }).eq('id', targetHiderId);
      await sb.from('participant_locations').delete().eq('game_id', gameRow.id).eq('participant_id', targetHiderId);

      const { data: hiderRoles } = await sb
        .from('participant_roles')
        .select('participant_id')
        .eq('game_id', gameRow.id)
        .eq('role', 'HIDER');

      const hiderIds = (hiderRoles || []).map((r) => r.participant_id);
      const { data: activeHiders } = await sb.from('participants').select('id').in('id', hiderIds).eq('status', 'ACTIVE');

      if (!activeHiders || activeHiders.length === 0) {
        await sb
          .from('games')
          .update({
            state: 'FINISHED',
            winner_team: 'HUNTERS',
            win_reason: 'All Hiders were caught on campus!',
          })
          .eq('id', gameRow.id);
      }
      return { ok: true };
    }
    case 'TOGGLE_PAUSE': {
      if (gameRow.host_participant_id !== participantId) throw new Error('Only the host can pause or resume.');
      if (gameRow.state === 'ACTIVE' && gameRow.ends_at) {
        const rem = Math.max(0, new Date(gameRow.ends_at).getTime() - now);
        await sb.from('games').update({ state: 'PAUSED', paused_remaining_ms: rem }).eq('id', gameRow.id);
      } else if (gameRow.state === 'PAUSED') {
        const nextEnds = new Date(now + (gameRow.paused_remaining_ms || 60000)).toISOString();
        await sb.from('games').update({ state: 'ACTIVE', ends_at: nextEnds, paused_remaining_ms: null }).eq('id', gameRow.id);
      }
      return { ok: true };
    }
    case 'EMERGENCY_STOP': {
      await sb
        .from('games')
        .update({
          state: 'FINISHED',
          winner_team: 'NONE',
          win_reason: 'Game stopped early via Emergency / Host Stop.',
        })
        .eq('id', gameRow.id);
      return { ok: true };
    }
    case 'REMATCH': {
      if (gameRow.host_participant_id !== participantId) throw new Error('Only the host can start a rematch.');
      await sb.from('participant_roles').delete().eq('game_id', gameRow.id);
      await sb.from('participant_locations').delete().eq('game_id', gameRow.id);
      await sb.from('sound_ability_usage').delete().eq('game_id', gameRow.id);
      await sb.from('photo_requests').delete().eq('game_id', gameRow.id);
      await sb.from('participants').update({ status: 'ACTIVE', ready: false }).eq('game_id', gameRow.id);
      await sb.from('games').update({ state: 'LOBBY', winner_team: null, win_reason: null }).eq('id', gameRow.id);
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

export async function getAuthorizedGameState(code: string, viewerId: string) {
  const cleanCode = code.trim().toUpperCase();

  if (isSupabaseConfigured() && !getLocalRooms().has(cleanCode)) {
    return getSupabaseAuthorizedState(cleanCode, viewerId);
  }

  const game = getLocalRooms().get(cleanCode);
  if (!game) throw new Error('Game not found.');
  tickLocalLifecycle(game);

  const viewer = game.participants.get(viewerId);
  if (!viewer) throw new Error('Viewer is not in this game.');

  const viewerRole = game.secretRoles.get(viewerId) || null;
  const now = Date.now();
  const maxPhotosPerHider = game.settings.photoRequestsPerHider ?? 1;
  const gracePeriodSeconds = game.settings.outOfBoundsGraceSeconds || 60;
  const staleThresholdSeconds = Math.max(45, (game.settings.gpsIntervalSeconds || 60) + 15);

  const participantsView = Array.from(game.participants.values()).map((p) => {
    const isSelf = p.id === viewerId;
    const actualRole = game.secretRoles.get(p.id) || null;

    let visibleRole: VisibleRole = null;
    if (game.state === 'LOBBY') {
      visibleRole = null;
    } else if (game.state === 'FINISHED' || isSelf || viewerRole === 'HUNTER') {
      visibleRole = actualRole;
    } else if (viewerRole === 'HIDER') {
      if (actualRole === 'HUNTER') {
        visibleRole = game.settings.hunterVisibilityMode === 'HIDDEN' ? 'HIDDEN' : 'HUNTER';
      } else if (actualRole === 'HIDER') {
        visibleRole = game.settings.teammateVisibility === 'HIDE_TEAMMATES' ? 'HIDDEN' : 'HIDER';
      }
    } else {
      visibleRole = actualRole;
    }

    const cloak = game.ghostCloakByHider.get(p.id);
    const ghostCloakActive = Boolean(cloak && now < cloak.activeUntil && p.status === 'ACTIVE');
    const ghostCloakSecondsLeft = ghostCloakActive && cloak ? Math.max(0, Math.ceil((cloak.activeUntil - now) / 1000)) : 0;

    let visibleLocation = null;
    const rawLoc = game.locations.get(p.id);
    let outOfBoundsGraceSecondsLeft: number | null = null;
    let isOutOfBoundsExposed = false;

    if (rawLoc && p.status === 'ACTIVE') {
      if (rawLoc.isOutside) {
        let outsideSince = game.outsideSinceByParticipant.get(p.id);
        if (!outsideSince) {
          outsideSince = rawLoc.updatedAt;
          game.outsideSinceByParticipant.set(p.id, outsideSince);
        }
        outOfBoundsGraceSecondsLeft = Math.max(
          0,
          Math.ceil((outsideSince + gracePeriodSeconds * 1000 - now) / 1000)
        );
        isOutOfBoundsExposed = outOfBoundsGraceSecondsLeft === 0;
      } else {
        game.outsideSinceByParticipant.delete(p.id);
      }

      const hunterCanSee =
        game.state !== 'COUNTDOWN' &&
        viewerRole === 'HUNTER' &&
        (actualRole === 'HUNTER' ||
          (actualRole === 'HIDER' && (!ghostCloakActive || isOutOfBoundsExposed)));

      const hiderTeammateCanSee =
        game.state !== 'COUNTDOWN' &&
        viewerRole === 'HIDER' &&
        game.settings.teammateVisibility !== 'HIDE_TEAMMATES' &&
        actualRole === 'HIDER';

      const hiderCanSeeHunter =
        game.state !== 'COUNTDOWN' &&
        viewerRole === 'HIDER' &&
        actualRole === 'HUNTER' &&
        game.settings.hunterVisibilityMode !== 'HIDDEN';

      const canSeeLoc = isSelf || hunterCanSee || hiderTeammateCanSee || hiderCanSeeHunter;

      if (canSeeLoc) {
        const ageSeconds = Math.max(0, Math.round((now - rawLoc.updatedAt) / 1000));
        visibleLocation = {
          ...rawLoc,
          ageSeconds,
          isStale: ageSeconds > staleThresholdSeconds,
          outOfBoundsGraceSecondsLeft,
          isOutOfBoundsExposed,
        };
      }
    }

    let photoRequestView = null;
    const usedPhotos = game.photoRequestCountByHider.get(p.id) || 0;
    const remainingPhotoRequests = Math.max(0, maxPhotosPerHider - usedPhotos);
    if (viewerRole === 'HUNTER' || isSelf) {
      const pr = game.photoRequestsByHider.get(p.id);
      if (pr) {
        photoRequestView = {
          id: pr.id,
          status: pr.status,
          expiresInSeconds: Math.max(0, Math.ceil((pr.expiresAt - now) / 1000)),
          hasPhoto: Boolean(pr.photoDataUrl && (viewerRole === 'HUNTER' || isSelf)),
          photoDataUrl: viewerRole === 'HUNTER' || isSelf ? pr.photoDataUrl : null,
          remainingRequests: remainingPhotoRequests,
        };
      }
    }

    return {
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      isHost: p.isHost,
      ready: p.ready,
      status: p.status,
      capturedByNickname: p.capturedByNickname || null,
      capturesCount: p.capturesCount || 0,
      gpsConsent: p.gpsConsent,
      gpsDenied: p.gpsDenied,
      audioUnlocked: p.audioUnlocked,
      connected: p.connected,
      role: visibleRole,
      location: visibleLocation,
      photoRequest: photoRequestView,
      remainingPhotoRequests,
      ghostCloakActive: viewerRole === 'HUNTER' || isSelf ? ghostCloakActive : false,
      ghostCloakSecondsLeft: viewerRole === 'HUNTER' || isSelf ? ghostCloakSecondsLeft : 0,
      isOutOfBoundsExposed,
    };
  });

  const totalHiders = Array.from(game.secretRoles.values()).filter((r) => r === 'HIDER').length;
  const activeHiders = Array.from(game.participants.values()).filter(
    (p) => game.secretRoles.get(p.id) === 'HIDER' && p.status === 'ACTIVE'
  ).length;

  let soundAbilityView = null;
  if (viewerRole === 'HUNTER') {
    const usage = game.soundUsage.get(viewerId) || { usedCount: 0, cooldownUntil: 0 };
    soundAbilityView = {
      remainingUses: Math.max(0, game.settings.soundUsesPerHunter - usage.usedCount),
      maxUses: game.settings.soundUsesPerHunter,
      cooldownSecondsLeft: Math.max(0, Math.ceil((usage.cooldownUntil - now) / 1000)),
    };
  }

  let viewerGhostCloak = null;
  let viewerCatchPin: string | null = null;
  let hunterProximity: { nearby: boolean; distanceBand: 'SAFE' | 'NEAR' | 'CRITICAL' } = {
    nearby: false,
    distanceBand: 'SAFE',
  };

  if (viewerRole === 'HIDER') {
    const cloak = game.ghostCloakByHider.get(viewerId);
    const maxUses = game.settings.ghostCloakUsesPerHider ?? 1;
    const usedCount = cloak?.usedCount ?? 0;
    const remainingUses = Math.max(0, maxUses - usedCount);
    const active = Boolean(cloak && now < cloak.activeUntil && viewer.status === 'ACTIVE');
    viewerGhostCloak = {
      used: usedCount >= maxUses,
      usedCount,
      maxUses,
      remainingUses,
      active,
      secondsLeft: active && cloak ? Math.max(0, Math.ceil((cloak.activeUntil - now) / 1000)) : 0,
    };
    viewerCatchPin = game.catchPinsByHider.get(viewerId) || null;

    if (game.state === 'ACTIVE' && viewer.status === 'ACTIVE') {
      const myLoc = game.locations.get(viewerId);
      if (myLoc) {
        let minHunterDist = Infinity;
        for (const [pid, role] of Array.from(game.secretRoles.entries())) {
          if (role === 'HUNTER') {
            const hLoc = game.locations.get(pid);
            const hPart = game.participants.get(pid);
            if (hLoc && hPart && hPart.status === 'ACTIVE') {
              const d = calculateDistanceMeters(myLoc.lat, myLoc.lng, hLoc.lat, hLoc.lng);
              if (d < minHunterDist) minHunterDist = d;
            }
          }
        }
        if (minHunterDist < 40) {
          hunterProximity = {
            nearby: true,
            distanceBand: minHunterDist < 20 ? 'CRITICAL' : 'NEAR',
          };
        }
      }
    }
  }

  const recentTargetedAlert =
    game.soundAlerts.filter((a) => a.targetHiderId === viewerId && now - a.createdAt < 15000).slice(-1)[0] || null;

  const recentWalkieMessages = game.walkieMessages.filter((m) => now - m.createdAt < 18000);
  const recentTaunts = game.tauntAlerts.filter((t) => now - t.createdAt < 14000);
  const tauntCooldownSecondsLeft = Math.max(
    0,
    Math.ceil(((game.tauntCooldownByParticipant.get(viewerId) || 0) - now) / 1000)
  );

  return {
    id: game.id,
    code: game.code,
    title: game.title,
    state: game.state,
    storageMode: 'LOCAL_MEMORY' as const,
    hostId: game.hostId,
    viewerId,
    viewerRole,
    viewerGpsConsent: viewer.gpsConsent,
    viewerGpsDenied: viewer.gpsDenied,
    viewerAudioUnlocked: viewer.audioUnlocked,
    viewerCatchPin,
    viewerGhostCloak,
    hunterProximity,
    settings: game.settings,
    countdownSecondsLeft: game.countdownEndsAt ? Math.max(0, Math.ceil((game.countdownEndsAt - now) / 1000)) : 0,
    gameSecondsLeft:
      game.state === 'PAUSED'
        ? Math.ceil((game.pausedRemainingMs || 0) / 1000)
        : game.endsAt
        ? Math.max(0, Math.ceil((game.endsAt - now) / 1000))
        : game.settings.durationMinutes * 60,
    totalHiders,
    activeHiders,
    capturedHiders: Math.max(0, totalHiders - activeHiders),
    winnerTeam: game.winnerTeam,
    winReason: game.winReason,
    capturesLog: game.capturesLog,
    soundAbility: soundAbilityView,
    recentTargetedAlert,
    recentWalkieMessages,
    recentTaunts,
    tauntCooldownSecondsLeft,
    participants: participantsView,
  };
}

async function getSupabaseAuthorizedState(cleanCode: string, viewerId: string) {
  const sb = getSupabaseAdminClient();
  const { data: gameRow } = await sb.from('games').select('*').eq('code', cleanCode).single();
  if (!gameRow) throw new Error('Game not found.');

  const now = Date.now();
  let currentState = gameRow.state as GameState;
  const countdownEndsMs = gameRow.countdown_ends_at ? new Date(gameRow.countdown_ends_at).getTime() : null;
  const endsMs = gameRow.ends_at ? new Date(gameRow.ends_at).getTime() : null;

  if (currentState === 'COUNTDOWN' && countdownEndsMs && now >= countdownEndsMs) {
    currentState = 'ACTIVE';
    await sb.from('games').update({ state: 'ACTIVE' }).eq('id', gameRow.id);
  }
  if (currentState === 'ACTIVE' && endsMs && now >= endsMs) {
    currentState = 'FINISHED';
    await sb
      .from('games')
      .update({
        state: 'FINISHED',
        winner_team: 'HIDERS',
        win_reason: 'Time expired with Hiders still free on campus!',
      })
      .eq('id', gameRow.id);
  }

  const [
    { data: participantsRows },
    { data: rolesRows },
    { data: locationsRows },
    { data: soundUsageRows },
    { data: photoReqRows },
    { data: soundAlertsRows },
  ] = await Promise.all([
    sb.from('participants').select('*').eq('game_id', gameRow.id).order('joined_at', { ascending: true }),
    sb.from('participant_roles').select('*').eq('game_id', gameRow.id),
    sb.from('participant_locations').select('*').eq('game_id', gameRow.id),
    sb.from('sound_ability_usage').select('*').eq('game_id', gameRow.id),
    sb.from('photo_requests').select('*').eq('game_id', gameRow.id),
    sb
      .from('sound_alerts')
      .select('*')
      .eq('game_id', gameRow.id)
      .eq('target_participant_id', viewerId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const players = participantsRows || [];
  const viewer = players.find((p) => p.id === viewerId);
  if (!viewer) throw new Error('Viewer is not in this game.');

  const roleMap = new Map<string, PlayerRole>();
  (rolesRows || []).forEach((r) => roleMap.set(r.participant_id, r.role as PlayerRole));

  const locMap = new Map<string, any>();
  (locationsRows || []).forEach((l) => locMap.set(l.participant_id, l));

  const photoMap = new Map<string, any>();
  (photoReqRows || []).forEach((pr) => photoMap.set(pr.target_participant_id, pr));

  const viewerRole = roleMap.get(viewerId) || null;

  const participantsView = players.map((p) => {
    const isSelf = p.id === viewerId;
    const actualRole = roleMap.get(p.id) || null;

    let visibleRole: VisibleRole = null;
    if (currentState === 'LOBBY') {
      visibleRole = null;
    } else {
      visibleRole = actualRole;
    }

    let visibleLocation = null;
    const rawLoc = locMap.get(p.id);
    if (rawLoc && p.status === 'ACTIVE') {
      const canSeeLoc =
        isSelf ||
        (currentState !== 'COUNTDOWN' && (actualRole === 'HIDER' || actualRole === 'HUNTER'));
      if (canSeeLoc) {
        const updatedMs = new Date(rawLoc.updated_at).getTime();
        const ageSeconds = Math.max(0, Math.round((now - updatedMs) / 1000));
        const distMeters = Math.round(
          calculateDistanceMeters(rawLoc.lat, rawLoc.lng, gameRow.boundary_lat, gameRow.boundary_lng)
        );
        visibleLocation = {
          lat: rawLoc.lat,
          lng: rawLoc.lng,
          accuracy: rawLoc.accuracy_m,
          updatedAt: updatedMs,
          distanceMeters: distMeters,
          outsideMeters: rawLoc.outside_meters,
          isOutside: rawLoc.is_outside,
          ageSeconds,
          isStale: ageSeconds > 75,
          outOfBoundsGraceSecondsLeft: null,
          isOutOfBoundsExposed: false,
        };
      }
    }

    let photoRequestView = null;
    const pr = photoMap.get(p.id);
    const remainingPhotoRequests = pr ? 0 : 1;
    if ((viewerRole === 'HUNTER' || isSelf) && pr) {
      const expMs = new Date(pr.expires_at).getTime();
      const status = pr.status === 'PENDING' && now >= expMs ? 'EXPIRED' : pr.status;
      photoRequestView = {
        id: pr.id,
        status,
        expiresInSeconds: Math.max(0, Math.ceil((expMs - now) / 1000)),
        hasPhoto: Boolean(pr.photo_data_url && (viewerRole === 'HUNTER' || isSelf)),
        photoDataUrl: viewerRole === 'HUNTER' || isSelf ? pr.photo_data_url : null,
        remainingRequests: remainingPhotoRequests,
      };
    }

    return {
      id: p.id,
      nickname: p.nickname,
      color: p.avatar_color,
      isHost: p.is_host,
      ready: p.ready,
      status: p.status,
      capturedByNickname: null,
      capturesCount: 0,
      gpsConsent: p.gps_consent,
      gpsDenied: p.gps_denied,
      audioUnlocked: p.audio_unlocked,
      connected: true,
      role: visibleRole,
      location: visibleLocation,
      photoRequest: photoRequestView,
      remainingPhotoRequests,
      ghostCloakActive: false,
      ghostCloakSecondsLeft: 0,
      isOutOfBoundsExposed: false,
    };
  });

  const totalHiders = Array.from(roleMap.values()).filter((r) => r === 'HIDER').length;
  const activeHiders = players.filter((p) => roleMap.get(p.id) === 'HIDER' && p.status === 'ACTIVE').length;

  let soundAbilityView = null;
  if (viewerRole === 'HUNTER') {
    const usage = (soundUsageRows || []).find((u) => u.hunter_participant_id === viewerId);
    const usedCount = usage?.used_count || 0;
    const cdMs = usage?.cooldown_until ? new Date(usage.cooldown_until).getTime() : 0;
    soundAbilityView = {
      remainingUses: Math.max(0, gameRow.sound_uses_per_hunter - usedCount),
      maxUses: gameRow.sound_uses_per_hunter,
      cooldownSecondsLeft: Math.max(0, Math.ceil((cdMs - now) / 1000)),
    };
  }

  let recentTargetedAlert = null;
  if (soundAlertsRows && soundAlertsRows[0]) {
    const a = soundAlertsRows[0];
    const createdMs = new Date(a.created_at).getTime();
    if (now - createdMs < 15000) {
      recentTargetedAlert = {
        id: a.id,
        hunterId: a.hunter_participant_id,
        targetHiderId: a.target_participant_id,
        deliveryStatus: a.delivery_status,
        createdAt: createdMs,
      };
    }
  }

  let hunterProximity: { nearby: boolean; distanceBand: 'SAFE' | 'NEAR' | 'CRITICAL' } = {
    nearby: false,
    distanceBand: 'SAFE',
  };
  if (viewerRole === 'HIDER' && currentState === 'ACTIVE' && viewer.status === 'ACTIVE') {
    const myLoc = locMap.get(viewerId);
    if (myLoc) {
      let minHunterDist = Infinity;
      for (const [pid, role] of Array.from(roleMap.entries())) {
        if (role === 'HUNTER') {
          const hLoc = locMap.get(pid);
          if (hLoc) {
            const d = calculateDistanceMeters(myLoc.lat, myLoc.lng, hLoc.lat, hLoc.lng);
            if (d < minHunterDist) minHunterDist = d;
          }
        }
      }
      if (minHunterDist < 40) {
        hunterProximity = {
          nearby: true,
          distanceBand: minHunterDist < 20 ? 'CRITICAL' : 'NEAR',
        };
      }
    }
  }

  return {
    id: gameRow.id,
    code: gameRow.code,
    title: gameRow.title,
    state: currentState,
    storageMode: 'SUPABASE' as const,
    hostId: gameRow.host_participant_id,
    viewerId,
    viewerRole,
    viewerGpsConsent: viewer.gps_consent,
    viewerGpsDenied: viewer.gps_denied,
    viewerAudioUnlocked: viewer.audio_unlocked,
    viewerCatchPin: null,
    viewerGhostCloak: { used: false, usedCount: 0, maxUses: 1, remainingUses: 1, active: false, secondsLeft: 0 },
    hunterProximity,
    settings: {
      maxPlayers: 12,
      hunterCount: gameRow.hunter_count,
      durationMinutes: gameRow.duration_minutes,
      countdownSeconds: gameRow.countdown_seconds,
      gpsIntervalSeconds: GPS_UPDATE_INTERVAL_SECONDS,
      soundUsesPerHunter: gameRow.sound_uses_per_hunter,
      soundCooldownSeconds: gameRow.sound_cooldown_seconds,
      photoRequestsPerHider: 1,
      ghostCloakUsesPerHider: 1,
      walkieTalkieEnabled: true,
      hunterVisibilityMode: 'ALWAYS_LIVE' as HunterVisibilityMode,
      catchVerificationMode: 'PROXIMITY_20M' as CatchVerificationMode,
      outOfBoundsGraceSeconds: 60,
      teammateVisibility: 'SHOW_TEAMMATES' as TeammateVisibilityMode,
      shrinkingZone: false,
      initialRadiusMeters: gameRow.boundary_radius_m,
      boundary: {
        lat: gameRow.boundary_lat,
        lng: gameRow.boundary_lng,
        radiusMeters: gameRow.boundary_radius_m,
      },
    },
    countdownSecondsLeft: countdownEndsMs ? Math.max(0, Math.ceil((countdownEndsMs - now) / 1000)) : 0,
    gameSecondsLeft:
      currentState === 'PAUSED'
        ? Math.ceil((gameRow.paused_remaining_ms || 0) / 1000)
        : endsMs
        ? Math.max(0, Math.ceil((endsMs - now) / 1000))
        : gameRow.duration_minutes * 60,
    totalHiders,
    activeHiders,
    capturedHiders: Math.max(0, totalHiders - activeHiders),
    winnerTeam: gameRow.winner_team,
    winReason: gameRow.win_reason,
    capturesLog: [] as CaptureLogRecord[],
    soundAbility: soundAbilityView,
    recentTargetedAlert,
    recentWalkieMessages: [] as WalkieTalkieMessageRecord[],
    recentTaunts: [] as TauntAlertRecord[],
    tauntCooldownSecondsLeft: 0,
    participants: participantsView,
  };
}
