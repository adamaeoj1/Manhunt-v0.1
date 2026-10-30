import { z } from 'zod';

export const GPS_UPDATE_INTERVAL_SECONDS = 60;
export const MAX_CAPTURE_DISTANCE_METERS = 20;

export type CatchVerificationMode = 'PROXIMITY_20M' | 'CATCH_PIN' | 'INSTANT_TAP';
export type TeammateVisibilityMode = 'SHOW_TEAMMATES' | 'HIDE_TEAMMATES';
export type HunterVisibilityMode = 'ALWAYS_LIVE' | 'RADAR_PING_15S' | 'HIDDEN';
export type TauntType = 'CATCH_ME' | 'I_SEE_YOU' | 'AIRHORN' | 'TOO_SLOW';

export const AUI_CAMPUS_PRESETS = {
  main: { name: 'Full AUI Campus', lat: 33.53960, lng: -5.10695, radiusMeters: 380, zoom: 16 },
  academic: { name: 'Academic Quad & Library', lat: 33.53965, lng: -5.10735, radiusMeters: 165, zoom: 17 },
  housing: { name: 'Student Center & Dorms', lat: 33.54035, lng: -5.10620, radiusMeters: 195, zoom: 17 },
  athletic: { name: 'Athletic Complex & Fields', lat: 33.53995, lng: -5.10865, radiusMeters: 165, zoom: 17 },
} as const;

export type CampusPresetKey = keyof typeof AUI_CAMPUS_PRESETS;

const BLOCKED_WORDS = [
  // English profanities & slurs
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'nigger', 'nigga',
  'faggot', 'fag', 'whore', 'slut', 'bastard', 'cock', 'twat', 'wanker',
  'kike', 'chink', 'spic', 'retard', 'coon', 'nazi', 'hitler',
  // French profanities
  'merde', 'putain', 'salope', 'connard', 'conne', 'encule', 'batard', 'pute', 'chienne',
  // Darija / Arabic transliterated profanities
  'zamel', 'zaml', 'kahba', 'qahba', '9ahba', 'tabon', 'tebon', 'zeb', 'zob', 'zbi',
  'nik', 'nikmk', 'weldlhram', 'weldrab', 'tezz', 'hmar', 'kelb', 'klb',
  // Arabic script profanities
  'قحبة', 'زامل', 'طبون', 'زب', 'طيز', 'شرموطة', 'منيوك', 'كس'
];

/**
 * Strict profanity and offensive language check normalizing leetspeak, punctuation, and repeated characters.
 */
export function containsProfanity(raw: string): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase().trim();

  // Direct check for Arabic and multibyte strings
  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word)) {
      return true;
    }
  }

  // Normalize leetspeak and symbols
  let text = lower
    .replace(/[@4]/g, 'a')
    .replace(/[\$5]/g, 's')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[7]/g, 't')
    .replace(/[8]/g, 'b')
    .replace(/[^a-z0-9]/g, '');

  // Collapse consecutive duplicated characters (e.g. fuuuuck -> fuck)
  const collapsed = text.replace(/(.)\1+/g, '$1');

  for (const word of BLOCKED_WORDS) {
    if (text.includes(word) || collapsed.includes(word)) {
      return true;
    }
  }
  return false;
}

export const NicknameSchema = z
  .string()
  .trim()
  .min(3, 'Nickname must be at least 3 characters.')
  .max(15, 'Nickname cannot exceed 15 characters.')
  .refine((val) => !containsProfanity(val), {
    message: 'Please choose an appropriate nickname.',
  });

export const CreateGameSchema = z.object({
  hostNickname: NicknameSchema,
  title: z.string().trim().max(45).optional().default('AUI Campus Manhunt'),
  hunterCount: z.coerce.number().int().min(1).max(5).default(1),
  durationMinutes: z.coerce.number().int().min(5).max(90).default(20),
  countdownSeconds: z.coerce.number().int().min(0).max(120).default(10),
  gpsIntervalSeconds: z.coerce.number().int().min(10).max(300).optional().default(60),
  soundUses: z.coerce.number().int().min(1).max(10).default(3),
  soundCooldownSeconds: z.coerce.number().int().min(30).max(300).default(90),
  photoRequestsPerHider: z.coerce.number().int().min(0).max(5).optional().default(1),
  ghostCloakUsesPerHider: z.coerce.number().int().min(0).max(5).optional().default(1),
  walkieTalkieEnabled: z.boolean().optional().default(true),
  hunterVisibilityMode: z
    .enum(['ALWAYS_LIVE', 'RADAR_PING_15S', 'HIDDEN'])
    .optional()
    .default('ALWAYS_LIVE'),
  catchVerificationMode: z
    .enum(['PROXIMITY_20M', 'CATCH_PIN', 'INSTANT_TAP'])
    .optional()
    .default('PROXIMITY_20M'),
  outOfBoundsGraceSeconds: z.coerce.number().int().min(15).max(180).optional().default(60),
  teammateVisibility: z
    .enum(['SHOW_TEAMMATES', 'HIDE_TEAMMATES'])
    .optional()
    .default('SHOW_TEAMMATES'),
  shrinkingZone: z.boolean().optional().default(false),
  boundary: z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().int().min(80).max(1500).default(390),
  }),
});

export const JoinGameSchema = z.object({
  nickname: NicknameSchema,
});

export const SubmitLocationSchema = z.object({
  participantId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().gt(0).max(2500),
  isManualFallback: z.boolean().optional(),
});

export const GameActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('TOGGLE_READY'), participantId: z.string().min(1) }),
  z.object({
    action: z.literal('UPDATE_RULES'),
    participantId: z.string().min(1),
    hunterCount: z.coerce.number().int().min(1).max(5),
    durationMinutes: z.coerce.number().int().min(5).max(90),
    countdownSeconds: z.coerce.number().int().min(0).max(120).optional(),
    gpsIntervalSeconds: z.coerce.number().int().min(10).max(300).optional(),
    soundUses: z.coerce.number().int().min(1).max(10).optional(),
    soundCooldownSeconds: z.coerce.number().int().min(30).max(300).optional(),
    photoRequestsPerHider: z.coerce.number().int().min(0).max(5).optional(),
    ghostCloakUsesPerHider: z.coerce.number().int().min(0).max(5).optional(),
    walkieTalkieEnabled: z.boolean().optional(),
    hunterVisibilityMode: z.enum(['ALWAYS_LIVE', 'RADAR_PING_15S', 'HIDDEN']).optional(),
    catchVerificationMode: z.enum(['PROXIMITY_20M', 'CATCH_PIN', 'INSTANT_TAP']).optional(),
    outOfBoundsGraceSeconds: z.coerce.number().int().min(15).max(180).optional(),
    teammateVisibility: z.enum(['SHOW_TEAMMATES', 'HIDE_TEAMMATES']).optional(),
    shrinkingZone: z.boolean().optional(),
    boundaryRadiusMeters: z.coerce.number().int().min(80).max(1500).optional(),
  }),
  z.object({
    action: z.literal('UPDATE_LOBBY_SETTINGS'),
    participantId: z.string().min(1),
    hunterCount: z.coerce.number().int().min(1).max(5).optional(),
    durationMinutes: z.coerce.number().int().min(5).max(90).optional(),
    countdownSeconds: z.coerce.number().int().min(0).max(120).optional(),
    gpsIntervalSeconds: z.coerce.number().int().min(10).max(300).optional(),
    soundUses: z.coerce.number().int().min(1).max(10).optional(),
    soundCooldownSeconds: z.coerce.number().int().min(30).max(300).optional(),
    photoRequestsPerHider: z.coerce.number().int().min(0).max(5).optional(),
    ghostCloakUsesPerHider: z.coerce.number().int().min(0).max(5).optional(),
    walkieTalkieEnabled: z.boolean().optional(),
    hunterVisibilityMode: z.enum(['ALWAYS_LIVE', 'RADAR_PING_15S', 'HIDDEN']).optional(),
    catchVerificationMode: z.enum(['PROXIMITY_20M', 'CATCH_PIN', 'INSTANT_TAP']).optional(),
    outOfBoundsGraceSeconds: z.coerce.number().int().min(15).max(180).optional(),
    teammateVisibility: z.enum(['SHOW_TEAMMATES', 'HIDE_TEAMMATES']).optional(),
    shrinkingZone: z.boolean().optional(),
    boundaryRadiusMeters: z.coerce.number().int().min(80).max(1500).optional(),
  }),
  z.object({ action: z.literal('START_GAME'), participantId: z.string().min(1) }),
  z.object({
    action: z.literal('SET_CONSENT'),
    participantId: z.string().min(1),
    consent: z.boolean(),
    denied: z.boolean().optional().default(false),
  }),
  z.object({ action: z.literal('UNLOCK_AUDIO'), participantId: z.string().min(1) }),
  z.object({ action: z.literal('ACTIVATE_GHOST_CLOAK'), participantId: z.string().min(1) }),
  z.object({
    action: z.literal('SEND_WALKIE_TALKIE'),
    participantId: z.string().min(1),
    audioDataUrl: z.string().max(600_000).optional().nullable(),
    voiceText: z.string().max(160).optional().nullable(),
    disguised: z.boolean().optional().default(false),
    durationSeconds: z.number().min(0.3).max(8).optional().default(3),
  }),
  z.object({
    action: z.literal('SEND_TAUNT'),
    participantId: z.string().min(1),
    tauntType: z.enum(['CATCH_ME', 'I_SEE_YOU', 'AIRHORN', 'TOO_SLOW']),
  }),
  z.object({
    action: z.literal('SEND_NOTE'),
    participantId: z.string().min(1),
    message: z.string().trim().min(1, 'Note message cannot be empty.').max(160, 'Note message cannot exceed 160 characters.'),
  }),
  z.object({ action: z.literal('SEND_SOUND'), participantId: z.string().min(1), targetHiderId: z.string().min(1) }),
  z.object({ action: z.literal('REQUEST_PHOTO'), participantId: z.string().min(1), targetHiderId: z.string().min(1) }),
  z.object({
    action: z.literal('RESPOND_PHOTO'),
    participantId: z.string().min(1),
    photoDataUrl: z.string().optional().nullable(),
    declined: z.boolean().optional().default(false),
  }),
  z.object({
    action: z.literal('MARK_CAUGHT'),
    participantId: z.string().min(1),
    targetHiderId: z.string().min(1),
    catchPin: z.string().optional(),
  }),
  z.object({ action: z.literal('TOGGLE_PAUSE'), participantId: z.string().min(1) }),
  z.object({ action: z.literal('EMERGENCY_STOP'), participantId: z.string().min(1) }),
  z.object({ action: z.literal('REMATCH'), participantId: z.string().min(1) }),
]);

export function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluatePlayBoundary(
  lat: number,
  lng: number,
  _accuracyMeters: number,
  boundary: { lat: number; lng: number; radiusMeters: number }
) {
  const distanceFromCenter = calculateDistanceMeters(lat, lng, boundary.lat, boundary.lng);
  const isOutside = distanceFromCenter > boundary.radiusMeters;
  const outsideMeters = isOutside ? Math.max(1, Math.round(distanceFromCenter - boundary.radiusMeters)) : 0;
  return {
    distanceMeters: Math.round(distanceFromCenter),
    outsideMeters,
    isOutsideWithGrace: isOutside,
    isOutside,
  };
}
