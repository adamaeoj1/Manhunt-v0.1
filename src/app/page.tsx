'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CampusMap, { MapParticipantMarker } from '@/components/CampusMap';
import { ManhuntErrorBoundary } from '@/components/ErrorBoundary';
import { soundEngine } from '@/lib/sound-engine';
import { wakeLockManager } from '@/lib/wake-lock';
import { compressImageFileToDataUrl } from '@/lib/photo-utils';
import {
  AUI_CAMPUS_PRESETS,
  CampusPresetKey,
  GPS_UPDATE_INTERVAL_SECONDS,
  MAX_CAPTURE_DISTANCE_METERS,
  calculateDistanceMeters,
  CatchVerificationMode,
  TeammateVisibilityMode,
  HunterVisibilityMode,
  TauntType,
} from '@/lib/validation';

const TAUNT_OPTIONS: Array<{ type: TauntType; label: string; emoji: string }> = [
  { type: 'CATCH_ME', label: 'Catch Me If You Can!', emoji: '😂' },
  { type: 'I_SEE_YOU', label: 'I See You!', emoji: '👀' },
  { type: 'AIRHORN', label: 'Airhorn Taunt', emoji: '📯' },
  { type: 'TOO_SLOW', label: 'Too Slow!', emoji: '👻' },
];

const QUICK_NOTE_PRESETS: string[] = [
  '📍 Moving toward Academic Quad & Library',
  '👀 Hunter spotted near Student Center!',
  '🏃 Changing hiding spot — stay alert!',
  '⚠️ Watch the green campus boundary!',
];

const SILENT_RADIO_CALLOUTS: string[] = [
  '📍 Hunter near Academic Quad!',
  '👀 Hunter spotted at Library!',
  '🏃 Relocating to building 8!',
  '🤫 Quiet! Hunter is within 30m!',
  '🛡️ Area looks clear right now',
];

interface GameEventItem {
  id: string;
  type:
    | 'NOTE'
    | 'TAUNT'
    | 'SOUND_ALERT'
    | 'PHOTO_REQUEST'
    | 'PHOTO_SUBMITTED'
    | 'CAPTURE'
    | 'CLOAK'
    | 'WALKIE'
    | 'SYSTEM';
  senderId: string | null;
  senderName: string;
  senderRole: 'HUNTER' | 'HIDER' | 'HIDDEN' | null;
  message: string;
  createdAt: number;
}

interface RoomPreviewInfo {
  code: string;
  title: string;
  state: 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'FINISHED';
  hostNickname: string;
  playerCount: number;
  maxPlayers: number;
  hunterCount: number;
  durationMinutes: number;
  countdownSeconds: number;
  radiusMeters: number;
}

interface ParticipantView {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  ready: boolean;
  status: 'ACTIVE' | 'CAPTURED';
  capturedByNickname?: string | null;
  capturesCount?: number;
  gpsConsent: boolean;
  gpsDenied: boolean;
  audioUnlocked: boolean;
  connected: boolean;
  role: 'HUNTER' | 'HIDER' | 'HIDDEN' | null;
  remainingPhotoRequests?: number;
  ghostCloakActive?: boolean;
  ghostCloakSecondsLeft?: number;
  isOutOfBoundsExposed?: boolean;
  location: {
    lat: number;
    lng: number;
    accuracy: number;
    updatedAt: number;
    distanceMeters?: number;
    outsideMeters: number;
    isOutside: boolean;
    ageSeconds: number;
    isStale: boolean;
    outOfBoundsGraceSecondsLeft?: number | null;
    isOutOfBoundsExposed?: boolean;
  } | null;
  photoRequest: {
    id: string;
    status: 'PENDING' | 'SUBMITTED' | 'DECLINED' | 'EXPIRED';
    expiresInSeconds: number;
    hasPhoto: boolean;
    photoDataUrl: string | null;
    remainingRequests?: number;
  } | null;
}

interface GameSnapshot {
  id: string;
  code: string;
  title: string;
  state: 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'FINISHED';
  storageMode: 'SUPABASE' | 'LOCAL_MEMORY';
  serverTime?: number;
  serverNowMs?: number;
  headStartEndsAtMs?: number | null;
  gameEndsAtMs?: number | null;
  pausedRemainingMs?: number | null;
  hostId: string;
  viewerId: string;
  viewerRole: 'HUNTER' | 'HIDER' | null;
  viewerGpsConsent: boolean;
  viewerGpsDenied: boolean;
  viewerAudioUnlocked: boolean;
  viewerCatchPin?: string | null;
  viewerGhostCloak?: {
    used: boolean;
    usedCount?: number;
    maxUses?: number;
    remainingUses?: number;
    active: boolean;
    secondsLeft: number;
  } | null;
  hunterProximity?: { nearby: boolean; distanceBand: 'SAFE' | 'NEAR' | 'CRITICAL' };
  settings: {
    maxPlayers: number;
    hunterCount: number;
    durationMinutes: number;
    countdownSeconds: number;
    gpsIntervalSeconds: number;
    soundUsesPerHunter: number;
    soundCooldownSeconds: number;
    photoRequestsPerHider?: number;
    ghostCloakUsesPerHider?: number;
    walkieTalkieEnabled?: boolean;
    hunterVisibilityMode?: HunterVisibilityMode;
    catchVerificationMode?: CatchVerificationMode;
    outOfBoundsGraceSeconds?: number;
    teammateVisibility?: TeammateVisibilityMode;
    shrinkingZone?: boolean;
    initialRadiusMeters?: number;
    boundary: { lat: number; lng: number; radiusMeters: number };
  };
  countdownSecondsLeft: number;
  gameSecondsLeft: number;
  totalHiders: number;
  activeHiders: number;
  capturedHiders: number;
  winnerTeam: 'HUNTERS' | 'HIDERS' | 'NONE' | null;
  winReason: string | null;
  capturesLog?: Array<{
    id: string;
    hunterId: string;
    hunterNickname: string;
    hiderId: string;
    hiderNickname: string;
    capturedAt: number;
  }>;
  events?: GameEventItem[];
  soundAbility: { remainingUses: number; maxUses: number; cooldownSecondsLeft: number } | null;
  recentTargetedAlert: { id: string; hunterId: string; targetHiderId: string; deliveryStatus: string; createdAt: number } | null;
  latestVoiceClip?: {
    id: string;
    senderId: string;
    senderNickname: string;
    senderRole: 'HUNTER' | 'HIDER' | null;
    audioDataUrl?: string;
    voiceText?: string;
    disguised: boolean;
    durationSeconds: number;
    createdAt: number;
  } | null;
  recentWalkieMessages?: Array<{
    id: string;
    senderId: string;
    senderNickname: string;
    senderRole: 'HUNTER' | 'HIDER' | null;
    audioDataUrl: string;
    disguised: boolean;
    durationSeconds: number;
    createdAt: number;
  }>;
  recentTaunts?: Array<{
    id: string;
    senderId: string;
    senderNickname: string;
    senderRole: 'HUNTER' | 'HIDER' | null;
    tauntType: TauntType;
    createdAt: number;
  }>;
  tauntCooldownSecondsLeft?: number;
  participants: ParticipantView[];
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const TAB_SESSION_STORAGE_KEY = 'aui_manhunt_tab_session_v1';

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function computeTargetRemainingSeconds(
  targetEndMs: number | null | undefined,
  serverTimeOffsetMs: number,
  fallbackSeconds: number
): number {
  if (typeof targetEndMs === 'number' && targetEndMs > 0) {
    return Math.max(0, Math.ceil((targetEndMs - (Date.now() + serverTimeOffsetMs)) / 1000));
  }
  return Math.max(0, Math.floor(fallbackSeconds));
}

/**
 * Isolated 250ms Real-Time Countdown Header Ticker wrapped in React.memo.
 * Prevents full-page re-renders on every second tick while guaranteeing
 * 100% smooth second-by-second countdown (0:10 -> 0:09 -> 0:08...) and instant
 * transition from COUNTDOWN to ACTIVE at 0:00.
 */
const SmoothCountdownHeaderTicker = React.memo(function SmoothCountdownHeaderTicker({
  state,
  headStartEndsAtMs,
  gameEndsAtMs,
  pausedRemainingMs,
  fallbackCountdownSeconds,
  fallbackGameSeconds,
  serverTimeOffsetMs,
  onCountdownZero,
}: {
  state: 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'FINISHED';
  headStartEndsAtMs?: number | null;
  gameEndsAtMs?: number | null;
  pausedRemainingMs?: number | null;
  fallbackCountdownSeconds: number;
  fallbackGameSeconds: number;
  serverTimeOffsetMs: number;
  onCountdownZero?: () => void;
}) {
  const [displaySecs, setDisplaySecs] = useState<number>(() => {
    if (state === 'COUNTDOWN') {
      return computeTargetRemainingSeconds(headStartEndsAtMs, serverTimeOffsetMs, fallbackCountdownSeconds);
    }
    if (state === 'PAUSED') {
      return typeof pausedRemainingMs === 'number'
        ? Math.max(0, Math.ceil(pausedRemainingMs / 1000))
        : Math.max(0, Math.floor(fallbackGameSeconds));
    }
    return computeTargetRemainingSeconds(gameEndsAtMs, serverTimeOffsetMs, fallbackGameSeconds);
  });

  const lastBeepSecRef = useRef<number | null>(null);
  const zeroTriggeredRef = useRef(false);

  useEffect(() => {
    zeroTriggeredRef.current = false;
    lastBeepSecRef.current = null;
  }, [state, headStartEndsAtMs]);

  useEffect(() => {
    const tick = () => {
      if (state === 'COUNTDOWN') {
        const secs = computeTargetRemainingSeconds(headStartEndsAtMs, serverTimeOffsetMs, fallbackCountdownSeconds);
        setDisplaySecs((prev) => (prev !== secs ? secs : prev));
        if (secs >= 1 && secs <= 10 && lastBeepSecRef.current !== secs) {
          lastBeepSecRef.current = secs;
          soundEngine.playCountdownTick(secs);
        }
        if (secs <= 0 && !zeroTriggeredRef.current) {
          zeroTriggeredRef.current = true;
          if (onCountdownZero) onCountdownZero();
        }
      } else if (state === 'PAUSED') {
        const secs =
          typeof pausedRemainingMs === 'number'
            ? Math.max(0, Math.ceil(pausedRemainingMs / 1000))
            : Math.max(0, Math.floor(fallbackGameSeconds));
        setDisplaySecs((prev) => (prev !== secs ? secs : prev));
      } else if (state === 'ACTIVE') {
        const secs = computeTargetRemainingSeconds(gameEndsAtMs, serverTimeOffsetMs, fallbackGameSeconds);
        setDisplaySecs((prev) => (prev !== secs ? secs : prev));
      }
    };

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [
    state,
    headStartEndsAtMs,
    gameEndsAtMs,
    pausedRemainingMs,
    fallbackCountdownSeconds,
    fallbackGameSeconds,
    serverTimeOffsetMs,
    onCountdownZero,
  ]);

  return (
    <span className="font-mono font-bold text-xl text-ink leading-none">
      {state === 'COUNTDOWN'
        ? `Start in ${formatClock(displaySecs)}`
        : state === 'PAUSED'
        ? `${formatClock(displaySecs)} (PAUSED)`
        : formatClock(displaySecs)}
    </span>
  );
});

/**
 * Isolated 250ms Real-Time Countdown for Role Reveal Screen wrapped in React.memo.
 */
const RoleRevealCountdownCard = React.memo(function RoleRevealCountdownCard({
  state,
  isHunter,
  headStartEndsAtMs,
  gameEndsAtMs,
  pausedRemainingMs,
  fallbackCountdownSeconds,
  fallbackGameSeconds,
  serverTimeOffsetMs,
  onCountdownZero,
  onOpenMap,
}: {
  state: 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'FINISHED';
  isHunter: boolean;
  headStartEndsAtMs?: number | null;
  gameEndsAtMs?: number | null;
  pausedRemainingMs?: number | null;
  fallbackCountdownSeconds: number;
  fallbackGameSeconds: number;
  serverTimeOffsetMs: number;
  onCountdownZero?: () => void;
  onOpenMap: () => void;
}) {
  const [countdownSecs, setCountdownSecs] = useState<number>(() =>
    computeTargetRemainingSeconds(headStartEndsAtMs, serverTimeOffsetMs, fallbackCountdownSeconds)
  );
  const [gameSecs, setGameSecs] = useState<number>(() =>
    computeTargetRemainingSeconds(gameEndsAtMs, serverTimeOffsetMs, fallbackGameSeconds)
  );
  const lastBeepSecRef = useRef<number | null>(null);
  const zeroTriggeredRef = useRef(false);

  useEffect(() => {
    zeroTriggeredRef.current = false;
    lastBeepSecRef.current = null;
  }, [state, headStartEndsAtMs]);

  useEffect(() => {
    const tick = () => {
      if (state === 'COUNTDOWN') {
        const secs = computeTargetRemainingSeconds(headStartEndsAtMs, serverTimeOffsetMs, fallbackCountdownSeconds);
        setCountdownSecs((prev) => (prev !== secs ? secs : prev));
        if (secs >= 1 && secs <= 10 && lastBeepSecRef.current !== secs) {
          lastBeepSecRef.current = secs;
          soundEngine.playCountdownTick(secs);
        }
        if (secs <= 0 && !zeroTriggeredRef.current) {
          zeroTriggeredRef.current = true;
          if (onCountdownZero) onCountdownZero();
        }
      } else if (state === 'PAUSED') {
        const secs =
          typeof pausedRemainingMs === 'number'
            ? Math.max(0, Math.ceil(pausedRemainingMs / 1000))
            : Math.max(0, Math.floor(fallbackGameSeconds));
        setGameSecs((prev) => (prev !== secs ? secs : prev));
      } else {
        const secs = computeTargetRemainingSeconds(gameEndsAtMs, serverTimeOffsetMs, fallbackGameSeconds);
        setGameSecs((prev) => (prev !== secs ? secs : prev));
      }
    };

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [
    state,
    headStartEndsAtMs,
    gameEndsAtMs,
    pausedRemainingMs,
    fallbackCountdownSeconds,
    fallbackGameSeconds,
    serverTimeOffsetMs,
    onCountdownZero,
  ]);

  const isCountingDown = state === 'COUNTDOWN' && countdownSecs > 0;
  const isHunterLocked = Boolean(isHunter && isCountingDown);

  return (
    <>
      <div className="p-4 rounded-2xl bg-canvas border border-stoneline">
        <span className="text-xs font-semibold text-ink-muted block">
          {isCountingDown ? 'Hider head-start countdown' : 'Time remaining'}
        </span>
        <span className="font-mono font-bold text-3xl text-ink mt-1 block">
          {isCountingDown ? formatClock(countdownSecs) : formatClock(gameSecs)}
        </span>
        {isHunterLocked && (
          <span className="text-xs font-semibold text-amber-800 mt-1.5 block">
            Live map &amp; Hider locations are locked while Hiders hide!
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={isHunterLocked}
        onClick={onOpenMap}
        className="btn-cedar w-full h-14 rounded-2xl font-display font-bold text-base shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isHunterLocked
          ? `Map Locked During Countdown (${formatClock(countdownSecs)})`
          : 'Open Live Campus Map'}
      </button>
    </>
  );
});

/**
 * Isolated 250ms Real-Time Countdown Overlay when Hunter map is locked during COUNTDOWN.
 */
const HunterLockedMapCountdownOverlay = React.memo(function HunterLockedMapCountdownOverlay({
  headStartEndsAtMs,
  fallbackCountdownSeconds,
  serverTimeOffsetMs,
  onCountdownZero,
}: {
  headStartEndsAtMs?: number | null;
  fallbackCountdownSeconds: number;
  serverTimeOffsetMs: number;
  onCountdownZero?: () => void;
}) {
  const [secsLeft, setSecsLeft] = useState<number>(() =>
    computeTargetRemainingSeconds(headStartEndsAtMs, serverTimeOffsetMs, fallbackCountdownSeconds)
  );
  const zeroTriggeredRef = useRef(false);

  useEffect(() => {
    zeroTriggeredRef.current = false;
  }, [headStartEndsAtMs]);

  useEffect(() => {
    const tick = () => {
      const secs = computeTargetRemainingSeconds(headStartEndsAtMs, serverTimeOffsetMs, fallbackCountdownSeconds);
      setSecsLeft((prev) => (prev !== secs ? secs : prev));
      if (secs <= 0 && !zeroTriggeredRef.current) {
        zeroTriggeredRef.current = true;
        if (onCountdownZero) onCountdownZero();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [headStartEndsAtMs, fallbackCountdownSeconds, serverTimeOffsetMs, onCountdownZero]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-stone-900/90 text-white">
      <div className="w-16 h-16 rounded-2xl bg-hunter flex items-center justify-center font-mono font-extrabold text-2xl mb-3 shadow-lg">
        {formatClock(secsLeft)}
      </div>
      <h3 className="font-display font-bold text-xl">Hiding Phase in Progress</h3>
      <p className="text-xs text-stone-300 max-w-sm mt-1.5 leading-relaxed">
        The live campus map and Hider positions are locked for Hunters during the head-start countdown. The map and capture controls will unlock automatically when the timer reaches 00:00.
      </p>
    </div>
  );
});

export default function AuiManhuntPage() {
  return (
    <ManhuntErrorBoundary>
      <AuiManhuntApp />
    </ManhuntErrorBoundary>
  );
}

function AuiManhuntApp() {
  const [screen, setScreen] = useState<'HOME' | 'CREATE' | 'JOIN'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const rawRoom = (params.get('room') || params.get('code') || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
      if (rawRoom.length === 6) return 'JOIN';
    }
    return 'HOME';
  });
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [knownPlayerIds, setKnownPlayerIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [dismissedRoleForPlayers, setDismissedRoleForPlayers] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'radio' | 'players' | 'feed' | 'safety'>('radio');
  const [sessionHydrated, setSessionHydrated] = useState(false);

  // Setup state
  const [createNickname, setCreateNickname] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('aui_manhunt_last_nick') || '';
    }
    return '';
  });
  const [createTitle, setCreateTitle] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<'standard' | 'battle_royale' | 'stealth'>('standard');
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);
  const [silentRadioInput, setSilentRadioInput] = useState('');
  const [createHunters, setCreateHunters] = useState(1);
  const [createDuration, setCreateDuration] = useState(20);
  const [createCountdown, setCreateCountdown] = useState(10);
  const [createGpsInterval, setCreateGpsInterval] = useState(60);
  const [createSoundUses, setCreateSoundUses] = useState(3);
  const [createSoundCooldown, setCreateSoundCooldown] = useState(90);
  const [createPhotoLimit, setCreatePhotoLimit] = useState(1);
  const [createGhostCloakUses, setCreateGhostCloakUses] = useState(1);
  const [createWalkieEnabled, setCreateWalkieEnabled] = useState(true);
  const [createHunterVisMode, setCreateHunterVisMode] = useState<HunterVisibilityMode>('ALWAYS_LIVE');
  const [createCatchMode, setCreateCatchMode] = useState<CatchVerificationMode>('PROXIMITY_20M');
  const [createGracePeriod, setCreateGracePeriod] = useState(60);
  const [createTeammateVis, setCreateTeammateVis] = useState<TeammateVisibilityMode>('SHOW_TEAMMATES');
  const [createShrinkingZone, setCreateShrinkingZone] = useState(false);
  const [activePresetKey, setActivePresetKey] = useState<CampusPresetKey>('main');
  const [setupBoundary, setSetupBoundary] = useState<{ lat: number; lng: number; radiusMeters: number }>({
    lat: AUI_CAMPUS_PRESETS.main.lat,
    lng: AUI_CAMPUS_PRESETS.main.lng,
    radiusMeters: AUI_CAMPUS_PRESETS.main.radiusMeters,
  });
  const [setupCenterCmd, setSetupCenterCmd] = useState<{ lat: number; lng: number; zoom?: number; ts: number } | null>(null);

  const applyQuickModePreset = useCallback((presetId: 'standard' | 'battle_royale' | 'stealth') => {
    setSelectedPresetId(presetId);
    if (presetId === 'standard') {
      setCreateHunters(1);
      setCreateDuration(20);
      setCreateCountdown(30);
      setCreateGpsInterval(60);
      setCreateGhostCloakUses(1);
      setCreateWalkieEnabled(true);
      setCreateHunterVisMode('ALWAYS_LIVE');
      setCreateCatchMode('PROXIMITY_20M');
      setCreateShrinkingZone(false);
      setCreateTeammateVis('SHOW_TEAMMATES');
      setCreateSoundUses(3);
      setCreateSoundCooldown(90);
      setCreatePhotoLimit(1);
      setCreateGracePeriod(60);
    } else if (presetId === 'battle_royale') {
      setCreateHunters(2);
      setCreateDuration(15);
      setCreateCountdown(10);
      setCreateGpsInterval(15);
      setCreateGhostCloakUses(1);
      setCreateWalkieEnabled(true);
      setCreateHunterVisMode('ALWAYS_LIVE');
      setCreateCatchMode('PROXIMITY_20M');
      setCreateShrinkingZone(true);
      setCreateTeammateVis('SHOW_TEAMMATES');
      setCreateSoundUses(5);
      setCreateSoundCooldown(60);
      setCreatePhotoLimit(1);
      setCreateGracePeriod(30);
    } else if (presetId === 'stealth') {
      setCreateHunters(1);
      setCreateDuration(20);
      setCreateCountdown(30);
      setCreateGpsInterval(90);
      setCreateGhostCloakUses(2);
      setCreateWalkieEnabled(true);
      setCreateHunterVisMode('HIDDEN');
      setCreateCatchMode('CATCH_PIN');
      setCreateShrinkingZone(false);
      setCreateTeammateVis('HIDE_TEAMMATES');
      setCreateSoundUses(2);
      setCreateSoundCooldown(120);
      setCreatePhotoLimit(2);
      setCreateGracePeriod(60);
    }
  }, []);

  const [joinCodeInput, setJoinCodeInput] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return (params.get('room') || params.get('code') || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
    }
    return '';
  });
  const [joinNicknameInput, setJoinNicknameInput] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('aui_manhunt_last_nick') || '';
    }
    return '';
  });
  const joinNicknameInputRef = useRef<HTMLInputElement | null>(null);
  const [roomPreview, setRoomPreview] = useState<RoomPreviewInfo | null>(null);
  const [roomPreviewLoading, setRoomPreviewLoading] = useState(false);

  // Live Notes & Activity Feed state
  const [noteInput, setNoteInput] = useState('');
  const [activeEventBanner, setActiveEventBanner] = useState<GameEventItem | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const seededEventsGameIdRef = useRef<string | null>(null);

  // Server time offset & Request versioning / AbortController
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const serverTimeOffsetRef = useRef(0);
  const stateVersionRef = useRef(0);
  const pollAbortControllerRef = useRef<AbortController | null>(null);

  // Form submission & optimistic action states
  const [isCreatingLobby, setIsCreatingLobby] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isJoiningLobby, setIsJoiningLobby] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const actionInFlightCountRef = useRef(0);
  const lastServerTimeRef = useRef(0);
  const photoCacheRef = useRef<Map<string, string>>(new Map());

  // Map & GPS state
  const [gameCenterCmd, setGameCenterCmd] = useState<{ lat: number; lng: number; zoom?: number; ts: number } | null>(null);
  const [fitBoundaryCmd, setFitBoundaryCmd] = useState<number>(0);
  const [localGpsFix, setLocalGpsFix] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    updatedAt: number;
  } | null>(null);
  const localGpsFixRef = useRef<{
    lat: number;
    lng: number;
    accuracy: number;
    updatedAt: number;
  } | null>(null);

  // PWA Standalone & Install Prompt state
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const deferredInstallPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  // Walkie-Talkie & Quick Taunts state
  const [walkieRecording, setWalkieRecording] = useState(false);
  const [walkieRecordingSeconds, setWalkieRecordingSeconds] = useState(0);
  const [walkieDisguised, setWalkieDisguised] = useState(false);
  const [activeWalkieSpeaker, setActiveWalkieSpeaker] = useState<{
    nickname: string;
    role: string;
    disguised: boolean;
  } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const walkieStreamRef = useRef<MediaStream | null>(null);
  const walkieChunksRef = useRef<BlobPart[]>([]);
  const walkieStartMsRef = useRef<number>(0);
  const walkieMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walkieTickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playedWalkieIdsRef = useRef<Set<string>>(new Set());
  const playedTauntIdsRef = useRef<Set<string>>(new Set());

  const [isOnline, setIsOnline] = useState(true);
  const [gpsInFlight, setGpsInFlight] = useState(false);
  const gpsInFlightRef = useRef(false);
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState(false);
  const [lastGpsError, setLastGpsError] = useState<string | null>(null);
  const gpsDeniedRef = useRef(false);
  const gpsClearGraceUntilRef = useRef(0);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const gpsRequestSeqRef = useRef(0);
  const lastGpsSubmitAtRef = useRef(0);
  const pollInFlightRef = useRef(false);

  // Sound & WakeLock state
  const [soundUnlockedLocal, setSoundUnlockedLocal] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const playedAlertIdsRef = useRef<Set<string>>(new Set());
  const notifiedPhotoReqIdsRef = useRef<Set<string>>(new Set());
  const notifiedSubmittedPhotoIdsRef = useRef<Set<string>>(new Set());
  const lastCountdownTickRef = useRef<number | null>(null);
  const prevGameStateRef = useRef<string | null>(null);

  // Modals & Camera state
  const [pendingCaptureTarget, setPendingCaptureTarget] = useState<ParticipantView | null>(null);
  const [capturePinInput, setCapturePinInput] = useState('');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraStreamActive, setCameraStreamActive] = useState(false);
  const [cameraStreamError, setCameraStreamError] = useState<string | null>(null);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [photoCompressing, setPhotoCompressing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [viewerPhotoModal, setViewerPhotoModal] = useState<{ nickname: string; url: string } | null>(null);

  const latestStateRef = useRef<{
    roomCode: string | null;
    activePlayerId: string | null;
    snapshot: GameSnapshot | null;
    isOnline: boolean;
  }>({ roomCode: null, activePlayerId: null, snapshot: null, isOnline: true });

  useEffect(() => {
    latestStateRef.current = { roomCode, activePlayerId, snapshot, isOnline };
  }, [roomCode, activePlayerId, snapshot, isOnline]);

  // Toast notifications (deduplicated, 4s duration, manual close)
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; tone: 'info' | 'warning' | 'error' }>>([]);
  const toastTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimeoutsRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((text: string, tone: 'info' | 'warning' | 'error' = 'info') => {
    const cleanText = text.trim();
    if (!cleanText) return;
    setToasts((prev) => {
      if (prev.some((t) => t.text === cleanText)) {
        return prev;
      }
      const id = Date.now() + Math.random();
      const timer = setTimeout(() => {
        toastTimeoutsRef.current.delete(id);
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 4000);
      toastTimeoutsRef.current.set(id, timer);
      return [...prev, { id, text: cleanText, tone }];
    });
  }, []);

  useEffect(() => {
    const timeouts = toastTimeoutsRef.current;
    return () => {
      timeouts.forEach((timer) => clearTimeout(timer));
      timeouts.clear();
    };
  }, []);

  const stopAllGpsTracking = useCallback(() => {
    gpsRequestSeqRef.current += 1;
    gpsInFlightRef.current = false;
    setGpsInFlight(false);
    if (gpsIntervalRef.current !== null) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
    if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      } catch {}
      gpsWatchIdRef.current = null;
    }
  }, []);

  const clearGpsDeniedImmediately = useCallback((optimisticConsent = true) => {
    gpsDeniedRef.current = false;
    gpsClearGraceUntilRef.current = Date.now() + 10000;
    setGpsPermissionDenied(false);
    setLastGpsError(null);
    setSnapshot((prev) => {
      if (!prev) return prev;
      const pid = latestStateRef.current.activePlayerId || prev.viewerId;
      return {
        ...prev,
        viewerGpsDenied: false,
        viewerGpsConsent: optimisticConsent ? true : prev.viewerGpsConsent,
        participants: prev.participants.map((p) =>
          p.id === pid
            ? {
                ...p,
                gpsDenied: false,
                gpsConsent: optimisticConsent ? true : p.gpsConsent,
              }
            : p
        ),
      };
    });
  }, []);

  const triggerEventBanner = useCallback((evt: GameEventItem) => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    setActiveEventBanner(evt);
    bannerTimerRef.current = setTimeout(() => {
      setActiveEventBanner((curr) => (curr?.id === evt.id ? null : curr));
      bannerTimerRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
      if (pollAbortControllerRef.current) {
        pollAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Global first-interaction AudioContext auto-unlock & state sync
  useEffect(() => {
    soundEngine.registerGlobalAutoUnlock();
    const onFirstUserGesture = () => {
      setSoundUnlockedLocal(true);
    };
    window.addEventListener('pointerdown', onFirstUserGesture, { once: true, capture: true, passive: true });
    window.addEventListener('touchstart', onFirstUserGesture, { once: true, capture: true, passive: true });
    window.addEventListener('click', onFirstUserGesture, { once: true, capture: true, passive: true });
    window.addEventListener('keydown', onFirstUserGesture, { once: true, capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstUserGesture, true);
      window.removeEventListener('touchstart', onFirstUserGesture, true);
      window.removeEventListener('click', onFirstUserGesture, true);
      window.removeEventListener('keydown', onFirstUserGesture, true);
    };
  }, []);

  // Isolate player session in per-tab sessionStorage and auto-read room code from URL (?room=CODE)
  useEffect(() => {
    try {
      window.localStorage.removeItem('aui_manhunt_session');
      window.localStorage.removeItem(TAB_SESSION_STORAGE_KEY);
      window.localStorage.removeItem('activePlayerId');
      window.localStorage.removeItem('roomCode');
    } catch {}

    const params = new URLSearchParams(window.location.search);
    const rawRoomParam = (params.get('room') || params.get('code') || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);

    let restoredRoom: string | null = null;
    let restoredPlayerId: string | null = null;
    let restoredKnownIds: string[] = [];
    let restoredDismissed: Record<string, boolean> = {};

    try {
      const rawSession = window.sessionStorage.getItem(TAB_SESSION_STORAGE_KEY);
      if (rawSession) {
        const parsed = JSON.parse(rawSession);
        if (parsed && typeof parsed.roomCode === 'string' && typeof parsed.activePlayerId === 'string') {
          restoredRoom = parsed.roomCode.trim().toUpperCase();
          restoredPlayerId = parsed.activePlayerId;
          restoredKnownIds = Array.isArray(parsed.knownPlayerIds) ? parsed.knownPlayerIds : [parsed.activePlayerId];
          restoredDismissed =
            parsed.dismissedRoleForPlayers && typeof parsed.dismissedRoleForPlayers === 'object'
              ? parsed.dismissedRoleForPlayers
              : {};
        }
      }
    } catch {}

    if (rawRoomParam) {
      setJoinCodeInput(rawRoomParam);
      if (!restoredRoom || restoredRoom !== rawRoomParam) {
        restoredRoom = null;
        restoredPlayerId = null;
        restoredKnownIds = [];
        setScreen('JOIN');
      }
    }

    if (restoredRoom && restoredPlayerId) {
      setRoomCode(restoredRoom);
      setActivePlayerId(restoredPlayerId);
      setKnownPlayerIds(restoredKnownIds);
      setDismissedRoleForPlayers(restoredDismissed);
    } else if (rawRoomParam) {
      setScreen('JOIN');
    }

    setSessionHydrated(true);
  }, []);

  // Automatically fetch room preview & focus nickname field when on JOIN screen with 6-character code
  useEffect(() => {
    if (snapshot || screen !== 'JOIN') return;
    const cleanCode = joinCodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanCode.length === 6) {
      setTimeout(() => {
        joinNicknameInputRef.current?.focus();
      }, 60);

      let cancelled = false;
      setRoomPreviewLoading(true);
      fetch(`/api/games?code=${encodeURIComponent(cleanCode)}&preview=1`, { cache: 'no-store' })
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) {
            setRoomPreview(null);
            return;
          }
          const data = await res.json();
          if (!cancelled && data.preview) {
            setRoomPreview(data.preview);
          }
        })
        .catch(() => {
          if (!cancelled) setRoomPreview(null);
        })
        .finally(() => {
          if (!cancelled) setRoomPreviewLoading(false);
        });

      return () => {
        cancelled = true;
      };
    } else {
      setRoomPreview(null);
      setRoomPreviewLoading(false);
    }
  }, [snapshot, screen, joinCodeInput]);

  useEffect(() => {
    if (!sessionHydrated) return;
    try {
      if (roomCode && activePlayerId) {
        window.sessionStorage.setItem(
          TAB_SESSION_STORAGE_KEY,
          JSON.stringify({
            roomCode,
            activePlayerId,
            knownPlayerIds,
            dismissedRoleForPlayers,
          })
        );
      } else {
        window.sessionStorage.removeItem(TAB_SESSION_STORAGE_KEY);
      }
    } catch {}
  }, [sessionHydrated, roomCode, activePlayerId, knownPlayerIds, dismissedRoleForPlayers]);

  // Network & Service Worker
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      setLastGpsError(null);
      showToast('Back online!');
    };
    const handleOffline = () => {
      setIsOnline(false);
      setLastGpsError('Offline — waiting for network connection');
      showToast('Network disconnected. Live multiplayer requires an internet connection.', 'error');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Detect standalone PWA mode & capture Android Chrome beforeinstallprompt
    const checkStandalone = () => {
      const standaloneMq = window.matchMedia?.('(display-mode: standalone)')?.matches;
      const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
      setIsStandaloneApp(Boolean(standaloneMq || iosStandalone));
    };
    checkStandalone();

    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMqChange = () => checkStandalone();
    if (mq?.addEventListener) {
      mq.addEventListener('change', onMqChange);
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredInstallPromptRef.current = e as BeforeInstallPromptEvent;
    };
    const onAppInstalled = () => {
      deferredInstallPromptRef.current = null;
      setIsStandaloneApp(true);
      setShowInstallModal(false);
      showToast('AUI Manhunt installed on your home screen!');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      if (mq?.removeEventListener) {
        mq.removeEventListener('change', onMqChange);
      }
    };
  }, [showToast]);

  const handleInstallAppClick = useCallback(async () => {
    const promptEvent = deferredInstallPromptRef.current;
    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === 'accepted') {
          deferredInstallPromptRef.current = null;
        }
        return;
      } catch {
        // Fall through to instruction modal if prompt fails
      }
    }
    setShowInstallModal(true);
  }, []);

  const handleShareRoomInvite = useCallback(
    async (code: string, title?: string) => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const inviteUrl = `${origin}/?room=${encodeURIComponent(code)}`;
      const shareTitle = title || 'AUI Campus Manhunt';
      const shareText = `Join our live AUI Campus Manhunt game! Room Code: ${code}`;

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: inviteUrl,
          });
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }

      try {
        await navigator.clipboard?.writeText(inviteUrl);
        showToast('Invite link copied to clipboard!');
      } catch {
        showToast(`Invite link: ${inviteUrl}`);
      }
    },
    [showToast]
  );

  // Screen Wake Lock API during COUNTDOWN / ACTIVE gameplay
  useEffect(() => {
    const shouldKeepAwake = Boolean(snapshot && (snapshot.state === 'COUNTDOWN' || snapshot.state === 'ACTIVE'));
    if (shouldKeepAwake) {
      wakeLockManager.acquire().then((ok) => setWakeLockActive(ok));
    } else {
      wakeLockManager.release().then(() => setWakeLockActive(false));
    }

    const handleVis = () => {
      if (document.visibilityState === 'visible' && shouldKeepAwake) {
        wakeLockManager.handleVisibilityRestore().then((ok) => setWakeLockActive(ok));
      }
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => {
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, [snapshot?.state]);

  useEffect(() => {
    return () => {
      wakeLockManager.release();
    };
  }, []);

  const hydrateSnapshotWithMediaCache = useCallback((rawSnap: GameSnapshot, pid: string): GameSnapshot => {
    const serverNow = rawSnap.serverNowMs || rawSnap.serverTime;
    if (typeof serverNow === 'number' && serverNow > 0) {
      const offset = serverNow - Date.now();
      serverTimeOffsetRef.current = offset;
      setServerTimeOffsetMs((prev) => (Math.abs(prev - offset) > 200 ? offset : prev));
      if (serverNow > lastServerTimeRef.current) {
        lastServerTimeRef.current = serverNow;
      }
    }
    const inClearGrace = Date.now() < gpsClearGraceUntilRef.current;
    return {
      ...rawSnap,
      viewerGpsDenied: inClearGrace ? false : rawSnap.viewerGpsDenied,
      viewerGpsConsent: inClearGrace ? true : rawSnap.viewerGpsConsent,
      participants: rawSnap.participants.map((p: ParticipantView) => {
        let nextPr = p.photoRequest;
        if (nextPr) {
          if (nextPr.photoDataUrl) {
            photoCacheRef.current.set(nextPr.id, nextPr.photoDataUrl);
          } else if (nextPr.hasPhoto && photoCacheRef.current.has(nextPr.id)) {
            nextPr = {
              ...nextPr,
              photoDataUrl: photoCacheRef.current.get(nextPr.id) || null,
            };
          }
        }
        return {
          ...p,
          gpsDenied: inClearGrace && p.id === pid ? false : p.gpsDenied,
          gpsConsent: inClearGrace && p.id === pid ? true : p.gpsConsent,
          photoRequest: nextPr,
        };
      }),
    };
  }, []);

  const fetchGameState = useCallback(
    async (code: string, pid: string, includeMedia = false) => {
      if (pollInFlightRef.current || (actionInFlightCountRef.current > 0 && !includeMedia)) return;
      const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!cleanCode || !pid) return;

      const reqVersion = stateVersionRef.current;
      const controller = new AbortController();
      pollAbortControllerRef.current = controller;
      pollInFlightRef.current = true;

      try {
        const sinceParam = includeMedia ? 0 : lastServerTimeRef.current;
        const res = await fetch(
          `/api/games?code=${encodeURIComponent(cleanCode)}&participantId=${encodeURIComponent(pid)}&since=${sinceParam}${
            includeMedia ? '&includeMedia=1' : ''
          }`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!res.ok) {
          if (res.status === 404) {
            setRoomCode(null);
            setActivePlayerId(null);
            setSnapshot(null);
            setKnownPlayerIds([]);
            if (cleanCode.length === 6) {
              setJoinCodeInput(cleanCode);
              setScreen('JOIN');
            }
          }
          return;
        }
        if (
          controller.signal.aborted ||
          reqVersion !== stateVersionRef.current ||
          (actionInFlightCountRef.current > 0 && !includeMedia)
        ) {
          return;
        }
        const data = await res.json();
        if (
          controller.signal.aborted ||
          reqVersion !== stateVersionRef.current ||
          (actionInFlightCountRef.current > 0 && !includeMedia)
        ) {
          return;
        }
        if (data.snapshot) {
          const inClearGrace = Date.now() < gpsClearGraceUntilRef.current;
          const nextSnap = hydrateSnapshotWithMediaCache(data.snapshot, pid);
          setSnapshot(nextSnap);
          if (nextSnap.viewerGpsDenied && !inClearGrace) {
            gpsDeniedRef.current = true;
            setGpsPermissionDenied(true);
            stopAllGpsTracking();
          }
        }
      } catch {
      } finally {
        if (pollAbortControllerRef.current === controller) {
          pollAbortControllerRef.current = null;
        }
        pollInFlightRef.current = false;
      }
    },
    [hydrateSnapshotWithMediaCache, stopAllGpsTracking]
  );

  // Instant transition when local 250ms countdown ticker hits 0:00
  const handleCountdownReachedZero = useCallback(() => {
    setSnapshot((prev) => {
      if (!prev || prev.state !== 'COUNTDOWN') return prev;
      return {
        ...prev,
        state: 'ACTIVE',
        countdownSecondsLeft: 0,
      };
    });
    const { roomCode: code, activePlayerId: pid } = latestStateRef.current;
    if (code && pid) {
      fetchGameState(code, pid);
    }
  }, [fetchGameState]);

  // Lightweight delta-synced polling loop (2000ms) with clean teardown
  useEffect(() => {
    if (!roomCode || !activePlayerId) return;
    fetchGameState(roomCode, activePlayerId);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchGameState(roomCode, activePlayerId);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [roomCode, activePlayerId, fetchGameState]);

  // Real-time sound & live notes/events triggers
  useEffect(() => {
    if (!snapshot) {
      prevGameStateRef.current = null;
      lastCountdownTickRef.current = null;
      return;
    }

    // 1. Game state transitions (Start / Finish)
    const prevState = prevGameStateRef.current;
    if (prevState && prevState !== snapshot.state) {
      if (snapshot.state === 'ACTIVE' && (prevState === 'COUNTDOWN' || prevState === 'LOBBY')) {
        soundEngine.playGameTransitionTone('START');
        showToast('The Hunt is now ACTIVE!', 'info');
      } else if (snapshot.state === 'FINISHED') {
        soundEngine.playVictoryFanfare(snapshot.winnerTeam);
      }
    }
    prevGameStateRef.current = snapshot.state;

    let playedSpecificAlertThisCycle = false;

    // 2. Targeted Hunter Sound Alert -> 4-second 600Hz/1200Hz Siren + Vibration
    if (snapshot.recentTargetedAlert) {
      const alert = snapshot.recentTargetedAlert;
      if (alert.targetHiderId === activePlayerId && !playedAlertIdsRef.current.has(alert.id)) {
        playedAlertIdsRef.current.add(alert.id);
        playedSpecificAlertThisCycle = true;
        soundEngine.playHunterSiren(4.0);
        showToast('🚨 HUNTER SIREN ALERT! Your phone is broadcasting a 4-second siren!', 'warning');
      }
    }

    // 3. Photo Request Alert for Hider & Photo Submission Notification for Hunter
    const currentMe = snapshot.participants.find((p) => p.id === activePlayerId);
    if (currentMe?.photoRequest && currentMe.photoRequest.status === 'PENDING') {
      const prId = currentMe.photoRequest.id;
      if (!notifiedPhotoReqIdsRef.current.has(prId)) {
        notifiedPhotoReqIdsRef.current.add(prId);
        playedSpecificAlertThisCycle = true;
        soundEngine.playPhotoRequestAlert();
        showToast('📷 A Hunter requested a photo of your surroundings! Respond before the timer expires.', 'warning');
      }
    }

    if (snapshot.viewerRole === 'HUNTER') {
      for (const p of snapshot.participants) {
        const pr = p.photoRequest;
        if (pr && pr.status === 'SUBMITTED' && pr.hasPhoto && pr.photoDataUrl) {
          if (!notifiedSubmittedPhotoIdsRef.current.has(pr.id)) {
            notifiedSubmittedPhotoIdsRef.current.add(pr.id);
            playedSpecificAlertThisCycle = true;
            soundEngine.playPhotoRequestAlert();
            showToast(`📷 ${p.nickname} submitted a surroundings photo! Opening intel view...`, 'info');
            setViewerPhotoModal({ nickname: p.nickname, url: pr.photoDataUrl });
          }
        }
      }
    }

    // 4. Walkie-Talkie Incoming Voice Clips & Silent Radio TTS
    if (snapshot.latestVoiceClip) {
      const clip = snapshot.latestVoiceClip;
      if (!playedWalkieIdsRef.current.has(clip.id)) {
        playedWalkieIdsRef.current.add(clip.id);
        playedSpecificAlertThisCycle = true;
        const roleLabel = clip.senderRole || 'PLAYER';
        setActiveWalkieSpeaker({
          nickname: clip.senderNickname,
          role: roleLabel,
          disguised: clip.disguised,
        });
        const onEnd = () => {
          setActiveWalkieSpeaker((prev) =>
            prev && prev.nickname === clip.senderNickname ? null : prev
          );
        };
        if (clip.audioDataUrl) {
          soundEngine.playWalkieTalkieAudio(clip.audioDataUrl, clip.disguised, onEnd);
        } else if (clip.voiceText) {
          soundEngine.playSilentRadioTTS(clip.voiceText, clip.disguised, onEnd);
        }
      }
    } else if (snapshot.recentWalkieMessages && snapshot.recentWalkieMessages.length > 0) {
      for (const msg of snapshot.recentWalkieMessages) {
        if (!playedWalkieIdsRef.current.has(msg.id)) {
          playedWalkieIdsRef.current.add(msg.id);
          playedSpecificAlertThisCycle = true;
          const roleLabel = msg.senderRole || 'PLAYER';
          setActiveWalkieSpeaker({
            nickname: msg.senderNickname,
            role: roleLabel,
            disguised: msg.disguised,
          });
          soundEngine.playWalkieTalkieAudio(msg.audioDataUrl, msg.disguised, () => {
            setActiveWalkieSpeaker((prev) =>
              prev && prev.nickname === msg.senderNickname ? null : prev
            );
          });
        }
      }
    }

    // 5. Quick Taunt Soundboard Broadcasts
    if (snapshot.recentTaunts && snapshot.recentTaunts.length > 0) {
      for (const taunt of snapshot.recentTaunts) {
        if (!playedTauntIdsRef.current.has(taunt.id)) {
          playedTauntIdsRef.current.add(taunt.id);
          playedSpecificAlertThisCycle = true;
          const meta = TAUNT_OPTIONS.find((t) => t.type === taunt.tauntType);
          const roleLabel = taunt.senderRole || 'Player';
          soundEngine.playTauntSound(taunt.tauntType);
          showToast(
            `${meta?.emoji || '📣'} [${taunt.senderNickname} - ${roleLabel}]: ${meta?.label || taunt.tauntType}`,
            'warning'
          );
        }
      }
    }

    // 6. Live Notes & Activity Feed Events (seenEventIdsRef + 6s Top Banner + Alert Chime)
    if (snapshot.events && snapshot.events.length > 0) {
      const approxServerNow = Date.now() + serverTimeOffsetRef.current;
      if (seededEventsGameIdRef.current !== snapshot.id) {
        seededEventsGameIdRef.current = snapshot.id;
        for (const evt of snapshot.events) {
          // Seed historical events older than 8s so we don't replay old history on refresh
          if (approxServerNow - evt.createdAt > 8000 || evt.message.startsWith('🏁 Lobby')) {
            seenEventIdsRef.current.add(evt.id);
          }
        }
      }

      let newestUnseenEvent: GameEventItem | null = null;
      for (const evt of snapshot.events) {
        if (!seenEventIdsRef.current.has(evt.id)) {
          seenEventIdsRef.current.add(evt.id);
          newestUnseenEvent = evt;
        }
      }

      if (newestUnseenEvent) {
        triggerEventBanner(newestUnseenEvent);
        if (!playedSpecificAlertThisCycle && newestUnseenEvent.senderId !== activePlayerId) {
          soundEngine.playNoteAlertChime();
        }
      }
    }
  }, [snapshot, activePlayerId, showToast, triggerEventBanner]);

  // Proximity Heartbeat Radar for Hiders when a Hunter is < 40m away
  useEffect(() => {
    if (
      !snapshot ||
      snapshot.state !== 'ACTIVE' ||
      snapshot.viewerRole !== 'HIDER' ||
      !snapshot.hunterProximity?.nearby
    ) {
      return;
    }
    const band = snapshot.hunterProximity.distanceBand === 'CRITICAL' ? 'CRITICAL' : 'NEAR';
    soundEngine.playHeartbeatPulse(band);
    const intervalMs = band === 'CRITICAL' ? 650 : 1250;
    const hbTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        soundEngine.playHeartbeatPulse(band);
      }
    }, intervalMs);
    return () => clearInterval(hbTimer);
  }, [snapshot?.state, snapshot?.viewerRole, snapshot?.hunterProximity?.nearby, snapshot?.hunterProximity?.distanceBand]);

  const handleBrowserGpsDenied = useCallback(
    async (code: string, pid: string, showDeniedToast = true) => {
      gpsDeniedRef.current = true;
      gpsClearGraceUntilRef.current = 0;
      setGpsPermissionDenied(true);
      stopAllGpsTracking();
      setLastGpsError('GPS permission denied by browser');
      if (showDeniedToast) {
        showToast('Location permission denied. Enable location access in your browser settings to play.', 'error');
      }

      setSnapshot((prev) => {
        if (!prev || prev.code !== code) return prev;
        return {
          ...prev,
          viewerGpsConsent: false,
          viewerGpsDenied: true,
          participants: prev.participants.map((p) =>
            p.id === pid ? { ...p, gpsConsent: false, gpsDenied: true, location: null } : p
          ),
        };
      });

      await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'ACTION',
          code: code.trim().toUpperCase(),
          action: 'SET_CONSENT',
          participantId: pid,
          consent: false,
          denied: true,
        }),
      }).catch(() => {});
      fetchGameState(code, pid);
    },
    [stopAllGpsTracking, showToast, fetchGameState]
  );

  const submitGpsCoordsToServer = useCallback(
    async (
      expectedCode: string,
      expectedPlayerId: string,
      expectedGameId: string,
      lat: number,
      lng: number,
      accuracy: number,
      isManualButton = false
    ) => {
      const current = latestStateRef.current;
      if (
        !current.isOnline ||
        !navigator.onLine ||
        current.roomCode !== expectedCode ||
        current.activePlayerId !== expectedPlayerId ||
        !current.snapshot ||
        current.snapshot.id !== expectedGameId
      ) {
        return;
      }

      if (current.snapshot.state !== 'COUNTDOWN' && current.snapshot.state !== 'ACTIVE') return;

      const currentMe = current.snapshot.participants.find((p) => p.id === expectedPlayerId);
      if (!currentMe || currentMe.status !== 'ACTIVE') return;

      const boundedAccuracy = Math.max(1, Math.min(2400, Math.round(accuracy)));

      stateVersionRef.current += 1;
      if (pollAbortControllerRef.current) {
        pollAbortControllerRef.current.abort();
        pollAbortControllerRef.current = null;
      }

      try {
        const res = await fetch('/api/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'LOCATION',
            code: expectedCode.trim().toUpperCase(),
            participantId: expectedPlayerId,
            lat,
            lng,
            accuracy: boundedAccuracy,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit GPS location.');
        lastGpsSubmitAtRef.current = data.updatedAt || Date.now();
        setLastGpsError(null);
        if (data.snapshot) setSnapshot(hydrateSnapshotWithMediaCache(data.snapshot, expectedPlayerId));
        if (data.boundaryCheck?.isOutsideWithGrace) {
          showToast(
            `Warning: You are ${data.boundaryCheck.outsideMeters}m outside the green play boundary!`,
            'warning'
          );
        } else if (isManualButton) {
          showToast(`GPS updated (±${boundedAccuracy}m).`);
        }
      } catch (err: any) {
        setLastGpsError(err?.message || 'GPS submission failed');
        if (isManualButton) showToast(err?.message || 'GPS update failed', 'error');
      }
    },
    [hydrateSnapshotWithMediaCache, showToast]
  );

  const triggerForegroundGpsUpdate = useCallback(
    (isManualButton = false, forceBypassDeniedCheck = false) => {
      const { roomCode: code, activePlayerId: pid, snapshot: snap, isOnline: online } = latestStateRef.current;
      if (!code || !pid || !snap) return;

      const me = snap.participants.find((p) => p.id === pid);
      if (!me) return;

      if (!forceBypassDeniedCheck && (gpsDeniedRef.current || snap.viewerGpsDenied || me.gpsDenied)) {
        stopAllGpsTracking();
        return;
      }

      if (snap.state !== 'COUNTDOWN' && snap.state !== 'ACTIVE') {
        if (isManualButton) showToast('GPS updates are only permitted during countdown or active gameplay.', 'warning');
        return;
      }

      if (me.status !== 'ACTIVE') {
        if (isManualButton) showToast('Captured players do not share live GPS.', 'warning');
        return;
      }
      if (!forceBypassDeniedCheck && !me.gpsConsent) {
        if (isManualButton) showToast('Please allow GPS sharing first.', 'warning');
        return;
      }

      if (!online || !navigator.onLine) {
        setLastGpsError('Offline — waiting for network connection');
        if (isManualButton) showToast('Cannot update GPS while offline.', 'error');
        return;
      }

      const now = Date.now();
      if (!isManualButton && !forceBypassDeniedCheck && now - lastGpsSubmitAtRef.current < 4000) return;

      // If watchPosition already has a fresh high-precision satellite fix (< 8s old), transmit it immediately
      const cachedWatchFix = localGpsFixRef.current;
      if (!isManualButton && cachedWatchFix && now - cachedWatchFix.updatedAt < 8000) {
        clearGpsDeniedImmediately(true);
        submitGpsCoordsToServer(
          snap.code,
          pid,
          snap.id,
          cachedWatchFix.lat,
          cachedWatchFix.lng,
          cachedWatchFix.accuracy,
          false
        );
        return;
      }

      if (gpsInFlightRef.current) {
        if (isManualButton) showToast('Acquiring GPS signal...', 'info');
        return;
      }

      if (!navigator.geolocation) {
        setLastGpsError('Geolocation API not supported on this device');
        if (isManualButton) showToast('Geolocation is not supported by this browser.', 'error');
        return;
      }

      const expectedGameId = snap.id;
      const expectedCode = snap.code;
      const expectedPlayerId = pid;
      const reqSeq = ++gpsRequestSeqRef.current;
      gpsInFlightRef.current = true;
      setGpsInFlight(true);

      const handlePositionSuccess = async (pos: GeolocationPosition) => {
        if (reqSeq !== gpsRequestSeqRef.current) return;
        gpsInFlightRef.current = false;
        setGpsInFlight(false);

        // Immediately clear any permission denied state on valid GPS reading
        clearGpsDeniedImmediately(true);

        const coords = pos?.coords;
        if (
          !coords ||
          !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude) ||
          !Number.isFinite(coords.accuracy) ||
          coords.accuracy <= 0
        ) {
          setLastGpsError('Device returned an invalid GPS reading');
          return;
        }

        const fix = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: Math.max(1, Math.round(coords.accuracy)),
          updatedAt: Date.now(),
        };
        localGpsFixRef.current = fix;
        setLocalGpsFix(fix);

        await submitGpsCoordsToServer(
          expectedCode,
          expectedPlayerId,
          expectedGameId,
          coords.latitude,
          coords.longitude,
          coords.accuracy,
          isManualButton
        );
      };

      const handleFinalError = async (err: GeolocationPositionError) => {
        if (reqSeq !== gpsRequestSeqRef.current) return;
        gpsInFlightRef.current = false;
        setGpsInFlight(false);

        const current = latestStateRef.current;
        if (
          current.roomCode !== expectedCode ||
          current.activePlayerId !== expectedPlayerId ||
          !current.snapshot ||
          current.snapshot.id !== expectedGameId
        ) {
          return;
        }

        // Strictly separate permission denial (code 1 + confirmed 'denied' in Permissions API) from GPS signal/timeout errors
        if (err && err.code === 1) {
          let confirmedDenied = true;
          if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
            try {
              const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
              confirmedDenied = perm.state === 'denied';
              if (perm.state === 'granted') {
                clearGpsDeniedImmediately(true);
              }
            } catch {}
          }
          if (confirmedDenied) {
            await handleBrowserGpsDenied(expectedCode, expectedPlayerId);
            return;
          }
        }

        if (err && err.code === 3) {
          setLastGpsError('Searching for GPS satellite lock...');
          if (isManualButton) showToast('GPS timed out. Move to an open outdoor area and tap Update GPS.', 'warning');
        } else {
          setLastGpsError('Weak GPS signal — move outdoors for stronger lock');
          if (isManualButton) showToast('Weak GPS signal. Move outdoors for a clearer satellite view.', 'warning');
        }
      };

      // Step 1: High Accuracy satellite lock first (10s timeout, 3s maximumAge)
      navigator.geolocation.getCurrentPosition(
        handlePositionSuccess,
        async (highAccErr) => {
          if (reqSeq !== gpsRequestSeqRef.current) return;

          // Automatic fallback to network/Wi-Fi positioning (enableHighAccuracy: false) only if satellite lock fails with code 2 or 3
          if (highAccErr && (highAccErr.code === 2 || highAccErr.code === 3)) {
            navigator.geolocation.getCurrentPosition(
              handlePositionSuccess,
              handleFinalError,
              { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
            );
            return;
          }

          if (highAccErr && highAccErr.code === 1 && navigator.permissions?.query) {
            try {
              const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
              if (perm.state !== 'denied') {
                clearGpsDeniedImmediately(true);
                navigator.geolocation.getCurrentPosition(
                  handlePositionSuccess,
                  handleFinalError,
                  { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
                );
                return;
              }
            } catch {}
          }

          await handleFinalError(highAccErr);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
      );
    },
    [clearGpsDeniedImmediately, handleBrowserGpsDenied, showToast, stopAllGpsTracking, submitGpsCoordsToServer]
  );

  // Live Geolocation Permission State Watcher via navigator.permissions.query({ name: 'geolocation' })
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let permStatus: PermissionStatus | null = null;
    let isMounted = true;

    const applyPermissionState = (state: PermissionState, isChangeEvent: boolean) => {
      if (!isMounted) return;
      const { roomCode: code, activePlayerId: pid, snapshot: snap } = latestStateRef.current;

      if (state === 'granted') {
        const wasDenied = Boolean(gpsDeniedRef.current || snap?.viewerGpsDenied);
        // Immediately clear permission denied state & enable Update GPS before waiting for coordinates
        clearGpsDeniedImmediately(true);
        if (code && pid && (wasDenied || isChangeEvent)) {
          fetch('/api/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              op: 'ACTION',
              code: code.trim().toUpperCase(),
              action: 'SET_CONSENT',
              participantId: pid,
              consent: true,
              denied: false,
            }),
          })
            .then(() => {
              triggerForegroundGpsUpdate(false, true);
            })
            .catch(() => {});
          if (wasDenied || isChangeEvent) {
            showToast('Browser GPS permission granted! Resuming live location updates.');
          }
        }
      } else if (state === 'prompt') {
        gpsDeniedRef.current = false;
        setGpsPermissionDenied(false);
        setLastGpsError(null);
      } else if (state === 'denied') {
        if (code && pid && snap && !gpsDeniedRef.current) {
          handleBrowserGpsDenied(code, pid, false);
        } else {
          gpsDeniedRef.current = true;
          setGpsPermissionDenied(true);
          stopAllGpsTracking();
        }
      }
    };

    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!isMounted) return;
        permStatus = status;
        applyPermissionState(status.state, false);
        permStatus.onchange = () => {
          if (permStatus) applyPermissionState(permStatus.state, true);
        };
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      if (permStatus) {
        permStatus.onchange = null;
      }
    };
  }, [clearGpsDeniedImmediately, handleBrowserGpsDenied, stopAllGpsTracking, triggerForegroundGpsUpdate, showToast]);

  // Real Mobile GPS Precision: Continuous watchPosition + Periodic Server Sync
  useEffect(() => {
    if (!roomCode || !activePlayerId || !snapshot) {
      stopAllGpsTracking();
      return;
    }
    const me = snapshot.participants.find((p) => p.id === activePlayerId);
    const isDenied = Boolean(gpsPermissionDenied || gpsDeniedRef.current || snapshot.viewerGpsDenied || me?.gpsDenied);
    const eligible =
      (snapshot.state === 'COUNTDOWN' || snapshot.state === 'ACTIVE') &&
      me &&
      me.status === 'ACTIVE' &&
      me.gpsConsent &&
      !isDenied;

    if (!eligible) {
      stopAllGpsTracking();
      return;
    }

    const expectedGameId = snapshot.id;
    const expectedCode = snapshot.code;
    const expectedPlayerId = activePlayerId;

    // 1. Start continuous high-accuracy watchPosition on mobile/browser
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      if (gpsWatchIdRef.current !== null) {
        try {
          navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        } catch {}
        gpsWatchIdRef.current = null;
      }

      const onWatchSuccess = (pos: GeolocationPosition) => {
        const coords = pos?.coords;
        if (
          !coords ||
          !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude) ||
          !Number.isFinite(coords.accuracy) ||
          coords.accuracy <= 0
        ) {
          return;
        }
        clearGpsDeniedImmediately(true);
        const now = Date.now();
        const fix = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: Math.max(1, Math.round(coords.accuracy)),
          updatedAt: now,
        };
        localGpsFixRef.current = fix;
        setLocalGpsFix(fix);
        setLastGpsError(null);

        const intervalMs = (latestStateRef.current.snapshot?.settings.gpsIntervalSeconds || GPS_UPDATE_INTERVAL_SECONDS) * 1000;
        const hasServerLoc = Boolean(
          latestStateRef.current.snapshot?.participants.find((p) => p.id === expectedPlayerId)?.location
        );
        // Immediately sync to server if player has no location yet or if the room's GPS interval has elapsed
        if (!hasServerLoc || now - lastGpsSubmitAtRef.current >= intervalMs - 1000) {
          submitGpsCoordsToServer(
            expectedCode,
            expectedPlayerId,
            expectedGameId,
            coords.latitude,
            coords.longitude,
            coords.accuracy,
            false
          );
        }
      };

      const onWatchError = (err: GeolocationPositionError) => {
        if (err && (err.code === 2 || err.code === 3)) {
          // Fallback watcher with enableHighAccuracy: false if high-accuracy satellite lock fails
          if (gpsWatchIdRef.current !== null) {
            try {
              navigator.geolocation.clearWatch(gpsWatchIdRef.current);
            } catch {}
          }
          try {
            gpsWatchIdRef.current = navigator.geolocation.watchPosition(
              onWatchSuccess,
              () => {},
              { enableHighAccuracy: false, maximumAge: 15000, timeout: 10000 }
            );
          } catch {}
        }
      };

      try {
        gpsWatchIdRef.current = navigator.geolocation.watchPosition(
          onWatchSuccess,
          onWatchError,
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
      } catch {}
    }

    if (!me.location) triggerForegroundGpsUpdate(false);

    // 2. Periodic server sync timer according to room's gpsIntervalSeconds
    const intervalMs = (snapshot.settings.gpsIntervalSeconds || GPS_UPDATE_INTERVAL_SECONDS) * 1000;
    if (gpsIntervalRef.current !== null) {
      clearInterval(gpsIntervalRef.current);
    }
    gpsIntervalRef.current = setInterval(() => {
      if (gpsDeniedRef.current) {
        stopAllGpsTracking();
        return;
      }
      if (document.visibilityState === 'visible') triggerForegroundGpsUpdate(false);
    }, intervalMs);

    const onVisChange = () => {
      if (gpsDeniedRef.current) return;
      if (document.visibilityState === 'visible') triggerForegroundGpsUpdate(false);
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      if (gpsIntervalRef.current !== null) {
        clearInterval(gpsIntervalRef.current);
        gpsIntervalRef.current = null;
      }
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        } catch {}
        gpsWatchIdRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [
    roomCode,
    activePlayerId,
    snapshot?.id,
    snapshot?.state,
    snapshot?.viewerGpsConsent,
    snapshot?.viewerGpsDenied,
    snapshot?.settings.gpsIntervalSeconds,
    gpsPermissionDenied,
    clearGpsDeniedImmediately,
    stopAllGpsTracking,
    submitGpsCoordsToServer,
    triggerForegroundGpsUpdate,
  ]);

  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault();
    if (isCreatingLobby) return;
    setCreateError(null);
    const cleanNick = createNickname.trim();
    if (cleanNick.length < 3 || cleanNick.length > 15) {
      const msg = 'Nickname must be between 3 and 15 characters.';
      setCreateError(msg);
      showToast(msg, 'error');
      return;
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('aui_manhunt_last_nick', cleanNick);
    }
    setIsCreatingLobby(true);
    stateVersionRef.current += 1;
    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort();
      pollAbortControllerRef.current = null;
    }
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'CREATE',
          hostNickname: cleanNick,
          title: createTitle.trim() || 'Campus Night Hunt',
          hunterCount: createHunters,
          durationMinutes: createDuration,
          countdownSeconds: createCountdown,
          gpsIntervalSeconds: createGpsInterval,
          soundUses: createSoundUses,
          soundCooldownSeconds: createSoundCooldown,
          photoRequestsPerHider: createPhotoLimit,
          ghostCloakUsesPerHider: createGhostCloakUses,
          walkieTalkieEnabled: createWalkieEnabled,
          hunterVisibilityMode: createHunterVisMode,
          catchVerificationMode: createCatchMode,
          outOfBoundsGraceSeconds: createGracePeriod,
          teammateVisibility: createTeammateVis,
          shrinkingZone: createShrinkingZone,
          boundary: setupBoundary,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create game.');

      clearGpsDeniedImmediately(false);
      lastServerTimeRef.current = data.snapshot?.serverTime || 0;
      photoCacheRef.current.clear();
      seenEventIdsRef.current.clear();
      seededEventsGameIdRef.current = null;
      setRoomCode(data.code);
      setActivePlayerId(data.participantId);
      setKnownPlayerIds([data.participantId]);
      setSnapshot(data.snapshot ? hydrateSnapshotWithMediaCache(data.snapshot, data.participantId) : null);
      setDismissedRoleForPlayers({});
      setLastGpsError(null);
      showToast(`Room ${data.code} created! Share the code or invite link with your friends.`);
    } catch (err: any) {
      const errMsg = err?.message || 'Network error while creating lobby. Please try again.';
      setCreateError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setIsCreatingLobby(false);
    }
  }

  async function handleJoinGame(e: React.FormEvent) {
    e.preventDefault();
    if (isJoiningLobby) return;
    setJoinError(null);
    const cleanCode = joinCodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanNick = joinNicknameInput.trim();
    if (cleanCode.length !== 6) {
      const msg = 'Please enter a valid 6-character room code.';
      setJoinError(msg);
      showToast(msg, 'error');
      return;
    }
    if (cleanNick.length < 3 || cleanNick.length > 15) {
      const msg = 'Nickname must be between 3 and 15 characters.';
      setJoinError(msg);
      showToast(msg, 'error');
      return;
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('aui_manhunt_last_nick', cleanNick);
    }
    setIsJoiningLobby(true);
    stateVersionRef.current += 1;
    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort();
      pollAbortControllerRef.current = null;
    }
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'JOIN',
          code: cleanCode,
          nickname: cleanNick,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not join game lobby.');

      gpsDeniedRef.current = false;
      setGpsPermissionDenied(false);
      lastServerTimeRef.current = data.snapshot?.serverTime || 0;
      photoCacheRef.current.clear();
      seenEventIdsRef.current.clear();
      seededEventsGameIdRef.current = null;
      setRoomCode(data.code);
      setActivePlayerId(data.participantId);
      setKnownPlayerIds([data.participantId]);
      setSnapshot(data.snapshot ? hydrateSnapshotWithMediaCache(data.snapshot, data.participantId) : null);
      setDismissedRoleForPlayers({});
      setLastGpsError(null);
      setJoinError(null);
      showToast(`Joined room ${data.code}! Mark yourself Ready when you are set.`);
    } catch (err: any) {
      const errMsg = err?.message || 'Could not join room. Check your connection and the 6-character code.';
      setJoinError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setIsJoiningLobby(false);
    }
  }

  async function dispatchGameAction(
    payload: Record<string, unknown>,
    successToast?: string,
    actionKeyOverride?: string
  ) {
    if (!roomCode || !activePlayerId) return null;
    const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const actionType = String(payload.action || '');
    const key = actionKeyOverride || actionType;

    // Increment request version & abort any in-flight GET poll so stale responses never overwrite newer state
    stateVersionRef.current += 1;
    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort();
      pollAbortControllerRef.current = null;
    }

    // 1. Capture previous snapshot for rollback and apply 0ms Optimistic UI update immediately
    const previousSnapshot = snapshot;
    setSnapshot((prev) => {
      if (!prev) return prev;
      switch (actionType) {
        case 'TOGGLE_READY': {
          return {
            ...prev,
            participants: prev.participants.map((p) =>
              p.id === activePlayerId ? { ...p, ready: !p.ready } : p
            ),
          };
        }
        case 'UPDATE_RULES': {
          const nextSettings = { ...prev.settings };
          if (payload.hunterCount !== undefined) nextSettings.hunterCount = Number(payload.hunterCount);
          if (payload.durationMinutes !== undefined) nextSettings.durationMinutes = Number(payload.durationMinutes);
          if (payload.countdownSeconds !== undefined) nextSettings.countdownSeconds = Number(payload.countdownSeconds);
          if (payload.gpsIntervalSeconds !== undefined) nextSettings.gpsIntervalSeconds = Number(payload.gpsIntervalSeconds);
          if (payload.ghostCloakUsesPerHider !== undefined) nextSettings.ghostCloakUsesPerHider = Number(payload.ghostCloakUsesPerHider);
          if (payload.walkieTalkieEnabled !== undefined) nextSettings.walkieTalkieEnabled = Boolean(payload.walkieTalkieEnabled);
          if (payload.hunterVisibilityMode !== undefined) nextSettings.hunterVisibilityMode = payload.hunterVisibilityMode as HunterVisibilityMode;
          if (payload.catchVerificationMode !== undefined) nextSettings.catchVerificationMode = payload.catchVerificationMode as CatchVerificationMode;
          if (payload.outOfBoundsGraceSeconds !== undefined) nextSettings.outOfBoundsGraceSeconds = Number(payload.outOfBoundsGraceSeconds);
          if (payload.teammateVisibility !== undefined) nextSettings.teammateVisibility = payload.teammateVisibility as TeammateVisibilityMode;
          if (payload.shrinkingZone !== undefined) nextSettings.shrinkingZone = Boolean(payload.shrinkingZone);
          if (payload.photoRequestsPerHider !== undefined) nextSettings.photoRequestsPerHider = Number(payload.photoRequestsPerHider);
          return { ...prev, settings: nextSettings };
        }
        case 'ACTIVATE_GHOST_CLOAK': {
          const maxUses = prev.viewerGhostCloak?.maxUses ?? (prev.settings.ghostCloakUsesPerHider ?? 1);
          const usedCount = (prev.viewerGhostCloak?.usedCount ?? 0) + 1;
          const remainingUses = Math.max(0, maxUses - usedCount);
          return {
            ...prev,
            viewerGhostCloak: {
              used: remainingUses <= 0,
              usedCount,
              maxUses,
              remainingUses,
              active: true,
              secondsLeft: 60,
            },
            participants: prev.participants.map((p) =>
              p.id === activePlayerId
                ? { ...p, ghostCloakActive: true, ghostCloakSecondsLeft: 60 }
                : p
            ),
          };
        }
        case 'MARK_CAUGHT': {
          const targetId = String(payload.targetHiderId || '');
          const isSelf = targetId === activePlayerId;
          const actorNick =
            prev.participants.find((p) => p.id === activePlayerId)?.nickname || 'Hunter';
          return {
            ...prev,
            activeHiders: Math.max(0, prev.activeHiders - 1),
            capturedHiders: prev.capturedHiders + 1,
            participants: prev.participants.map((p) => {
              if (p.id === targetId) {
                return {
                  ...p,
                  status: 'CAPTURED',
                  capturedByNickname: isSelf ? 'Self-reported' : actorNick,
                  location: null,
                };
              }
              if (!isSelf && p.id === activePlayerId) {
                return { ...p, capturesCount: (p.capturesCount || 0) + 1 };
              }
              return p;
            }),
          };
        }
        case 'SEND_TAUNT': {
          return { ...prev, tauntCooldownSecondsLeft: 15 };
        }
        case 'SEND_NOTE': {
          const senderMe = prev.participants.find((p) => p.id === activePlayerId);
          const optimisticId = `opt-note-${Date.now()}`;
          seenEventIdsRef.current.add(optimisticId);
          const optimisticEvt: GameEventItem = {
            id: optimisticId,
            type: 'NOTE',
            senderId: activePlayerId,
            senderName: senderMe?.nickname || 'You',
            senderRole: prev.viewerRole || senderMe?.role || null,
            message: String(payload.message || ''),
            createdAt: Date.now() + serverTimeOffsetRef.current,
          };
          return {
            ...prev,
            events: [...(prev.events || []).slice(-29), optimisticEvt],
          };
        }
        case 'SET_CONSENT': {
          const consent = Boolean(payload.consent);
          const denied = Boolean(payload.denied);
          return {
            ...prev,
            viewerGpsConsent: consent,
            viewerGpsDenied: denied,
            participants: prev.participants.map((p) =>
              p.id === activePlayerId ? { ...p, gpsConsent: consent, gpsDenied: denied } : p
            ),
          };
        }
        case 'UNLOCK_AUDIO': {
          return {
            ...prev,
            viewerAudioUnlocked: true,
            participants: prev.participants.map((p) =>
              p.id === activePlayerId ? { ...p, audioUnlocked: true } : p
            ),
          };
        }
        case 'TOGGLE_PAUSE': {
          return {
            ...prev,
            state: prev.state === 'PAUSED' ? 'ACTIVE' : 'PAUSED',
          };
        }
        default:
          return prev;
      }
    });

    actionInFlightCountRef.current += 1;
    setPendingActionKey(key);

    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'ACTION',
          code: cleanCode,
          participantId: activePlayerId,
          ...payload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed.');
      if (data.eventId) {
        seenEventIdsRef.current.add(String(data.eventId));
      }
      if (data.snapshot) {
        setSnapshot(hydrateSnapshotWithMediaCache(data.snapshot, activePlayerId));
      }
      if (successToast) showToast(successToast);
      return data;
    } catch (err: any) {
      if (previousSnapshot) {
        setSnapshot(previousSnapshot);
      }
      showToast(err?.message || 'Action failed', 'error');
      return null;
    } finally {
      actionInFlightCountRef.current = Math.max(0, actionInFlightCountRef.current - 1);
      setPendingActionKey((curr) => (curr === key ? null : curr));
    }
  }

  async function handleSendNote(presetOrCustomText?: string) {
    const rawText = (presetOrCustomText !== undefined ? presetOrCustomText : noteInput).trim();
    if (!rawText) {
      showToast('Please enter a note message first.', 'warning');
      return;
    }
    if (presetOrCustomText === undefined) {
      setNoteInput('');
    }
    setSoundUnlockedLocal(true);
    soundEngine.playNoteAlertChime();
    const res = await dispatchGameAction(
      { action: 'SEND_NOTE', message: rawText },
      `🔔 Live note broadcast to all players: "${rawText}"`,
      'SEND_NOTE'
    );
    if (res?.eventId && snapshot) {
      const mePart = snapshot.participants.find((p) => p.id === activePlayerId);
      triggerEventBanner({
        id: String(res.eventId),
        type: 'NOTE',
        senderId: activePlayerId,
        senderName: mePart?.nickname || 'You',
        senderRole: snapshot.viewerRole || mePart?.role || null,
        message: rawText,
        createdAt: Date.now(),
      });
    }
  }

  async function handleHostStartGame() {
    if (!roomCode || !activePlayerId || !snapshot) return;
    if (snapshot.hostId !== snapshot.viewerId) {
      showToast('Only the room host can start the game.', 'error');
      return;
    }
    if (snapshot.participants.some((p) => !p.ready)) {
      showToast('All players must be Ready before starting the game.', 'warning');
      return;
    }
    const data = await dispatchGameAction({ action: 'START_GAME' });
    if (!data) return;

    setDismissedRoleForPlayers({});
  }

  function handleUnlockAudio() {
    const ok = soundEngine.unlockAndPlayActivationChime();
    if (ok) {
      setSoundUnlockedLocal(true);
      dispatchGameAction({ action: 'UNLOCK_AUDIO' }, 'Sound Active 🔊 — Activation chime played!');
    } else {
      showToast('Browser blocked audio initialization. Check silent mode switch.', 'error');
    }
  }

  function handleTestSound() {
    const ok = soundEngine.unlockAndPlayActivationChime();
    if (ok) {
      setSoundUnlockedLocal(true);
      if (!snapshot?.viewerAudioUnlocked) {
        dispatchGameAction({ action: 'UNLOCK_AUDIO' });
      }
      showToast('🔊 Test chime played! Your device audio is working.', 'info');
    } else {
      showToast('Could not play test sound. Check device volume / mute switch.', 'error');
    }
  }

  function cleanupWalkieRecorder() {
    if (walkieMaxTimerRef.current) {
      clearTimeout(walkieMaxTimerRef.current);
      walkieMaxTimerRef.current = null;
    }
    if (walkieTickTimerRef.current) {
      clearInterval(walkieTickTimerRef.current);
      walkieTickTimerRef.current = null;
    }
    if (walkieStreamRef.current) {
      walkieStreamRef.current.getTracks().forEach((t) => t.stop());
      walkieStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setWalkieRecording(false);
    setWalkieRecordingSeconds(0);
  }

  async function startWalkieTalkieRecording() {
    if (walkieRecording) return;
    if (snapshot?.settings.walkieTalkieEnabled === false) {
      showToast('Walkie-Talkie radio is disabled by the host.', 'warning');
      return;
    }
    setSoundUnlockedLocal(true);
    soundEngine.playRadioSquelch('START');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      // Fallback synthesized radio transmission when mic hardware/API is unavailable
      const res = await dispatchGameAction(
        {
          action: 'SEND_WALKIE_TALKIE',
          audioDataUrl: 'SYNTH_VOICE',
          disguised: walkieDisguised,
          durationSeconds: 2,
        },
        '📻 Walkie-Talkie radio transmission sent!'
      );
      if (res?.messageId) {
        playedWalkieIdsRef.current.add(res.messageId);
        soundEngine.playWalkieAudioMessage('SYNTH_VOICE', walkieDisguised);
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      walkieStreamRef.current = stream;
      walkieChunksRef.current = [];
      walkieStartMsRef.current = Date.now();

      let options: MediaRecorderOptions = { audioBitsPerSecond: 24000 };
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 };
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          options = { mimeType: 'audio/mp4', audioBitsPerSecond: 24000 };
        }
      }

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          walkieChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const durSec = Math.max(0.6, Math.min(6, (Date.now() - walkieStartMsRef.current) / 1000));
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(walkieChunksRef.current, { type: mimeType });
        cleanupWalkieRecorder();

        if (blob.size < 100) {
          return;
        }
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Url = typeof reader.result === 'string' ? reader.result : '';
          if (!base64Url) return;
          const res = await dispatchGameAction(
            {
              action: 'SEND_WALKIE_TALKIE',
              audioDataUrl: base64Url,
              disguised: walkieDisguised,
              durationSeconds: Number(durSec.toFixed(1)),
            },
            `📻 Walkie-Talkie voice clip (${durSec.toFixed(1)}s) broadcast to all players!`
          );
          if (res?.messageId) {
            playedWalkieIdsRef.current.add(res.messageId);
            soundEngine.playRadioSquelch('END');
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(200);
      setWalkieRecording(true);
      setWalkieRecordingSeconds(0);

      walkieTickTimerRef.current = setInterval(() => {
        const elapsed = Math.min(6, Math.floor((Date.now() - walkieStartMsRef.current) / 1000));
        setWalkieRecordingSeconds(elapsed);
      }, 250);

      walkieMaxTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 6000);
    } catch {
      cleanupWalkieRecorder();
      // Fallback synthesized radio voice clip if microphone permission was blocked
      const res = await dispatchGameAction(
        {
          action: 'SEND_WALKIE_TALKIE',
          audioDataUrl: 'SYNTH_VOICE',
          disguised: walkieDisguised,
          durationSeconds: 2,
        },
        '📻 Microphone unavailable — sent synthesized Walkie-Talkie radio signal!'
      );
      if (res?.messageId) {
        playedWalkieIdsRef.current.add(res.messageId);
        soundEngine.playWalkieAudioMessage('SYNTH_VOICE', walkieDisguised);
      }
    }
  }

  function stopWalkieTalkieRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupWalkieRecorder();
    }
  }

  async function handleSendSilentRadioTTS(calloutText?: string) {
    const textToSend = (calloutText || silentRadioInput).trim();
    if (!textToSend) return;
    setSilentRadioInput('');
    setSoundUnlockedLocal(true);
    const res = await dispatchGameAction(
      {
        action: 'SEND_WALKIE_TALKIE',
        voiceText: textToSend,
        disguised: walkieDisguised,
        durationSeconds: 3,
      },
      `📻 Silent Radio Callout sent: "${textToSend}"`
    );
    if (res?.messageId) {
      playedWalkieIdsRef.current.add(res.messageId);
      soundEngine.playSilentRadioTTS(textToSend, walkieDisguised);
    }
  }

  const handleReplayLastRadioMessage = useCallback(async () => {
    if (!snapshot?.latestVoiceClip) {
      showToast('No radio messages received yet in this match.', 'info');
      return;
    }
    const clip = snapshot.latestVoiceClip;
    setSoundUnlockedLocal(true);
    const roleLabel = clip.senderRole || 'PLAYER';
    setActiveWalkieSpeaker({
      nickname: clip.senderNickname,
      role: roleLabel,
      disguised: clip.disguised,
    });
    const onEnd = () => {
      setActiveWalkieSpeaker((prev) =>
        prev && prev.nickname === clip.senderNickname ? null : prev
      );
    };
    if (clip.audioDataUrl) {
      await soundEngine.playWalkieTalkieAudio(clip.audioDataUrl, clip.disguised, onEnd);
    } else if (clip.voiceText) {
      await soundEngine.playSilentRadioTTS(clip.voiceText, clip.disguised, onEnd);
    }
  }, [snapshot?.latestVoiceClip, showToast]);

  async function handleSendTaunt(tauntType: TauntType) {
    if ((snapshot?.tauntCooldownSecondsLeft || 0) > 0) {
      showToast(`Quick Taunt on cooldown (${snapshot?.tauntCooldownSecondsLeft}s left).`, 'warning');
      return;
    }
    setSoundUnlockedLocal(true);
    // Play taunt sound locally at 0ms immediately on click
    soundEngine.playTauntSound(tauntType);
    const meta = TAUNT_OPTIONS.find((t) => t.type === tauntType);
    const res = await dispatchGameAction(
      { action: 'SEND_TAUNT', tauntType },
      `${meta?.emoji || '📣'} Broadcast taunt: "${meta?.label || tauntType}"!`,
      `TAUNT_${tauntType}`
    );
    if (res?.tauntId) {
      playedTauntIdsRef.current.add(res.tauntId);
    }
  }

  function handleLeaveGame() {
    stopAllGpsTracking();
    stopCameraStream();
    cleanupWalkieRecorder();
    wakeLockManager.release();
    if (roomCode && activePlayerId) {
      fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'ACTION',
          code: roomCode.trim().toUpperCase(),
          action: 'SET_CONSENT',
          participantId: activePlayerId,
          consent: false,
        }),
      }).catch(() => {});
    }
    try {
      window.sessionStorage.removeItem(TAB_SESSION_STORAGE_KEY);
    } catch {}
    gpsDeniedRef.current = false;
    setGpsPermissionDenied(false);
    localGpsFixRef.current = null;
    setLocalGpsFix(null);
    lastServerTimeRef.current = 0;
    photoCacheRef.current.clear();
    seenEventIdsRef.current.clear();
    seededEventsGameIdRef.current = null;
    setActiveEventBanner(null);
    setPendingCaptureTarget(null);
    setShowCameraModal(false);
    setViewerPhotoModal(null);
    setRoomCode(null);
    setActivePlayerId(null);
    setSnapshot(null);
    setKnownPlayerIds([]);
    setScreen('HOME');
    showToast('Left game and stopped sharing GPS.');
  }

  function stopCameraStream() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setCameraStreamActive(false);
  }

  async function startBrowserCamera() {
    setCameraStreamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStreamActive(false);
      setCameraStreamError('Direct camera stream is unavailable on this browser. Please use the Phone Camera / File button above.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      mediaStreamRef.current = stream;
      setCameraStreamActive(true);
      setCapturedPhotoUrl(null);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      stopCameraStream();
      setCameraStreamError('Live camera stream blocked or unsupported. Use the "Open Phone Camera" button above instead.');
    }
  }

  function snapCameraFrame() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const maxDim = 960;
    let outW = width;
    let outH = height;
    if (outW > maxDim || outH > maxDim) {
      if (outW >= outH) {
        outH = Math.round((outH * maxDim) / outW);
        outW = maxDim;
      } else {
        outW = Math.round((outW * maxDim) / outH);
        outH = maxDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, outW, outH);
      setCapturedPhotoUrl(canvas.toDataURL('image/jpeg', 0.78));
    }
    stopCameraStream();
  }

  async function handlePhotoFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('Image file is too large (max 15 MB).', 'error');
      return;
    }
    try {
      setPhotoCompressing(true);
      setCameraStreamError(null);
      stopCameraStream();
      const compressedDataUrl = await compressImageFileToDataUrl(file, 960, 0.78);
      setCapturedPhotoUrl(compressedDataUrl);
    } catch {
      showToast('Failed to process selected photo.', 'error');
    } finally {
      setPhotoCompressing(false);
    }
  }

  async function submitCapturedPhoto() {
    if (!capturedPhotoUrl) return;
    const res = await dispatchGameAction(
      { action: 'RESPOND_PHOTO', photoDataUrl: capturedPhotoUrl, declined: false },
      'Photo submitted privately to the Hunters!'
    );
    if (res) {
      stopCameraStream();
      setCapturedPhotoUrl(null);
      setShowCameraModal(false);
    }
  }

  async function declinePhotoRequest() {
    const res = await dispatchGameAction({ action: 'RESPOND_PHOTO', declined: true }, 'Photo request declined.');
    if (res) {
      stopCameraStream();
      setCapturedPhotoUrl(null);
      setShowCameraModal(false);
    }
  }

  const me = snapshot?.participants.find((p) => p.id === activePlayerId) || null;
  const isHost = Boolean(snapshot && activePlayerId && snapshot.hostId === activePlayerId);
  const isHunter = snapshot?.viewerRole === 'HUNTER';
  const isGpsDenied = Boolean(gpsPermissionDenied || snapshot?.viewerGpsDenied || me?.gpsDenied);
  const isGpsActiveAndConsented = Boolean(snapshot?.viewerGpsConsent && !isGpsDenied);
  const isSoundActive = Boolean(soundUnlockedLocal || snapshot?.viewerAudioUnlocked);
  const isHidingCountdown = snapshot?.state === 'COUNTDOWN';
  const isHunterMapLocked = Boolean(isHunter && isHidingCountdown);
  const unifiedGpsIntervalSec = snapshot?.settings.gpsIntervalSeconds || GPS_UPDATE_INTERVAL_SECONDS;
  const effectiveGpsAccuracy = me?.location?.accuracy ?? localGpsFix?.accuracy ?? null;
  const effectiveGpsStale = Boolean(me?.location?.isStale);

  // Mathematical distance check between player location and green circle center
  const myDistanceFromCenterMeters =
    me?.location && snapshot
      ? Math.round(
          calculateDistanceMeters(
            me.location.lat,
            me.location.lng,
            snapshot.settings.boundary.lat,
            snapshot.settings.boundary.lng
          )
        )
      : null;

  const isPlayerOutsideBoundary = Boolean(
    me?.location &&
      snapshot &&
      (me.location.isOutside ||
        (myDistanceFromCenterMeters !== null && myDistanceFromCenterMeters > snapshot.settings.boundary.radiusMeters))
  );

  const outsideBoundaryMeters =
    me?.location && snapshot && myDistanceFromCenterMeters !== null
      ? Math.max(
          me.location.outsideMeters || 0,
          Math.max(1, myDistanceFromCenterMeters - snapshot.settings.boundary.radiusMeters)
        )
      : me?.location?.outsideMeters || 0;

  const mapMarkers: MapParticipantMarker[] = useMemo(() => {
    if (!snapshot || isHunterMapLocked) return [];
    return snapshot.participants
      .filter((p) => p.location !== null && (p.id === activePlayerId || snapshot.state !== 'COUNTDOWN'))
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        role: p.role,
        isSelf: p.id === activePlayerId,
        lat: p.location!.lat,
        lng: p.location!.lng,
        accuracy: p.location!.accuracy,
        ageSeconds: p.location!.ageSeconds,
        isStale: p.location!.isStale,
      }));
  }, [snapshot?.participants, snapshot?.state, isHunterMapLocked, activePlayerId]);

  const gameplayBoundary = useMemo(
    () =>
      snapshot?.settings.boundary || {
        lat: AUI_CAMPUS_PRESETS.main.lat,
        lng: AUI_CAMPUS_PRESETS.main.lng,
        radiusMeters: AUI_CAMPUS_PRESETS.main.radiusMeters,
      },
    [
      snapshot?.settings.boundary?.lat,
      snapshot?.settings.boundary?.lng,
      snapshot?.settings.boundary?.radiusMeters,
    ]
  );

  const readyPlayersCount = snapshot ? snapshot.participants.filter((p) => p.ready).length : 0;
  const allPlayersReady = Boolean(
    snapshot && snapshot.participants.length >= 2 && snapshot.participants.every((p) => p.ready)
  );
  const hunterCountConflict = Boolean(
    snapshot && snapshot.participants.length >= 2 && snapshot.settings.hunterCount >= snapshot.participants.length
  );
  const canHostStartGame = Boolean(
    isHost &&
      snapshot?.state === 'LOBBY' &&
      snapshot.participants.length >= 2 &&
      allPlayersReady &&
      !hunterCountConflict
  );

  const catchMode = snapshot?.settings.catchVerificationMode || 'PROXIMITY_20M';

  const pendingCaptureDistanceMeters =
    pendingCaptureTarget && me?.location && pendingCaptureTarget.location
      ? Math.round(
          calculateDistanceMeters(
            me.location.lat,
            me.location.lng,
            pendingCaptureTarget.location.lat,
            pendingCaptureTarget.location.lng
          )
        )
      : null;

  const isPendingCaptureTooFar = Boolean(
    pendingCaptureTarget &&
      isHunter &&
      catchMode === 'PROXIMITY_20M' &&
      pendingCaptureTarget.id !== activePlayerId &&
      pendingCaptureDistanceMeters !== null &&
      pendingCaptureDistanceMeters > MAX_CAPTURE_DISTANCE_METERS
  );

  const nearestTargetInfo = useMemo(() => {
    if (!snapshot || snapshot.state !== 'ACTIVE') return null;
    const myLoc = me?.location || localGpsFix;
    if (!myLoc) return { label: '🧭 Waiting for GPS...', tone: 'neutral' as const };

    if (isHunter) {
      const activeHiders = snapshot.participants.filter(
        (p) => p.role === 'HIDER' && p.status === 'ACTIVE' && p.location && !p.ghostCloakActive
      );
      if (activeHiders.length === 0) {
        return { label: '🧭 All Hiders Hidden', tone: 'neutral' as const };
      }
      let minDistance = Infinity;
      let closestHider: ParticipantView | null = null;
      for (const h of activeHiders) {
        const d = calculateDistanceMeters(myLoc.lat, myLoc.lng, h.location!.lat, h.location!.lng);
        if (d < minDistance) {
          minDistance = d;
          closestHider = h;
        }
      }
      if (closestHider) {
        const dist = Math.round(minDistance);
        return {
          label: `🎯 ${closestHider.nickname}: ${dist}m`,
          tone: dist <= MAX_CAPTURE_DISTANCE_METERS ? ('critical' as const) : ('near' as const),
        };
      }
      return { label: '🧭 Searching...', tone: 'neutral' as const };
    } else {
      const huntersWithLoc = snapshot.participants.filter(
        (p) => p.role === 'HUNTER' && p.location
      );
      if (huntersWithLoc.length > 0) {
        let minDistance = Infinity;
        let closestHunter: ParticipantView | null = null;
        for (const h of huntersWithLoc) {
          const d = calculateDistanceMeters(myLoc.lat, myLoc.lng, h.location!.lat, h.location!.lng);
          if (d < minDistance) {
            minDistance = d;
            closestHunter = h;
          }
        }
        if (closestHunter) {
          const dist = Math.round(minDistance);
          if (dist <= 20) {
            return {
              label: `🚨 Hunter nearby: ${dist}m!`,
              tone: 'critical' as const,
            };
          } else if (dist <= 40) {
            return {
              label: `⚠️ Hunter: ${dist}m`,
              tone: 'warning' as const,
            };
          }
          return {
            label: `🧭 Hunter: ${dist}m`,
            tone: 'safe' as const,
          };
        }
      }
      return { label: '🛡️ Radar: Safe', tone: 'safe' as const };
    }
  }, [snapshot, me?.location, localGpsFix, isHunter]);

  return (
    <div className="min-h-screen w-full flex flex-col bg-canvas text-ink" dir="ltr">
      <header className="bg-surface/95 backdrop-blur border-b border-stoneline sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <button type="button" onClick={handleLeaveGame} className="flex items-center gap-2.5 text-left focus:outline-none min-h-[44px]">
            <div className="w-9 h-9 rounded-xl bg-cedar flex items-center justify-center text-white shadow-sm">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-display font-bold text-base tracking-tight text-ink">AUI Manhunt</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cedar-light text-cedar">Ifrane</span>
              </div>
              <p className="text-[11px] text-ink-muted leading-none mt-0.5">Al Akhawayn University Campus</p>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {wakeLockActive && (
              <span
                title="Screen Wake Lock active — phone screen will stay awake during gameplay"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900"
              >
                <span>☀️ Awake</span>
              </span>
            )}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-subtle border border-stoneline text-xs font-medium text-ink-secondary">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-600' : 'bg-red-600'}`} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            {!isStandaloneApp && (
              <button
                type="button"
                onClick={handleInstallAppClick}
                className="min-h-[40px] px-3 py-1.5 rounded-xl bg-subtle hover:bg-stoneline/60 text-xs font-semibold text-ink transition flex items-center gap-1.5"
              >
                <span>📲 Install App</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 6-Second Live Note & Game Event Top Animated Banner (z-index: 99998) */}
      {activeEventBanner && (
        <aside
          aria-live="polite"
          style={{ zIndex: 99998 }}
          className="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-lg shadow-2xl rounded-2xl p-3.5 sm:p-4 bg-stone-950 text-white border-2 border-cedar flex items-center justify-between gap-3 animate-fade-in"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl shrink-0">
              {activeEventBanner.type === 'NOTE'
                ? '🔔'
                : activeEventBanner.type === 'CAPTURE'
                ? '🎯'
                : activeEventBanner.type === 'PHOTO_REQUEST' || activeEventBanner.type === 'PHOTO_SUBMITTED'
                ? '📷'
                : activeEventBanner.type === 'SOUND_ALERT'
                ? '🚨'
                : activeEventBanner.type === 'TAUNT'
                ? '📣'
                : '⚡'}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-display font-bold text-xs sm:text-sm text-white truncate">
                  {activeEventBanner.senderName}
                </span>
                {activeEventBanner.senderRole && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      activeEventBanner.senderRole === 'HUNTER'
                        ? 'bg-hunter-light text-hunter'
                        : 'bg-cedar-light text-cedar'
                    }`}
                  >
                    {activeEventBanner.senderRole}
                  </span>
                )}
                <span className="text-[10px] text-stone-400 font-mono">
                  {new Date(activeEventBanner.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-xs text-stone-200 font-medium leading-snug mt-0.5 break-words">
                {activeEventBanner.message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveEventBanner(null)}
            aria-label="Dismiss event notification"
            className="shrink-0 w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-base flex items-center justify-center transition"
          >
            ×
          </button>
        </aside>
      )}

      <main className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-4 py-5">
        {!snapshot && screen === 'HOME' && (
          <section className="flex-1 flex flex-col justify-center py-4">
            <div className="aui-card p-6 sm:p-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cedar-subtle border border-cedar/20 text-cedar text-xs font-semibold mb-4">
                <span>Al Akhawayn University • Ifrane, Morocco</span>
              </div>

              <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-ink tracking-tight leading-tight">
                Find your friends.
                <br />
                <span className="text-cedar">Don’t get caught.</span>
              </h1>

              <p className="mt-3 text-base text-ink-secondary leading-relaxed">
                A live campus hide-and-seek game for Al Akhawayn students. Join a private room code, get a secret role, and play inside the safe campus boundary.
              </p>

              <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => setScreen('CREATE')}
                  className="btn-cedar h-14 rounded-2xl font-display font-bold text-base shadow-sm flex items-center justify-center gap-2.5"
                >
                  <span>Create a Game</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScreen('JOIN')}
                  className="btn-secondary h-14 rounded-2xl font-display font-bold text-base flex items-center justify-center gap-2.5"
                >
                  <span>Join a Game</span>
                </button>
              </div>

              <div className="mt-7 pt-6 border-t border-stoneline grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-canvas">
                  <div className="font-display font-bold text-xs text-cedar">1. Join Room</div>
                  <p className="text-[11px] text-ink-muted mt-0.5">Share a 6-letter code with friends</p>
                </div>
                <div className="p-2.5 rounded-xl bg-canvas">
                  <div className="font-display font-bold text-xs text-cedar">2. Secret Role</div>
                  <p className="text-[11px] text-ink-muted mt-0.5">Assigned privately as Hunter or Hider</p>
                </div>
                <div className="p-2.5 rounded-xl bg-canvas">
                  <div className="font-display font-bold text-xs text-cedar">3. Live Map</div>
                  <p className="text-[11px] text-ink-muted mt-0.5">Real-time satellite GPS on campus</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {!snapshot && screen === 'CREATE' && (
          <section className="flex-1 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-cedar">Host Setup</span>
                <h2 className="font-display font-bold text-2xl text-ink">Create a Game</h2>
              </div>
              <button type="button" onClick={() => setScreen('HOME')} className="btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold">
                Back
              </button>
            </div>

            <form onSubmit={handleCreateGame} className="aui-card p-5 sm:p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-ink">Your nickname *</label>
                    <span className="text-[11px] text-ink-muted">3–15 chars</span>
                  </div>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={15}
                    value={createNickname}
                    onChange={(e) => setCreateNickname(e.target.value)}
                    placeholder="e.g., Adam"
                    className="w-full h-12 px-3.5 rounded-xl bg-canvas border border-stoneline text-sm font-medium text-ink focus:outline-none focus:border-cedar"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1.5">Game name (optional)</label>
                  <input
                    type="text"
                    maxLength={40}
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="e.g., Campus Night Hunt"
                    className="w-full h-12 px-3.5 rounded-xl bg-canvas border border-stoneline text-sm font-medium text-ink focus:outline-none focus:border-cedar"
                  />
                </div>
              </div>

              {/* Quick Game Mode Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-cedar">
                    ⚡ Quick Game Mode Presets
                  </label>
                  <span className="text-[11px] text-ink-muted">Tap to load curated settings</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => applyQuickModePreset('standard')}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between ${
                      selectedPresetId === 'standard'
                        ? 'bg-cedar-subtle border-cedar shadow-sm ring-2 ring-cedar/20'
                        : 'bg-canvas border-stoneline hover:border-cedar/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-display font-bold text-sm text-ink flex items-center gap-1.5">
                          <span>⚡</span> Standard Campus Hunt
                        </span>
                        {selectedPresetId === 'standard' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cedar text-white">Selected</span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-secondary leading-snug">
                        Balanced campus hunt: 1 Hunter, 20m match, 30s countdown, 60s GPS pings, 1 Ghost Cloak, Walkie-Talkie ON, and Proximity &lt; 20m.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-stoneline/60 flex items-center gap-1.5 text-[10px] font-mono font-semibold text-ink-muted">
                      <span>1 Hunter</span> • <span>20 mins</span> • <span>60s GPS</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyQuickModePreset('battle_royale')}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between ${
                      selectedPresetId === 'battle_royale'
                        ? 'bg-amber-50 border-amber-600 shadow-sm ring-2 ring-amber-600/20'
                        : 'bg-canvas border-stoneline hover:border-amber-600/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-display font-bold text-sm text-ink flex items-center gap-1.5">
                          <span>🔥</span> Battle Royale Rush
                        </span>
                        {selectedPresetId === 'battle_royale' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-700 text-white">Selected</span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-secondary leading-snug">
                        High octane adrenaline: 15m duration, Shrinking Play Zone ON (shrinks in 2nd half), 15s rapid GPS pings, 10s countdown, and 2 Hunters.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-stoneline/60 flex items-center gap-1.5 text-[10px] font-mono font-semibold text-ink-muted">
                      <span>2 Hunters</span> • <span>15 mins</span> • <span>Shrinking Zone</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyQuickModePreset('stealth')}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between ${
                      selectedPresetId === 'stealth'
                        ? 'bg-purple-50 border-purple-700 shadow-sm ring-2 ring-purple-700/20'
                        : 'bg-canvas border-stoneline hover:border-purple-700/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-display font-bold text-sm text-ink flex items-center gap-1.5">
                          <span>🕵️</span> Stealth &amp; Shadows
                        </span>
                        {selectedPresetId === 'stealth' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-800 text-white">Selected</span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-secondary leading-snug">
                        Pure covert operation: Hunters are hidden from map, 2 Ghost Cloaks per Hider, 2-Digit Catch PIN verification, and Fog of War enabled.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-stoneline/60 flex items-center gap-1.5 text-[10px] font-mono font-semibold text-ink-muted">
                      <span>Hidden Hunter</span> • <span>2 Cloaks</span> • <span>Catch PIN</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Core 3 Dropdowns */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1.5">Hunters</label>
                  <select
                    value={createHunters}
                    onChange={(e) => setCreateHunters(Number(e.target.value))}
                    className="w-full h-12 px-3 rounded-xl bg-canvas border border-stoneline text-sm font-semibold text-ink"
                  >
                    <option value={1}>1 Hunter</option>
                    <option value={2}>2 Hunters</option>
                    <option value={3}>3 Hunters</option>
                    <option value={4}>4 Hunters</option>
                    <option value={5}>5 Hunters</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1.5">Game time</label>
                  <select
                    value={createDuration}
                    onChange={(e) => setCreateDuration(Number(e.target.value))}
                    className="w-full h-12 px-3 rounded-xl bg-canvas border border-stoneline text-sm font-semibold text-ink"
                  >
                    <option value={5}>5 mins (Quick Test)</option>
                    <option value={10}>10 mins</option>
                    <option value={15}>15 mins</option>
                    <option value={20}>20 mins</option>
                    <option value={30}>30 mins</option>
                    <option value={45}>45 mins</option>
                    <option value={60}>60 mins</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1.5">Hider head-start</label>
                  <select
                    value={createCountdown}
                    onChange={(e) => setCreateCountdown(Number(e.target.value))}
                    className="w-full h-12 px-3 rounded-xl bg-canvas border border-stoneline text-sm font-semibold text-ink"
                  >
                    <option value={10}>10 sec</option>
                    <option value={30}>30 sec</option>
                    <option value={60}>60 sec</option>
                    <option value={0}>No wait</option>
                  </select>
                </div>
              </div>

              {/* Collapsible Accordion for Remaining 11 Advanced Rules */}
              <div className="border border-stoneline rounded-2xl overflow-hidden bg-canvas">
                <button
                  type="button"
                  onClick={() => setShowAdvancedRules((prev) => !prev)}
                  className="w-full p-4 text-left flex items-center justify-between bg-subtle/50 hover:bg-subtle transition"
                >
                  <span className="font-display font-bold text-xs sm:text-sm text-ink flex items-center gap-2">
                    <span>⚙️</span>
                    <span>Advanced Game Rules (Optional)</span>
                    <span className="text-[11px] font-normal text-ink-muted">
                      {showAdvancedRules ? '— Click to collapse' : '— Click to customize 11 options'}
                    </span>
                  </span>
                  <span className="text-xs font-bold text-cedar px-2.5 py-1 rounded-lg bg-canvas border border-stoneline">
                    {showAdvancedRules ? '▲ Hide' : '▼ Expand'}
                  </span>
                </button>

                {showAdvancedRules && (
                  <div className="p-4 border-t border-stoneline grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs bg-white">
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Ghost Cloak Uses per Hider</label>
                      <select
                        value={createGhostCloakUses}
                        onChange={(e) => setCreateGhostCloakUses(Number(e.target.value))}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={1}>1 use (60s stealth)</option>
                        <option value={2}>2 uses (60s each)</option>
                        <option value={3}>3 uses (60s each)</option>
                        <option value={0}>Disabled (0)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Walkie-Talkie Radio</label>
                      <select
                        value={createWalkieEnabled ? 'yes' : 'no'}
                        onChange={(e) => setCreateWalkieEnabled(e.target.value === 'yes')}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="yes">Enabled (Push-to-Talk + Disguise)</option>
                        <option value="no">Disabled</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Hunter Map Visibility</label>
                      <select
                        value={createHunterVisMode}
                        onChange={(e) => setCreateHunterVisMode(e.target.value as HunterVisibilityMode)}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="ALWAYS_LIVE">Always Visible on Map</option>
                        <option value="RADAR_PING_15S">Radar Ping Mode</option>
                        <option value="HIDDEN">Hidden from Hiders</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">GPS Update Interval</label>
                      <select
                        value={createGpsInterval}
                        onChange={(e) => setCreateGpsInterval(Number(e.target.value))}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={15}>15 sec (Fastest)</option>
                        <option value={30}>30 sec</option>
                        <option value={60}>60 sec (Balanced)</option>
                        <option value={90}>90 sec</option>
                        <option value={120}>2 mins (Stealth)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Catch Verification Mode</label>
                      <select
                        value={createCatchMode}
                        onChange={(e) => setCreateCatchMode(e.target.value as CatchVerificationMode)}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="PROXIMITY_20M">Proximity &lt; 20m</option>
                        <option value="CATCH_PIN">2-Digit Catch PIN</option>
                        <option value="INSTANT_TAP">Instant Hunter Tap</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Out-of-Bounds Grace Period</label>
                      <select
                        value={createGracePeriod}
                        onChange={(e) => setCreateGracePeriod(Number(e.target.value))}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={30}>30 sec countdown</option>
                        <option value={60}>60 sec countdown</option>
                        <option value={90}>90 sec countdown</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Teammate Visibility</label>
                      <select
                        value={createTeammateVis}
                        onChange={(e) => setCreateTeammateVis(e.target.value as TeammateVisibilityMode)}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="SHOW_TEAMMATES">Show Teammates</option>
                        <option value="HIDE_TEAMMATES">Hide Teammates - Fog of War</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Shrinking Play Zone</label>
                      <select
                        value={createShrinkingZone ? 'yes' : 'no'}
                        onChange={(e) => setCreateShrinkingZone(e.target.value === 'yes')}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="no">Static Boundary Circle</option>
                        <option value="yes">Shrink 15% / 5m in 2nd Half</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Sound alerts per Hunter</label>
                      <select
                        value={createSoundUses}
                        onChange={(e) => setCreateSoundUses(Number(e.target.value))}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={2}>2 uses</option>
                        <option value={3}>3 uses</option>
                        <option value={5}>5 uses</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Sound cooldown</label>
                      <select
                        value={createSoundCooldown}
                        onChange={(e) => setCreateSoundCooldown(Number(e.target.value))}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={60}>60 sec</option>
                        <option value={90}>90 sec</option>
                        <option value={120}>2 mins</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Photo request limit</label>
                      <select
                        value={createPhotoLimit}
                        onChange={(e) => setCreatePhotoLimit(Number(e.target.value))}
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={1}>1 per Hider per game</option>
                        <option value={2}>2 per Hider per game</option>
                        <option value={3}>3 per Hider per game</option>
                        <option value={0}>Disabled (0)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <label className="block text-xs font-semibold text-ink">Permitted Campus Play Area (AUI Ifrane Presets)</label>
                    <p className="text-xs text-ink-muted">Select an official Al Akhawayn campus zone or click directly on the map to move the green circle center.</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['main', 'academic', 'housing', 'athletic'] as CampusPresetKey[]).map((key) => {
                      const isSelected = activePresetKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            const p = AUI_CAMPUS_PRESETS[key];
                            setActivePresetKey(key);
                            setSetupBoundary({ lat: p.lat, lng: p.lng, radiusMeters: p.radiusMeters });
                            setSetupCenterCmd({ lat: p.lat, lng: p.lng, zoom: p.zoom, ts: Date.now() });
                          }}
                          className={`min-h-[38px] px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            isSelected
                              ? 'bg-cedar text-white shadow-sm'
                              : 'bg-subtle hover:bg-stoneline text-ink'
                          }`}
                        >
                          {AUI_CAMPUS_PRESETS[key].name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{ position: 'relative', zIndex: 1, isolation: 'isolate' }}
                  className="map-stack-container w-full h-56 rounded-2xl overflow-hidden border border-stoneline relative bg-[#EBF1EC]"
                >
                  <CampusMap
                    mode="setup"
                    boundary={setupBoundary}
                    onSetupBoundaryMove={(lat, lng) => {
                      setSetupBoundary((prev) => ({ ...prev, lat, lng }));
                    }}
                    centerCommand={setupCenterCmd}
                  />
                  <div className="absolute bottom-2 left-2 z-[400] aui-pill px-2.5 py-1 rounded-lg text-[11px] font-mono text-ink-secondary pointer-events-none">
                    Center: {setupBoundary.lat.toFixed(5)}, {setupBoundary.lng.toFixed(5)} • R={setupBoundary.radiusMeters}m
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-4 bg-canvas px-3.5 py-2.5 rounded-xl border border-stoneline">
                  <label className="text-xs font-semibold text-ink whitespace-nowrap">
                    Play boundary radius: <span className="font-mono text-cedar font-bold">{setupBoundary.radiusMeters}m</span>
                  </label>
                  <input
                    type="range"
                    min={100}
                    max={500}
                    step={5}
                    value={Math.min(500, Math.max(100, setupBoundary.radiusMeters))}
                    onChange={(e) => {
                      const nextRadius = Number(e.target.value);
                      setSetupBoundary((prev) => ({ ...prev, radiusMeters: nextRadius }));
                      if (nextRadius >= 330) {
                        setSetupCenterCmd({
                          lat: setupBoundary.lat,
                          lng: setupBoundary.lng,
                          zoom: 16,
                          ts: Date.now(),
                        });
                      }
                    }}
                    className="w-full accent-[#14532D] cursor-pointer"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                <strong>Campus safety reminder:</strong> Keep gameplay strictly inside permitted pedestrian areas. Never enter roads, restricted university buildings, construction zones, or private dorm rooms without permission.
              </div>

              {createError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-red-50 border-2 border-red-400 text-red-900 text-xs font-semibold flex items-start gap-2.5 shadow-sm"
                >
                  <span className="text-base leading-none shrink-0">⚠️</span>
                  <div className="flex-1">
                    <strong className="block text-red-950 font-bold mb-0.5">Could Not Create Lobby</strong>
                    <span>{createError}</span>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isCreatingLobby}
                className="btn-cedar w-full h-14 rounded-2xl font-display font-bold text-base shadow-sm flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isCreatingLobby ? (
                  <>
                    <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span>⏳ Creating Lobby...</span>
                  </>
                ) : (
                  <span>Create Lobby &amp; Get Room Code</span>
                )}
              </button>
            </form>
          </section>
        )}

        {!snapshot && screen === 'JOIN' && (
          <section className="flex-1 flex flex-col justify-center py-4">
            <div className="aui-card p-6 sm:p-7 max-w-md w-full mx-auto space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-cedar">Join Friends</span>
                  <h2 className="font-display font-bold text-2xl text-ink">Enter Room Code</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setJoinError(null);
                    setScreen('HOME');
                  }}
                  className="btn-secondary px-3 py-1.5 rounded-xl text-xs font-semibold"
                >
                  Back
                </button>
              </div>

              {roomPreviewLoading && (
                <div className="p-3 rounded-xl bg-canvas border border-stoneline text-xs text-ink-secondary flex items-center gap-2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-cedar border-t-transparent rounded-full animate-spin" />
                  <span>Checking room details for {joinCodeInput}...</span>
                </div>
              )}

              {roomPreview && !roomPreviewLoading && (
                <div className="p-3.5 rounded-2xl bg-cedar-subtle border border-cedar/30 text-xs space-y-2 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cedar block">
                        Invite Room Found • Host: {roomPreview.hostNickname}
                      </span>
                      <strong className="font-display font-bold text-sm text-ink block">{roomPreview.title}</strong>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full font-bold text-[11px] shrink-0 ${
                        roomPreview.state === 'LOBBY'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {roomPreview.state === 'LOBBY' ? '🟢 Waiting in Lobby' : `⚡ ${roomPreview.state}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-cedar/15 text-[11px]">
                    <div>
                      <span className="text-ink-muted block">Players</span>
                      <strong className="text-ink font-mono">
                        {roomPreview.playerCount}/{roomPreview.maxPlayers}
                      </strong>
                    </div>
                    <div>
                      <span className="text-ink-muted block">Hunters &amp; Time</span>
                      <strong className="text-ink">
                        {roomPreview.hunterCount}H • {roomPreview.durationMinutes}m
                      </strong>
                    </div>
                    <div>
                      <span className="text-ink-muted block">Campus Zone</span>
                      <strong className="text-ink font-mono">{roomPreview.radiusMeters}m</strong>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleJoinGame} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1.5">6-Character Room Code *</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    disabled={isJoiningLobby}
                    value={joinCodeInput}
                    onChange={(e) => {
                      setJoinError(null);
                      setJoinCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                    }}
                    placeholder="AUI42X"
                    className="w-full h-14 px-4 rounded-xl bg-canvas border border-stoneline font-mono font-bold text-2xl tracking-widest uppercase text-center text-ink focus:outline-none focus:border-cedar disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-ink">Your nickname *</label>
                    <span className="text-[11px] text-ink-muted">3–15 chars (unique in room)</span>
                  </div>
                  <input
                    ref={joinNicknameInputRef}
                    type="text"
                    required
                    minLength={3}
                    maxLength={15}
                    autoFocus={joinCodeInput.trim().length === 6}
                    disabled={isJoiningLobby}
                    value={joinNicknameInput}
                    onChange={(e) => {
                      setJoinError(null);
                      setJoinNicknameInput(e.target.value);
                    }}
                    placeholder="e.g., Adam"
                    className="w-full h-12 px-3.5 rounded-xl bg-canvas border border-stoneline text-sm font-medium text-ink focus:outline-none focus:border-cedar disabled:opacity-60"
                  />
                </div>

                {joinError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-red-50 border-2 border-red-400 text-red-900 text-xs font-semibold flex items-start gap-2.5 shadow-sm"
                  >
                    <span className="text-base leading-none shrink-0">⚠️</span>
                    <div className="flex-1">
                      <strong className="block text-red-950 font-bold mb-0.5">Unable to Join Room</strong>
                      <span>{joinError}</span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isJoiningLobby}
                  className="btn-cedar w-full h-14 rounded-2xl font-display font-bold text-base flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isJoiningLobby ? (
                    <>
                      <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      <span>⏳ Joining Lobby...</span>
                    </>
                  ) : (
                    <span>Join Game Lobby</span>
                  )}
                </button>
              </form>
            </div>
          </section>
        )}

        {snapshot && snapshot.state === 'LOBBY' && (
          <section className="flex-1 flex flex-col gap-4">
            <div className="aui-card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-cedar">Game Lobby • Waiting for players</span>
                  <h2 className="font-display font-bold text-xl text-ink mt-0.5">{snapshot.title}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="px-4 py-2 rounded-xl bg-canvas border border-stoneline text-center">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Room Code</span>
                    <span className="font-mono font-bold text-xl tracking-widest text-cedar">{snapshot.code}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(snapshot.code).catch(() => {});
                      showToast(`Copied 6-character room code: ${snapshot.code}`);
                    }}
                    className="btn-secondary h-12 px-3.5 rounded-xl text-xs font-semibold"
                  >
                    Copy Code
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/?room=${encodeURIComponent(snapshot.code)}`;
                      navigator.clipboard?.writeText(url).catch(() => {});
                      showToast('Copied full invite link to clipboard!');
                    }}
                    className="btn-secondary h-12 px-3.5 rounded-xl text-xs font-semibold"
                  >
                    Copy Link
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShareRoomInvite(snapshot.code, snapshot.title)}
                    className="btn-cedar h-12 px-4 rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5"
                  >
                    <span>📤 Share Invite</span>
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-stoneline grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded-xl bg-canvas">
                  <span className="text-ink-muted block">Hunters &amp; Catch</span>
                  <span className="font-bold text-ink text-sm">
                    {snapshot.settings.hunterCount}H •{' '}
                    {snapshot.settings.catchVerificationMode === 'CATCH_PIN'
                      ? '2-Digit PIN'
                      : snapshot.settings.catchVerificationMode === 'INSTANT_TAP'
                      ? 'Instant Tap'
                      : '< 20m Prox'}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-canvas">
                  <span className="text-ink-muted block">Time limit</span>
                  <span className="font-bold text-ink text-sm">{snapshot.settings.durationMinutes} mins</span>
                </div>
                <div className="p-2.5 rounded-xl bg-canvas">
                  <span className="text-ink-muted block">GPS update</span>
                  <span className="font-bold text-ink text-sm">Every {unifiedGpsIntervalSec} sec</span>
                </div>
                <div className="p-2.5 rounded-xl bg-canvas">
                  <span className="text-ink-muted block">Campus area</span>
                  <span className="font-bold text-ink text-sm">
                    {snapshot.settings.boundary.radiusMeters}m {snapshot.settings.shrinkingZone ? '(Shrinking)' : ''}
                  </span>
                </div>
              </div>

              {isHost && (
                <div className="mt-4 pt-4 border-t border-stoneline">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-bold text-cedar uppercase tracking-wider">Host Lobby Settings (Edit Live)</span>
                    <span className="text-[11px] text-ink-muted">Adjust rules without leaving the room</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Number of Hunters</label>
                      <select
                        value={snapshot.settings.hunterCount}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: Number(e.target.value),
                              durationMinutes: snapshot.settings.durationMinutes,
                            },
                            'Updated number of Hunters.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={1}>1 Hunter</option>
                        <option value={2}>2 Hunters</option>
                        <option value={3}>3 Hunters</option>
                        <option value={4}>4 Hunters</option>
                        <option value={5}>5 Hunters</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Round Duration</label>
                      <select
                        value={snapshot.settings.durationMinutes}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: Number(e.target.value),
                            },
                            'Updated round duration.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={5}>5 mins (Quick Test)</option>
                        <option value={10}>10 mins</option>
                        <option value={15}>15 mins</option>
                        <option value={20}>20 mins</option>
                        <option value={30}>30 mins</option>
                        <option value={45}>45 mins</option>
                        <option value={60}>60 mins</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Ghost Cloak Uses</label>
                      <select
                        value={snapshot.settings.ghostCloakUsesPerHider ?? 1}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              ghostCloakUsesPerHider: Number(e.target.value),
                            },
                            'Updated Ghost Cloak uses per Hider.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={1}>1 use / Hider</option>
                        <option value={2}>2 uses / Hider</option>
                        <option value={3}>3 uses / Hider</option>
                        <option value={0}>Disabled (0)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Walkie-Talkie Radio</label>
                      <select
                        value={snapshot.settings.walkieTalkieEnabled !== false ? 'yes' : 'no'}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              walkieTalkieEnabled: e.target.value === 'yes',
                            },
                            e.target.value === 'yes' ? 'Walkie-Talkie radio enabled!' : 'Walkie-Talkie radio disabled.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="yes">Enabled</option>
                        <option value="no">Disabled</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Hunter Map Visibility</label>
                      <select
                        value={snapshot.settings.hunterVisibilityMode || 'ALWAYS_LIVE'}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              hunterVisibilityMode: e.target.value,
                            },
                            'Updated Hunter map visibility.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="ALWAYS_LIVE">Always Live on Map</option>
                        <option value="RADAR_PING_15S">Radar Ping Mode</option>
                        <option value="HIDDEN">Hidden from Hiders</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Hider Head-Start</label>
                      <select
                        value={snapshot.settings.countdownSeconds}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              countdownSeconds: Number(e.target.value),
                            },
                            'Updated hiding countdown.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={10}>10 sec</option>
                        <option value={30}>30 sec</option>
                        <option value={60}>60 sec</option>
                        <option value={0}>No wait</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">GPS Update Interval</label>
                      <select
                        value={snapshot.settings.gpsIntervalSeconds || 60}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              gpsIntervalSeconds: Number(e.target.value),
                            },
                            `GPS update interval set to ${e.target.value}s.`
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={15}>15 sec</option>
                        <option value={30}>30 sec</option>
                        <option value={60}>60 sec</option>
                        <option value={90}>90 sec</option>
                        <option value={120}>2 mins</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Catch Verification</label>
                      <select
                        value={snapshot.settings.catchVerificationMode || 'PROXIMITY_20M'}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              catchVerificationMode: e.target.value,
                            },
                            'Updated catch verification mode.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="PROXIMITY_20M">Proximity &lt; 20m</option>
                        <option value="CATCH_PIN">2-Digit Catch PIN</option>
                        <option value="INSTANT_TAP">Instant Hunter Tap</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Out-of-Bounds Grace</label>
                      <select
                        value={snapshot.settings.outOfBoundsGraceSeconds || 60}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              outOfBoundsGraceSeconds: Number(e.target.value),
                            },
                            `Out-of-bounds grace period set to ${e.target.value}s.`
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={30}>30 sec</option>
                        <option value={60}>60 sec</option>
                        <option value={90}>90 sec</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Teammate Visibility</label>
                      <select
                        value={snapshot.settings.teammateVisibility || 'SHOW_TEAMMATES'}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              teammateVisibility: e.target.value,
                            },
                            'Updated Hider teammate visibility.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="SHOW_TEAMMATES">Show Teammates</option>
                        <option value="HIDE_TEAMMATES">Hide (Fog of War)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Shrinking Play Zone</label>
                      <select
                        value={snapshot.settings.shrinkingZone ? 'yes' : 'no'}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              shrinkingZone: e.target.value === 'yes',
                            },
                            e.target.value === 'yes' ? 'Shrinking Play Zone enabled!' : 'Shrinking Play Zone disabled.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value="no">Off (Static Circle)</option>
                        <option value="yes">On (-15% / 5m in 2nd Half)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-ink-secondary mb-1">Photo Requests</label>
                      <select
                        value={snapshot.settings.photoRequestsPerHider ?? 1}
                        onChange={(e) =>
                          dispatchGameAction(
                            {
                              action: 'UPDATE_RULES',
                              hunterCount: snapshot.settings.hunterCount,
                              durationMinutes: snapshot.settings.durationMinutes,
                              photoRequestsPerHider: Number(e.target.value),
                            },
                            'Updated photo request limit.'
                          )
                        }
                        className="w-full h-11 px-2.5 rounded-lg bg-canvas border border-stoneline font-semibold text-ink"
                      >
                        <option value={1}>1 per Hider</option>
                        <option value={2}>2 per Hider</option>
                        <option value={3}>3 per Hider</option>
                        <option value={0}>Disabled (0)</option>
                      </select>
                    </div>
                  </div>
                  {hunterCountConflict && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 font-medium">
                      Hunter count ({snapshot.settings.hunterCount}) must be less than total players ({snapshot.participants.length}). Reduce Hunters above or wait for more players to join.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="aui-card p-5 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="font-display font-bold text-base text-ink">
                    Players ({snapshot.participants.length}/{snapshot.settings.maxPlayers}) • Ready ({readyPlayersCount}/{snapshot.participants.length})
                  </h3>
                  <span className="text-xs text-ink-muted">All players must be Ready before the host can start</span>
                </div>

                <div className="space-y-2.5">
                  {snapshot.participants.map((p) => {
                    const isMe = p.id === activePlayerId;
                    return (
                      <div key={p.id} className="p-3 rounded-xl bg-canvas border border-stoneline flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs" style={{ background: p.color }}>
                            {p.nickname.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-sm text-ink flex items-center gap-1.5">
                              <span>{p.nickname}</span>
                              {isMe && <span className="text-[11px] px-2 py-0.5 rounded-full bg-cedar-light text-cedar font-bold">You</span>}
                              {p.isHost && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-semibold">Host</span>}
                            </div>
                            <span className="text-xs text-ink-muted">Connected in lobby</span>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${p.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'}`}>
                          {p.ready ? 'Ready ✓' : 'Not ready'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-stoneline space-y-3">
                {!isHost && (
                  <div className="p-3.5 rounded-xl bg-cedar-subtle border border-cedar/25 text-xs text-ink flex items-center justify-between gap-2">
                    <div>
                      <strong className="text-cedar font-bold block">Waiting for Host to Start the Game</strong>
                      <span className="text-ink-secondary">
                        {allPlayersReady
                          ? 'Everyone is ready! The host will start the game and assign secret roles shortly.'
                          : 'Make sure you mark yourself Ready below. The host will start the game once all players are ready.'}
                      </span>
                    </div>
                  </div>
                )}

                {isHost && !canHostStartGame && (
                  <div className="p-3 rounded-xl bg-subtle border border-stoneline text-xs text-ink-secondary">
                    {snapshot.participants.length < 2
                      ? 'Waiting for at least 2 players to join the lobby before starting.'
                      : hunterCountConflict
                      ? `Cannot start yet: ${snapshot.settings.hunterCount} Hunter(s) selected for ${snapshot.participants.length} players. Lower Hunters count above.`
                      : `Waiting for all players to be Ready (${readyPlayersCount}/${snapshot.participants.length} ready).`}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={() => dispatchGameAction({ action: 'TOGGLE_READY' })}
                    className={`min-h-[48px] py-3.5 px-5 rounded-2xl font-display font-bold text-sm flex-1 transition flex items-center justify-center gap-2 ${
                      me?.ready
                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm'
                        : 'btn-secondary border-2 border-cedar text-cedar'
                    }`}
                  >
                    {pendingActionKey === 'TOGGLE_READY' && (
                      <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    )}
                    <span>{me?.ready ? 'Ready ✓ (Tap to Set Not Ready)' : 'Not Ready — Tap to Mark Ready'}</span>
                  </button>
                  {isHost && (
                    <button
                      type="button"
                      disabled={!canHostStartGame || pendingActionKey === 'START_GAME'}
                      onClick={handleHostStartGame}
                      className="btn-cedar min-h-[48px] py-3.5 px-6 rounded-2xl font-display font-bold text-sm flex-1 shadow-sm flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {pendingActionKey === 'START_GAME' ? (
                        <>
                          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>⏳ Starting Game...</span>
                        </>
                      ) : (
                        <span>Start Game (Assign Secret Roles)</span>
                      )}
                    </button>
                  )}
                  <button type="button" onClick={handleLeaveGame} className="min-h-[48px] px-4 py-3.5 rounded-2xl text-xs font-semibold text-red-700 hover:bg-red-50 transition">
                    Leave Lobby
                  </button>
                </div>
              </div>
            </div>

            {/* Live Notes & Activity Feed in Lobby */}
            <div className="aui-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display font-bold text-sm text-ink">
                    📋 Live Notes &amp; Activity Feed
                  </h3>
                  <p className="text-[11px] text-ink-muted">
                    Send live notes &amp; sound alerts to everyone in the room
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {QUICK_NOTE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={pendingActionKey === 'SEND_NOTE'}
                    onClick={() => handleSendNote(preset)}
                    className="min-h-[36px] px-2.5 py-1 rounded-xl bg-canvas hover:bg-subtle border border-stoneline text-[11px] font-semibold text-ink transition disabled:opacity-50"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendNote();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  maxLength={140}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Write a live note or alert to all players..."
                  className="flex-1 h-11 px-3.5 rounded-xl bg-canvas border border-stoneline text-xs font-medium text-ink focus:outline-none focus:border-cedar"
                />
                <button
                  type="submit"
                  disabled={!noteInput.trim() || pendingActionKey === 'SEND_NOTE'}
                  className="btn-cedar h-11 px-4 rounded-xl text-xs font-bold shrink-0 disabled:opacity-45"
                >
                  {pendingActionKey === 'SEND_NOTE' ? '⏳...' : '🔔 Send Note'}
                </button>
              </form>

              {snapshot.events && snapshot.events.length > 0 && (
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 pt-1 border-t border-stoneline">
                  {[...snapshot.events]
                    .slice()
                    .reverse()
                    .map((evt) => (
                      <div
                        key={evt.id}
                        className="p-2.5 rounded-xl bg-canvas border border-stoneline text-xs flex items-start justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <strong className="font-bold text-ink">{evt.senderName}</strong>
                            {evt.senderRole && (
                              <span
                                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  evt.senderRole === 'HUNTER'
                                    ? 'bg-hunter-light text-hunter'
                                    : 'bg-cedar-light text-cedar'
                                }`}
                              >
                                {evt.senderRole}
                              </span>
                            )}
                          </div>
                          <p className="text-ink-secondary font-medium leading-snug">{evt.message}</p>
                        </div>
                        <span className="text-[10px] font-mono text-ink-muted shrink-0">
                          {new Date(evt.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </section>
        )}

        {snapshot &&
          (snapshot.state === 'COUNTDOWN' || snapshot.state === 'ACTIVE' || snapshot.state === 'PAUSED') &&
          !dismissedRoleForPlayers[snapshot.viewerId] && (
            <section className="flex-1 flex flex-col justify-center py-4">
              <div className="aui-card p-7 sm:p-9 text-center max-w-md w-full mx-auto space-y-5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-subtle text-ink-secondary text-xs font-semibold">
                  <span>Private Role Assignment • Keep your screen hidden</span>
                </div>
                <div className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center text-white shadow-md ${isHunter ? 'bg-hunter' : 'bg-cedar'}`}>
                  <span className="font-display font-extrabold text-2xl">{isHunter ? 'H' : 'S'}</span>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-ink-muted">You are a</p>
                  <h2 className={`font-display font-extrabold text-4xl tracking-tight mt-1 ${isHunter ? 'text-hunter' : 'text-cedar'}`}>
                    {isHunter ? 'HUNTER' : 'HIDER'}
                  </h2>
                  <p className="text-sm text-ink-secondary mt-2 leading-relaxed">
                    {isHunter
                      ? 'Wait for the hiding countdown to reach zero. Once the hunt starts, track Hiders on the live campus map and use your sound alerts and photo requests.'
                      : 'Stay inside the permitted campus boundary and avoid capture until the timer reaches zero. Hunters are hidden from your screen.'}
                  </p>
                </div>
                <RoleRevealCountdownCard
                  state={snapshot.state}
                  headStartEndsAtMs={snapshot.headStartEndsAtMs}
                  gameEndsAtMs={snapshot.gameEndsAtMs}
                  pausedRemainingMs={snapshot.pausedRemainingMs}
                  fallbackCountdownSeconds={snapshot.countdownSecondsLeft}
                  fallbackGameSeconds={snapshot.gameSecondsLeft}
                  serverTimeOffsetMs={serverTimeOffsetMs}
                  isHunter={isHunter}
                  onCountdownZero={handleCountdownReachedZero}
                  onOpenMap={() => {
                    soundEngine.unlockAndPlayActivationChime();
                    setSoundUnlockedLocal(true);
                    dispatchGameAction({ action: 'UNLOCK_AUDIO' });
                    setDismissedRoleForPlayers((prev) => ({ ...prev, [snapshot.viewerId]: true }));
                  }}
                />
              </div>
            </section>
          )}

        {snapshot &&
          (snapshot.state === 'COUNTDOWN' || snapshot.state === 'ACTIVE' || snapshot.state === 'PAUSED') &&
          dismissedRoleForPlayers[snapshot.viewerId] && (
            <section className="flex-1 flex flex-col gap-3">
              {!snapshot.viewerGpsConsent && !isGpsDenied && (
                <div className="aui-card p-4 bg-cedar-subtle border-cedar/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="text-xs text-ink leading-relaxed">
                    <strong className="text-cedar block text-sm font-display">Share your live campus GPS location?</strong>
                    Your position updates every {unifiedGpsIntervalSec} seconds while this page is open. Hunters can see Hider positions; Hiders never see Hunter positions. Location sharing stops immediately when you leave or the game ends.
                  </div>
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        clearGpsDeniedImmediately(true);
                        dispatchGameAction({ action: 'SET_CONSENT', consent: true, denied: false }).then(() => {
                          triggerForegroundGpsUpdate(true, true);
                        });
                      }}
                      className="btn-cedar px-4 py-2.5 rounded-xl text-xs font-bold flex-1 sm:flex-initial"
                    >
                      Allow GPS Sharing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (roomCode && activePlayerId) {
                          handleBrowserGpsDenied(roomCode, activePlayerId);
                        }
                      }}
                      className="btn-secondary px-3 py-2.5 rounded-xl text-xs font-semibold"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}

              {isGpsDenied && (
                <div className="aui-card p-4 bg-red-50 border-red-300 text-red-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="text-xs leading-relaxed space-y-1">
                    <strong className="text-red-800 block text-sm font-display">
                      Location Access Denied — Enable GPS in Browser Settings
                    </strong>
                    <p>
                      Automatic GPS tracking and manual GPS refresh are paused because location permission was blocked. To re-enable location access:
                    </p>
                    <ol className="list-decimal list-inside font-medium text-red-900 space-y-0.5">
                      <li>Tap the <strong>Lock / Site Settings icon (🔒)</strong> in your browser’s address bar.</li>
                      <li>Open <strong>Permissions → Location</strong> and change it to <strong>Allow</strong>.</li>
                      <li>Refresh this page or tap <strong>Re-check Permission</strong> after allowing access.</li>
                    </ol>
                  </div>
                  <div className="flex flex-wrap sm:flex-col gap-2 shrink-0 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        clearGpsDeniedImmediately(true);
                        dispatchGameAction({ action: 'SET_CONSENT', consent: true, denied: false }).then(() => {
                          triggerForegroundGpsUpdate(true, true);
                        });
                      }}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white border border-red-300 text-red-800 hover:bg-red-100 text-xs font-bold flex-1"
                    >
                      Re-check Permission
                    </button>
                  </div>
                </div>
              )}

              {activeWalkieSpeaker && (
                <div
                  style={{ backgroundColor: '#1e1b4b', color: '#ffffff' }}
                  className="p-3.5 rounded-2xl bg-indigo-950 text-white border-2 border-indigo-400 shadow-lg flex items-center justify-between gap-3 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl shrink-0">📻</span>
                    <div>
                      <strong className="font-display font-extrabold text-sm sm:text-base text-white block">
                        [{activeWalkieSpeaker.nickname} - {activeWalkieSpeaker.role}] is speaking on Walkie-Talkie...
                      </strong>
                      <span className="text-xs text-indigo-200 font-medium">
                        {activeWalkieSpeaker.disguised ? '🕵️ Voice Disguise Filter Active • Live Radio Channel' : 'Live Campus Radio Transmission'}
                      </span>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-indigo-600 text-white font-mono text-[11px] font-bold uppercase shrink-0">
                    ON AIR
                  </span>
                </div>
              )}

              {!isHunter && snapshot.state === 'ACTIVE' && snapshot.hunterProximity?.nearby && (
                <div
                  style={{ backgroundColor: '#450a0a', color: '#ffffff' }}
                  className="p-4 rounded-2xl bg-red-950 text-white border-2 border-red-500 shadow-lg flex items-center justify-between gap-3 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl shrink-0">💓 ⚠️</span>
                    <div>
                      <strong className="font-display font-extrabold text-base sm:text-lg text-white block uppercase tracking-wide">
                        Hunter Nearby! ({snapshot.hunterProximity.distanceBand === 'CRITICAL' ? 'Critical < 20m!' : 'Within 40m'})
                      </strong>
                      <span className="text-xs sm:text-sm text-red-100 font-medium block mt-0.5">
                        {snapshot.hunterProximity.distanceBand === 'CRITICAL'
                          ? 'A Hunter is dangerously close! Move away or activate your Ghost Cloak below!'
                          : 'Proximity Heartbeat Radar detected a Hunter approaching your area.'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {isPlayerOutsideBoundary && (
                <div className="aui-card p-3.5 bg-red-50 border-red-300 text-red-900 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div>
                      <strong className="font-bold">Outside green play boundary!</strong> Your position is{' '}
                      <span className="font-mono font-bold">{outsideBoundaryMeters}m</span> outside the permitted{' '}
                      <span className="font-mono font-bold">{snapshot.settings.boundary.radiusMeters}m</span> campus circle
                      {myDistanceFromCenterMeters !== null ? ` (${myDistanceFromCenterMeters}m from center)` : ''}.
                    </div>
                    <div className="font-semibold text-red-800">
                      {isHunter ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-red-200 text-red-950 font-bold">
                          ⚠️ You are outside the campus play zone! Return inside to catch Hiders.
                        </span>
                      ) : me?.location?.isOutOfBoundsExposed ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-red-200 text-red-950 font-bold">
                          🚨 GRACE PERIOD EXPIRED — Your live position is now EXPOSED to Hunters! Return inside immediately!
                        </span>
                      ) : (
                        <span>
                          ⏱ Return inside within{' '}
                          <strong className="font-mono text-sm">
                            {me?.location?.outOfBoundsGraceSecondsLeft ?? (snapshot.settings.outOfBoundsGraceSeconds || 60)}s
                          </strong>{' '}
                          or your live location will be exposed to Hunters!
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFitBoundaryCmd(Date.now())}
                    className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white border border-red-200 font-semibold text-red-800 shrink-0"
                  >
                    Show Boundary
                  </button>
                </div>
              )}

              {!isHunter && me?.photoRequest?.status === 'PENDING' && (
                <div className="aui-card p-4 bg-amber-50 border-amber-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="text-xs text-amber-950">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold text-[10px] uppercase mb-1">
                      Photo Request • {me.photoRequest.expiresInSeconds}s left
                    </span>
                    <strong className="block text-sm font-display">A Hunter requested a photo of your surroundings!</strong>
                    <span>
                      Respond within <strong className="font-mono">{me.photoRequest.expiresInSeconds}s</strong>. Tap below to take a photo with your phone camera.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedPhotoUrl(null);
                      setCameraStreamError(null);
                      setShowCameraModal(true);
                    }}
                    className="btn-hunter px-4 py-2.5 rounded-xl text-xs font-bold shrink-0 w-full sm:w-auto"
                  >
                    Open Camera &amp; Respond
                  </button>
                </div>
              )}

              <div className="aui-card p-3 sm:px-4 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-3 py-1.5 rounded-xl font-display font-bold text-xs text-white ${isHunter ? 'bg-hunter' : 'bg-cedar'}`}>
                      {isHunter ? 'HUNTER' : 'HIDER'}
                    </span>
                    <SmoothCountdownHeaderTicker
                      state={snapshot.state}
                      headStartEndsAtMs={snapshot.headStartEndsAtMs}
                      gameEndsAtMs={snapshot.gameEndsAtMs}
                      pausedRemainingMs={snapshot.pausedRemainingMs}
                      fallbackCountdownSeconds={snapshot.countdownSecondsLeft}
                      fallbackGameSeconds={snapshot.gameSecondsLeft}
                      serverTimeOffsetMs={serverTimeOffsetMs}
                      onCountdownZero={handleCountdownReachedZero}
                    />

                    {/* GPS Status Pill */}
                    <span
                      className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                        isGpsActiveAndConsented
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : isGpsDenied
                          ? 'bg-red-100 text-red-900 border border-red-300'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isGpsActiveAndConsented ? 'bg-emerald-600 animate-pulse' : isGpsDenied ? 'bg-red-600' : 'bg-amber-600'
                        }`}
                      />
                      <span>{isGpsActiveAndConsented ? 'GPS Live' : isGpsDenied ? 'GPS Denied' : 'GPS Waiting'}</span>
                    </span>

                    {/* Nearest Target / Radar Status Pill */}
                    {nearestTargetInfo && (
                      <span
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                          nearestTargetInfo.tone === 'critical'
                            ? 'bg-red-950 text-red-100 border border-red-500 animate-pulse'
                            : nearestTargetInfo.tone === 'warning' || nearestTargetInfo.tone === 'near'
                            ? 'bg-amber-900 text-amber-100 border border-amber-500'
                            : nearestTargetInfo.tone === 'safe'
                            ? 'bg-emerald-950 text-emerald-100 border border-emerald-500'
                            : 'bg-stone-800 text-stone-200 border border-stone-600'
                        }`}
                      >
                        <span>{nearestTargetInfo.label}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-right mr-1">
                      <span className="text-[10px] uppercase tracking-wider text-ink-muted block font-semibold">Hiders free</span>
                      <span className="font-display font-bold text-sm text-ink">
                        {snapshot.activeHiders} of {snapshot.totalHiders}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleUnlockAudio}
                      className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                        isSoundActive
                          ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm'
                          : 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${isSoundActive ? 'bg-emerald-300' : 'bg-amber-600'}`} />
                      <span>{isSoundActive ? 'Sound Active 🔊' : 'Enable Sound'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTestSound}
                      className="btn-secondary min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-semibold"
                    >
                      Test
                    </button>
                  </div>
                </div>

                {/* Hider Special Abilities & 2-Digit Catch PIN Bar */}
                {!isHunter && me?.status === 'ACTIVE' && (
                  <div className="pt-2 border-t border-stoneline flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {catchMode === 'CATCH_PIN' && snapshot.viewerCatchPin && (
                        <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex items-center gap-2">
                          <span className="font-semibold">🔐 Your Catch PIN:</span>
                          <span className="font-mono font-extrabold text-base tracking-widest text-hunter">
                            {snapshot.viewerCatchPin}
                          </span>
                        </div>
                      )}
                      {snapshot.settings.teammateVisibility === 'HIDE_TEAMMATES' && (
                        <span className="px-2.5 py-1 rounded-lg bg-stone-200 text-stone-800 font-semibold text-[11px]">
                          🌫️ Fog of War Active
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                      {(snapshot.settings.ghostCloakUsesPerHider ?? 1) <= 0 ? (
                        <span className="px-3 py-1.5 rounded-xl bg-subtle border border-stoneline text-ink-muted font-semibold text-xs">
                          👻 Ghost Cloak Disabled
                        </span>
                      ) : snapshot.viewerGhostCloak?.active ? (
                        <span className="px-3.5 py-2 rounded-xl bg-purple-900 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm">
                          <span>👻 Ghost Cloak Active ({snapshot.viewerGhostCloak.secondsLeft}s left)</span>
                        </span>
                      ) : snapshot.viewerGhostCloak?.used ? (
                        <span className="px-3 py-1.5 rounded-xl bg-subtle border border-stoneline text-ink-muted font-semibold text-xs">
                          👻 Ghost Cloak Used (0/{snapshot.viewerGhostCloak.maxUses ?? (snapshot.settings.ghostCloakUsesPerHider ?? 1)})
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={snapshot.state !== 'ACTIVE'}
                          onClick={() => {
                            soundEngine.playGhostCloakTone();
                            dispatchGameAction(
                              { action: 'ACTIVATE_GHOST_CLOAK' },
                              '👻 Ghost Cloak Activated! Your location is hidden from Hunters for 60 seconds.'
                            );
                          }}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-purple-800 hover:bg-purple-900 text-white font-bold text-xs transition shadow-sm disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          👻 Activate Ghost Cloak (60s) ({snapshot.viewerGhostCloak?.remainingUses ?? (snapshot.settings.ghostCloakUsesPerHider ?? 1)} left)
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{ position: 'relative', zIndex: 1, isolation: 'isolate' }}
                className="map-stack-container relative w-full h-[52dvh] min-h-[320px] max-h-[540px] rounded-2xl overflow-hidden border border-stoneline shadow-sm bg-[#EBF1EC]"
              >
                {isHunterMapLocked ? (
                  <HunterLockedMapCountdownOverlay
                    headStartEndsAtMs={snapshot.headStartEndsAtMs}
                    fallbackCountdownSeconds={snapshot.countdownSecondsLeft}
                    serverTimeOffsetMs={serverTimeOffsetMs}
                    onCountdownZero={handleCountdownReachedZero}
                  />
                ) : (
                  <CampusMap
                    mode="gameplay"
                    boundary={gameplayBoundary}
                    markers={mapMarkers}
                    centerCommand={gameCenterCmd}
                    fitBoundaryCommand={fitBoundaryCmd}
                  />
                )}

                <div className="absolute top-3 left-3 z-[400] flex flex-col gap-1.5 max-w-[68%]">
                  <div className="aui-pill px-3 py-1.5 rounded-xl text-xs flex items-center gap-2">
                    <span className="font-bold text-ink truncate">
                      {!isOnline
                        ? '🔴 Offline — GPS paused'
                        : isGpsDenied
                        ? '🔴 GPS Blocked'
                        : !snapshot.viewerGpsConsent
                        ? '🟡 Tap Allow GPS Sharing'
                        : effectiveGpsAccuracy !== null && !effectiveGpsStale && !lastGpsError
                        ? effectiveGpsAccuracy <= 20
                          ? `🟢 GPS Strong (±${effectiveGpsAccuracy}m)`
                          : `🟡 GPS Fair (±${effectiveGpsAccuracy}m)`
                        : effectiveGpsAccuracy !== null && effectiveGpsStale
                        ? `🟡 GPS Stale (±${effectiveGpsAccuracy}m)`
                        : gpsInFlight
                        ? '🔄 Searching GPS...'
                        : lastGpsError
                        ? `🔄 ${lastGpsError}`
                        : '🔄 Searching GPS...'}
                    </span>
                    {me?.location && (
                      <span className="text-ink-muted font-mono text-[11px] shrink-0">• {me.location.ageSeconds}s</span>
                    )}
                  </div>
                </div>

                <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={isHunterMapLocked}
                    onClick={() => {
                      if (me?.location) {
                        setGameCenterCmd({ lat: me.location.lat, lng: me.location.lng, zoom: 17, ts: Date.now() });
                      } else if (localGpsFix) {
                        setGameCenterCmd({ lat: localGpsFix.lat, lng: localGpsFix.lng, zoom: 17, ts: Date.now() });
                      } else {
                        showToast('Your GPS position is not active yet.', 'warning');
                      }
                    }}
                    className="aui-pill min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold text-ink hover:bg-white disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    Center map
                  </button>
                  <button
                    type="button"
                    disabled={isHunterMapLocked}
                    onClick={() => setFitBoundaryCmd(Date.now())}
                    className="aui-pill min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold text-ink hover:bg-white disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    Play area
                  </button>
                  <button
                    type="button"
                    disabled={isGpsDenied}
                    onClick={() => triggerForegroundGpsUpdate(true)}
                    className="aui-pill min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold text-cedar hover:bg-white disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none"
                  >
                    Update GPS
                  </button>
                </div>
              </div>

              {/* Segmented Tools & Activities Card */}
              <div className="aui-card p-3.5 sm:p-4 space-y-3.5">
                {/* 4 Clean Tabs */}
                <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-canvas border border-stoneline">
                  <button
                    type="button"
                    onClick={() => setActiveTab('radio')}
                    className={`min-h-[44px] px-2 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      activeTab === 'radio'
                        ? 'bg-cedar text-white shadow-sm'
                        : 'text-ink-secondary hover:text-ink hover:bg-subtle'
                    }`}
                  >
                    <span>📻</span>
                    <span className="truncate">Radio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('players');
                      setFitBoundaryCmd(Date.now());
                    }}
                    className={`min-h-[44px] px-2 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      activeTab === 'players'
                        ? 'bg-cedar text-white shadow-sm'
                        : 'text-ink-secondary hover:text-ink hover:bg-subtle'
                    }`}
                  >
                    <span>👥</span>
                    <span className="truncate">Players ({snapshot.participants.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('feed')}
                    className={`min-h-[44px] px-2 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      activeTab === 'feed'
                        ? 'bg-cedar text-white shadow-sm'
                        : 'text-ink-secondary hover:text-ink hover:bg-subtle'
                    }`}
                  >
                    <span>📋</span>
                    <span className="truncate">Feed</span>
                    {snapshot.events && snapshot.events.length > 0 && (
                      <span className="hidden sm:inline px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-mono">
                        {snapshot.events.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('safety')}
                    className={`min-h-[44px] px-2 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      activeTab === 'safety'
                        ? 'bg-cedar text-white shadow-sm'
                        : 'text-ink-secondary hover:text-ink hover:bg-subtle'
                    }`}
                  >
                    <span>⚙️</span>
                    <span className="truncate">Safety</span>
                  </button>
                </div>

                {/* TAB 1: RADIO & ABILITIES */}
                {activeTab === 'radio' && (
                  <div className="space-y-4">
                    {/* Walkie-Talkie & Soundboard Section */}
                    <div className="p-3.5 rounded-xl bg-canvas border border-stoneline space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="font-display font-bold text-xs sm:text-sm text-ink flex items-center gap-1.5">
                            <span>📻</span> Campus Walkie-Talkie &amp; Quick Taunts
                          </h4>
                          <p className="text-[11px] text-ink-muted">
                            Broadcast live voice clips or use Silent Radio Callouts if hiding in quiet campus zones
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {snapshot.settings.walkieTalkieEnabled !== false && (
                            <button
                              type="button"
                              onClick={() => setWalkieDisguised((prev) => !prev)}
                              className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 ${
                                walkieDisguised
                                  ? 'bg-purple-900 text-white border-purple-700 shadow-sm'
                                  : 'bg-white text-ink-secondary border-stoneline hover:bg-subtle'
                              }`}
                            >
                              <span>🕵️ Voice Disguise: {walkieDisguised ? 'ON' : 'OFF'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!snapshot.latestVoiceClip}
                            onClick={handleReplayLastRadioMessage}
                            className="btn-secondary min-h-[36px] px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <span>🔊 Replay Last Message</span>
                          </button>
                        </div>
                      </div>

                      {snapshot.settings.walkieTalkieEnabled !== false && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              startWalkieTalkieRecording();
                            }}
                            onPointerUp={(e) => {
                              e.preventDefault();
                              if (walkieRecording) stopWalkieTalkieRecording();
                            }}
                            onPointerCancel={() => {
                              if (walkieRecording) stopWalkieTalkieRecording();
                            }}
                            onClick={() => {
                              if (walkieRecording) {
                                stopWalkieTalkieRecording();
                              }
                            }}
                            className={`min-h-[48px] px-5 py-3 rounded-2xl font-display font-extrabold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-sm select-none ${
                              walkieRecording
                                ? 'bg-red-600 text-white animate-pulse ring-4 ring-red-300'
                                : 'bg-indigo-900 hover:bg-indigo-950 text-white'
                            }`}
                          >
                            <span>{walkieRecording ? '🔴 Recording Radio...' : '🎙️ Hold to Talk (Walkie-Talkie)'}</span>
                            {walkieRecording && (
                              <span className="px-2 py-0.5 rounded-full bg-white/20 font-mono text-xs">
                                {walkieRecordingSeconds}s / 6s
                              </span>
                            )}
                          </button>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1">
                            {TAUNT_OPTIONS.map((t) => {
                              const cd = snapshot.tauntCooldownSecondsLeft || 0;
                              return (
                                <button
                                  key={t.type}
                                  type="button"
                                  disabled={cd > 0}
                                  onClick={() => handleSendTaunt(t.type)}
                                  className="min-h-[44px] px-2.5 py-1.5 rounded-xl bg-white hover:bg-subtle border border-stoneline text-[11px] font-bold text-ink transition flex flex-col items-center justify-center text-center leading-tight disabled:opacity-45 disabled:cursor-not-allowed"
                                >
                                  <span>
                                    {t.emoji} {t.label}
                                  </span>
                                  {cd > 0 && (
                                    <span className="text-[10px] font-mono text-amber-800 mt-0.5">{cd}s cooldown</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Silent Radio TTS Fallback Callouts */}
                      <div className="pt-2 border-t border-stoneline/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                            <span>🤫</span> Silent Radio Callouts (TTS)
                          </span>
                          <span className="text-[10px] text-ink-muted">Plays squelch + speech on all phones</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {SILENT_RADIO_CALLOUTS.map((callout) => (
                            <button
                              key={callout}
                              type="button"
                              onClick={() => handleSendSilentRadioTTS(callout)}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white hover:bg-subtle border border-stoneline text-[11px] font-semibold text-ink transition"
                            >
                              {callout}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={120}
                            value={silentRadioInput}
                            onChange={(e) => setSilentRadioInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSendSilentRadioTTS();
                              }
                            }}
                            placeholder="Type a silent tactical radio callout..."
                            className="flex-1 h-10 px-3 rounded-xl bg-white border border-stoneline text-xs font-medium text-ink focus:outline-none focus:border-cedar"
                          />
                          <button
                            type="button"
                            disabled={!silentRadioInput.trim()}
                            onClick={() => handleSendSilentRadioTTS()}
                            className="btn-cedar h-10 px-3.5 rounded-xl text-xs font-bold disabled:opacity-40"
                          >
                            Send Radio
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Tactical Abilities Sub-Section */}
                    {!isHunter ? (
                      <div className="p-4 rounded-xl bg-canvas border border-stoneline text-xs text-ink-secondary space-y-3">
                        <div>
                          <strong className="text-ink block">Hider Tactical Abilities &amp; Status</strong>
                          <p className="mt-0.5">
                            Keep your sound enabled (<strong className="text-emerald-800">Sound Active 🔊</strong>) so you hear the <strong>Proximity Heartbeat Radar</strong> when a Hunter gets within 40m of you, as well as Hunter siren pings.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          {catchMode === 'CATCH_PIN' && snapshot.viewerCatchPin && (
                            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950">
                              <span className="block text-[10px] uppercase font-bold text-amber-800">2-Digit Catch PIN</span>
                              <span className="font-mono font-extrabold text-lg tracking-widest text-hunter">{snapshot.viewerCatchPin}</span>
                              <span className="block text-[11px] text-amber-900">Give this code to a Hunter only when physically caught.</span>
                            </div>
                          )}

                          <div className="p-2.5 rounded-xl bg-white border border-stoneline flex-1 min-w-[200px] flex items-center justify-between gap-2">
                            <div>
                              <strong className="text-ink block">👻 Ghost Cloak (60s Stealth)</strong>
                              <span className="text-[11px] text-ink-muted">
                                {snapshot.viewerGhostCloak?.active
                                  ? `Cloaked! Hidden from Hunters (${snapshot.viewerGhostCloak.secondsLeft}s left)`
                                  : snapshot.viewerGhostCloak?.used
                                  ? 'Already used in this match (limit: 1)'
                                  : 'Freezes & hides your location from Hunters for 60s'}
                              </span>
                            </div>
                            {!snapshot.viewerGhostCloak?.used && !snapshot.viewerGhostCloak?.active && (
                              <button
                                type="button"
                                disabled={snapshot.state !== 'ACTIVE' || me?.status !== 'ACTIVE'}
                                onClick={() => {
                                  soundEngine.playGhostCloakTone();
                                  dispatchGameAction(
                                    { action: 'ACTIVATE_GHOST_CLOAK' },
                                    '👻 Ghost Cloak Activated for 60s!'
                                  );
                                }}
                                className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-purple-800 hover:bg-purple-900 text-white font-bold text-xs shrink-0 disabled:opacity-40"
                              >
                                Activate
                              </button>
                            )}
                          </div>
                        </div>

                        {me?.photoRequest?.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={() => {
                              setCapturedPhotoUrl(null);
                              setCameraStreamError(null);
                              setShowCameraModal(true);
                            }}
                            className="btn-hunter px-4 py-2.5 rounded-xl text-xs font-bold"
                          >
                            📷 Respond to Active Photo Request ({me.photoRequest.expiresInSeconds}s left)
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-canvas border border-stoneline flex items-center justify-between text-xs">
                          <div>
                            <strong className="text-ink block">
                              Sound Alerts Remaining: {snapshot.soundAbility?.remainingUses ?? 0} / {snapshot.soundAbility?.maxUses ?? 3}
                            </strong>
                            <span className="text-ink-muted">
                              {snapshot.state !== 'ACTIVE'
                                ? 'Tools unlock once the hiding countdown ends'
                                : (snapshot.soundAbility?.cooldownSecondsLeft || 0) > 0
                                ? `Cooldown: ${snapshot.soundAbility?.cooldownSecondsLeft}s remaining`
                                : 'Ready to trigger a 4-second siren on an active Hider'}
                            </span>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-hunter-light text-hunter font-bold">
                            {snapshot.settings.photoRequestsPerHider ?? 1} Photo(s) / Hider
                          </span>
                        </div>

                        <div className="space-y-2">
                          {snapshot.participants
                            .filter((p) => p.role === 'HIDER')
                            .map((h) => {
                              const isCaught = h.status !== 'ACTIVE';
                              const sa = snapshot.soundAbility;
                              const soundDisabled =
                                snapshot.state !== 'ACTIVE' ||
                                isCaught ||
                                !sa ||
                                sa.remainingUses <= 0 ||
                                sa.cooldownSecondsLeft > 0;
                              const pr = h.photoRequest;
                              const remPhotos = h.remainingPhotoRequests ?? (pr ? 0 : snapshot.settings.photoRequestsPerHider ?? 1);

                              return (
                                <div key={h.id} className="p-3 rounded-xl bg-canvas border border-stoneline flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <span className="font-bold text-xs text-ink">{h.nickname}</span>
                                    <span className="text-[11px] text-ink-muted block">
                                      {h.audioUnlocked ? '🔊 Sound Active on phone' : '🔇 Sound not unlocked yet'}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={soundDisabled}
                                      onClick={async () => {
                                        const res = await dispatchGameAction({ action: 'SEND_SOUND', targetHiderId: h.id });
                                        if (res?.deliveryStatus) showToast(res.deliveryStatus, 'info');
                                      }}
                                      className="btn-hunter min-h-[40px] px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
                                    >
                                      🔊 Send 4s Siren
                                    </button>

                                    {pr && pr.hasPhoto && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (pr.photoDataUrl) {
                                            setViewerPhotoModal({ nickname: h.nickname, url: pr.photoDataUrl });
                                          } else if (roomCode && activePlayerId) {
                                            await fetchGameState(roomCode, activePlayerId, true);
                                            const cached = photoCacheRef.current.get(pr.id);
                                            if (cached) {
                                              setViewerPhotoModal({ nickname: h.nickname, url: cached });
                                            }
                                          }
                                        }}
                                        className="btn-cedar min-h-[40px] px-3 py-1.5 rounded-lg text-[11px] font-bold"
                                      >
                                        📷 View Photo
                                      </button>
                                    )}

                                    {pr && pr.status === 'PENDING' ? (
                                      <span className="px-2.5 py-2 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold font-mono">
                                        ⏳ Waiting ({pr.expiresInSeconds}s)
                                      </span>
                                    ) : remPhotos > 0 ? (
                                      <button
                                        type="button"
                                        disabled={isCaught || snapshot.state !== 'ACTIVE'}
                                        onClick={() =>
                                          dispatchGameAction(
                                            { action: 'REQUEST_PHOTO', targetHiderId: h.id },
                                            `Photo request sent to ${h.nickname}! (90s timer started)`
                                          )
                                        }
                                        className="btn-secondary min-h-[40px] px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40"
                                      >
                                        📷 Request photo ({remPhotos} left)
                                      </button>
                                    ) : (
                                      <span className="px-2.5 py-2 rounded-lg bg-stone-200 text-stone-700 text-[11px] font-semibold">
                                        {pr ? `Photo: ${pr.status}` : 'No photos left'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: PLAYERS */}
                {activeTab === 'players' && (
                  <div className="space-y-2">
                    {snapshot.participants.map((p) => {
                      const isMe = p.id === activePlayerId;
                      const showCaptureButton =
                        p.status === 'ACTIVE' &&
                        (p.role === 'HIDER' || (isMe && snapshot.viewerRole === 'HIDER')) &&
                        (isHunter || isHost || isMe);

                      const distanceToPlayerMeters =
                        !isMe && me?.location && p.location && snapshot.state === 'ACTIVE'
                          ? Math.round(calculateDistanceMeters(me.location.lat, me.location.lng, p.location.lat, p.location.lng))
                          : null;

                      const captureEnabled =
                        snapshot.state === 'ACTIVE' &&
                        (isMe ||
                          catchMode !== 'PROXIMITY_20M' ||
                          (isGpsActiveAndConsented && Boolean(me?.location)));

                      return (
                        <div key={p.id} className="p-3 rounded-xl bg-canvas border border-stoneline flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs" style={{ background: p.color }}>
                              {p.nickname.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-ink flex items-center gap-1.5 flex-wrap">
                                <span>{p.nickname}</span>
                                {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cedar-light text-cedar font-bold">You</span>}
                                {p.role === 'HUNTER' ? (
                                  <span className="px-2 py-0.5 rounded-full bg-hunter-light text-hunter font-bold text-[11px]">Hunter</span>
                                ) : p.role === 'HIDER' ? (
                                  <span className="px-2 py-0.5 rounded-full bg-cedar-light text-cedar font-bold text-[11px]">Hider</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 font-semibold text-[11px]">Role Hidden</span>
                                )}
                                {p.status === 'CAPTURED' && (
                                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold">Caught</span>
                                )}
                                {p.ghostCloakActive && !p.isOutOfBoundsExposed && (
                                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 text-[10px] font-bold">
                                    👻 Cloaked ({p.ghostCloakSecondsLeft}s)
                                  </span>
                                )}
                                {p.isOutOfBoundsExposed && (
                                  <span className="px-2 py-0.5 rounded-full bg-red-200 text-red-900 text-[10px] font-bold">
                                    🚨 Out-of-Bounds Exposed
                                  </span>
                                )}
                                {distanceToPlayerMeters !== null && (
                                  <span
                                    className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                                      distanceToPlayerMeters <= MAX_CAPTURE_DISTANCE_METERS
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-amber-100 text-amber-900'
                                    }`}
                                  >
                                    {distanceToPlayerMeters}m away
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-ink-muted block">
                                {isHunterMapLocked && !isMe
                                  ? 'Hiding phase — location hidden until countdown ends'
                                  : p.ghostCloakActive && !isMe && !p.isOutOfBoundsExposed
                                  ? '👻 Ghost Cloak active — GPS hidden for 60s'
                                  : p.location
                                  ? `±${p.location.accuracy}m • updated ${p.location.ageSeconds}s ago`
                                  : p.status === 'CAPTURED'
                                  ? 'Caught — GPS stopped'
                                  : 'Location hidden or waiting for GPS'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {p.location && !isHunterMapLocked && (
                              <button
                                type="button"
                                onClick={() => setGameCenterCmd({ lat: p.location!.lat, lng: p.location!.lng, zoom: 17, ts: Date.now() })}
                                className="btn-secondary min-h-[40px] px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                              >
                                Focus
                              </button>
                            )}
                            {showCaptureButton && (
                              <button
                                type="button"
                                disabled={!captureEnabled}
                                title={
                                  snapshot.state !== 'ACTIVE'
                                    ? 'Capture is disabled until the countdown ends and the game is active'
                                    : !captureEnabled
                                    ? 'Enable GPS or Manual Tap-to-Locate to capture players'
                                    : 'Confirm capture'
                                }
                                onClick={() => {
                                  setCapturePinInput('');
                                  setPendingCaptureTarget(p);
                                }}
                                className="btn-hunter min-h-[40px] px-3.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {isMe ? 'I Was Caught' : 'Mark Caught'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* TAB 3: LIVE FEED */}
                {activeTab === 'feed' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📋</span>
                        <div>
                          <h3 className="font-display font-bold text-xs sm:text-sm text-ink">
                            Live Notes &amp; Activity Feed
                          </h3>
                          <p className="text-[11px] text-ink-muted">
                            Broadcast instant text notes &amp; sound alerts to all players’ screens (6s top banner + chime)
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_NOTE_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={pendingActionKey === 'SEND_NOTE'}
                          onClick={() => handleSendNote(preset)}
                          className="min-h-[36px] px-2.5 py-1 rounded-xl bg-canvas hover:bg-subtle border border-stoneline text-[11px] font-semibold text-ink transition disabled:opacity-50"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendNote();
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        maxLength={140}
                        value={noteInput}
                        onChange={(e) => setNoteInput(e.target.value)}
                        placeholder="Write a live note or alert to all players..."
                        className="flex-1 h-11 px-3.5 rounded-xl bg-canvas border border-stoneline text-xs font-medium text-ink focus:outline-none focus:border-cedar"
                      />
                      <button
                        type="submit"
                        disabled={!noteInput.trim() || pendingActionKey === 'SEND_NOTE'}
                        className="btn-cedar h-11 px-4 rounded-xl text-xs font-bold shrink-0 disabled:opacity-45"
                      >
                        {pendingActionKey === 'SEND_NOTE' ? '⏳...' : '🔔 Send Note'}
                      </button>
                    </form>

                    {snapshot.events && snapshot.events.length > 0 && (
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 pt-1.5 border-t border-stoneline">
                        {[...snapshot.events]
                          .slice()
                          .reverse()
                          .map((evt) => (
                            <div
                              key={evt.id}
                              className="p-2.5 rounded-xl bg-canvas border border-stoneline text-xs flex items-start justify-between gap-2"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <strong className="font-bold text-ink">{evt.senderName}</strong>
                                  {evt.senderRole && (
                                    <span
                                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                        evt.senderRole === 'HUNTER'
                                          ? 'bg-hunter-light text-hunter'
                                          : 'bg-cedar-light text-cedar'
                                      }`}
                                    >
                                      {evt.senderRole}
                                    </span>
                                  )}
                                </div>
                                <p className="text-ink-secondary font-medium leading-snug">{evt.message}</p>
                              </div>
                              <span className="text-[10px] font-mono text-ink-muted shrink-0">
                                {new Date(evt.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: SAFETY & HOST */}
                {activeTab === 'safety' && (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-canvas border border-stoneline text-xs text-ink-secondary leading-relaxed">
                      <strong className="text-ink block mb-1">Campus Safety &amp; Screen Wake Lock</strong>
                      Stay on lit walkways and open campus plazas. Keep this screen open—Screen Wake Lock (☀️ Awake) automatically prevents your phone from sleeping during active play so your GPS and audio alerts remain live.
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                      {isHost && (
                        <button
                          type="button"
                          onClick={() => dispatchGameAction({ action: 'TOGGLE_PAUSE' })}
                          className="btn-secondary px-4 py-2.5 rounded-xl text-xs font-bold"
                        >
                          {snapshot.state === 'PAUSED' ? 'Resume Game' : 'Pause Game'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => dispatchGameAction({ action: 'EMERGENCY_STOP' }, 'Game stopped immediately. All live GPS sharing ended.')}
                        className="min-h-[44px] px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold"
                      >
                        Emergency Stop Game
                      </button>
                      <button type="button" onClick={handleLeaveGame} className="btn-secondary px-4 py-2.5 rounded-xl text-xs font-semibold ml-auto">
                        Leave &amp; Stop GPS
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

        {snapshot && snapshot.state === 'FINISHED' && (
          <section className="flex-1 flex flex-col justify-center py-4">
            <div className="aui-card p-6 sm:p-8 text-center max-w-lg w-full mx-auto space-y-5">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cedar-light text-cedar text-xs font-bold uppercase tracking-wider">
                <span>🏁 Match Complete • Victory Summary</span>
              </div>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-ink">
                {snapshot.winnerTeam === 'HUNTERS'
                  ? '🏆 Hunters Win!'
                  : snapshot.winnerTeam === 'HIDERS'
                  ? '🏆 Hiders Win!'
                  : 'Game Ended Early'}
              </h2>
              <p className="text-sm text-ink-secondary font-medium">{snapshot.winReason}</p>

              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <div className="p-3 rounded-xl bg-canvas border border-stoneline">
                  <span className="text-ink-muted block">Round Limit</span>
                  <span className="font-mono font-bold text-base text-ink mt-0.5 block">{snapshot.settings.durationMinutes} mins</span>
                </div>
                <div className="p-3 rounded-xl bg-canvas border border-stoneline">
                  <span className="text-ink-muted block">Hiders Caught</span>
                  <span className="font-mono font-bold text-base text-ink mt-0.5 block">
                    {snapshot.capturedHiders} / {snapshot.totalHiders}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-canvas border border-stoneline">
                  <span className="text-ink-muted block">GPS &amp; Photos</span>
                  <span className="font-bold text-emerald-700 text-xs mt-1 block">Purged ✓</span>
                </div>
              </div>

              {snapshot.capturesLog && snapshot.capturesLog.length > 0 && (
                <div className="text-left">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                    Capture Log (Who Caught Whom)
                  </h3>
                  <div className="space-y-1.5">
                    {snapshot.capturesLog.map((entry, idx) => (
                      <div
                        key={entry.id}
                        className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-hunter text-white font-mono font-bold text-[10px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="text-ink">
                            <strong className="text-hunter font-bold">{entry.hunterNickname}</strong> caught{' '}
                            <strong className="text-cedar font-bold">{entry.hiderNickname}</strong>
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-ink-muted">
                          {new Date(entry.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-left">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">Final Player Roster</h3>
                <div className="space-y-2">
                  {snapshot.participants.map((p) => (
                    <div key={p.id} className="p-3 rounded-xl bg-canvas border border-stoneline flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold" style={{ background: p.color }}>
                          {p.nickname.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-ink block">{p.nickname}</span>
                          {p.role === 'HIDER' && p.status === 'CAPTURED' && p.capturedByNickname && (
                            <span className="text-[11px] text-ink-muted">Caught by {p.capturedByNickname}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded-full font-bold ${p.role === 'HUNTER' ? 'bg-hunter-light text-hunter' : 'bg-cedar-light text-cedar'}`}>
                          {p.role}
                        </span>
                        {p.role === 'HUNTER' ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px]">
                            🎯 {p.capturesCount || 0} caught
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                              p.status === 'CAPTURED'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {p.status === 'CAPTURED' ? 'Caught' : 'Survived Free 🏆'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex flex-col sm:flex-row gap-3">
                {isHost ? (
                  <button
                    type="button"
                    disabled={pendingActionKey === 'REMATCH'}
                    onClick={() =>
                      dispatchGameAction(
                        { action: 'REMATCH' },
                        'Returned to Lobby! Adjust rules or mark Ready for the next round.'
                      )
                    }
                    className="btn-cedar min-h-[52px] py-3.5 px-6 rounded-2xl font-display font-bold text-sm flex-1 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {pendingActionKey === 'REMATCH' ? '⏳ Resetting Lobby...' : '🔄 Reset to Lobby (Play Again)'}
                  </button>
                ) : (
                  <div className="p-3 rounded-2xl bg-cedar-subtle border border-cedar/25 text-xs text-cedar font-semibold flex-1 flex items-center justify-center">
                    Waiting for Host to tap “Reset to Lobby (Play Again)”...
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleLeaveGame}
                  className="btn-secondary min-h-[52px] py-3.5 px-5 rounded-2xl font-display font-bold text-sm flex-1"
                >
                  Leave Game
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Capture Confirmation Modal (z-index: 99999) */}
      {pendingCaptureTarget && snapshot && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="aui-modal-backdrop"
        >
          <div
            style={{
              maxHeight: '90dvh',
              width: 'min(92vw, 480px)',
              overflowY: 'auto',
            }}
            className="aui-card aui-modal-box p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-hunter">Capture Verification</span>
                <h3 className="font-display font-bold text-lg text-ink">
                  {pendingCaptureTarget.id === activePlayerId
                    ? 'Confirm You Were Caught?'
                    : `Confirm Capture of ${pendingCaptureTarget.nickname}?`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingCaptureTarget(null)}
                className="btn-secondary min-h-[40px] px-3 py-1 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-canvas border border-stoneline text-xs space-y-3">
              <p className="text-ink-secondary leading-relaxed">
                {pendingCaptureTarget.id === activePlayerId
                  ? 'Confirming will mark you as Caught and immediately stop your live GPS sharing for the remainder of the match.'
                  : catchMode === 'CATCH_PIN'
                  ? `Enter ${pendingCaptureTarget.nickname}’s 2-Digit Catch PIN shown on their phone screen to confirm the physical capture.`
                  : catchMode === 'INSTANT_TAP'
                  ? `Instant Hunter Tap mode is active. Confirm below if you have physically tagged ${pendingCaptureTarget.nickname}.`
                  : `Capturing ${pendingCaptureTarget.nickname} requires active gameplay, location enabled, and a physical proximity within ${MAX_CAPTURE_DISTANCE_METERS}m.`}
              </p>

              {pendingCaptureTarget.id !== activePlayerId && catchMode === 'CATCH_PIN' && (
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    Enter {pendingCaptureTarget.nickname}’s 2-Digit Catch PIN *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={capturePinInput}
                    onChange={(e) => setCapturePinInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                    placeholder="00"
                    className="w-full h-14 px-4 rounded-xl bg-white border-2 border-cedar font-mono font-extrabold text-2xl tracking-widest text-center text-ink focus:outline-none"
                  />
                </div>
              )}

              {pendingCaptureTarget.id !== activePlayerId && catchMode === 'PROXIMITY_20M' && (
                <div
                  className={`p-2.5 rounded-lg border font-semibold flex items-center justify-between ${
                    pendingCaptureDistanceMeters === null
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : pendingCaptureDistanceMeters <= MAX_CAPTURE_DISTANCE_METERS
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <span>Proximity check (max {MAX_CAPTURE_DISTANCE_METERS}m):</span>
                  <span className="font-mono font-bold">
                    {pendingCaptureDistanceMeters !== null
                      ? `${pendingCaptureDistanceMeters}m ${
                          pendingCaptureDistanceMeters <= MAX_CAPTURE_DISTANCE_METERS ? '✓ Within range' : '✕ Too far'
                        }`
                      : 'Awaiting target GPS fix'}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-stoneline flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCaptureTarget(null)}
                className="btn-secondary px-4 py-2.5 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  pendingActionKey === 'MARK_CAUGHT' ||
                  isPendingCaptureTooFar ||
                  (pendingCaptureTarget.id !== activePlayerId &&
                    catchMode === 'CATCH_PIN' &&
                    capturePinInput.trim().length !== 2)
                }
                onClick={async () => {
                  const target = pendingCaptureTarget;
                  const pin = capturePinInput.trim();
                  const isPinRequired = target.id !== activePlayerId && catchMode === 'CATCH_PIN';
                  if (!isPinRequired) {
                    setPendingCaptureTarget(null);
                    setCapturePinInput('');
                  }
                  const res = await dispatchGameAction(
                    {
                      action: 'MARK_CAUGHT',
                      targetHiderId: target.id,
                      ...(isPinRequired ? { catchPin: pin } : {}),
                    },
                    `${target.nickname} marked as caught!`
                  );
                  if (res && isPinRequired) {
                    setPendingCaptureTarget(null);
                    setCapturePinInput('');
                  }
                }}
                className="btn-hunter px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pendingActionKey === 'MARK_CAUGHT' ? '⏳ Confirming...' : 'Confirm Capture'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Request & Camera Modal (z-index: 99999) */}
      {showCameraModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="aui-modal-backdrop"
        >
          <div
            style={{
              maxHeight: '90dvh',
              width: 'min(92vw, 480px)',
              overflowY: 'auto',
            }}
            className="aui-card aui-modal-box p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-hunter">Photo Request</span>
                  {me?.photoRequest?.status === 'PENDING' && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-mono font-bold text-[11px]">
                      ⏱ {me.photoRequest.expiresInSeconds}s left
                    </span>
                  )}
                </div>
                <h3 className="font-display font-bold text-lg text-ink">Share a Quick Campus Photo</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopCameraStream();
                  setShowCameraModal(false);
                }}
                className="btn-secondary min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-ink-secondary leading-relaxed">
              Take a quick photo of your surroundings using your phone camera or select an image. You will see an instant preview before tapping <strong>Submit Photo</strong>.
            </p>

            {/* Primary guaranteed mobile camera input (capture="environment") */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="btn-cedar min-h-[48px] px-4 py-3 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-2 text-center shadow-sm">
                <span>📷 Open Phone Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoFileSelect}
                  className="hidden"
                />
              </label>
              <label className="btn-secondary min-h-[48px] px-4 py-3 rounded-xl text-xs font-semibold cursor-pointer flex items-center justify-center gap-2 text-center">
                <span>🖼️ Choose Photo / File</span>
                <input type="file" accept="image/*" onChange={handlePhotoFileSelect} className="hidden" />
              </label>
            </div>

            {photoCompressing && (
              <div className="p-4 rounded-xl bg-canvas border border-stoneline text-center text-xs font-semibold text-cedar">
                Optimizing photo preview...
              </div>
            )}

            {/* Instant Preview of Captured/Selected Photo */}
            {!cameraStreamActive && capturedPhotoUrl && (
              <div className="space-y-2">
                <div className="relative w-full h-52 rounded-2xl overflow-hidden bg-canvas border-2 border-cedar shadow-sm">
                  <img src={capturedPhotoUrl} alt="Captured preview" className="w-full h-full object-cover" />
                  <span className="absolute top-2 left-2 px-2.5 py-1 rounded-lg bg-emerald-800/90 text-white text-[11px] font-bold">
                    ✓ Photo Ready to Submit
                  </span>
                </div>
              </div>
            )}

            {/* Live getUserMedia stream ONLY shown when active (never shows an empty black box on failure) */}
            {cameraStreamActive && (
              <div className="space-y-2">
                <div className="relative w-full h-52 rounded-2xl overflow-hidden bg-stone-900 border border-stoneline">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={snapCameraFrame}
                    className="btn-cedar min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold flex-1"
                  >
                    📸 Snap Photo Now
                  </button>
                  <button
                    type="button"
                    onClick={stopCameraStream}
                    className="btn-secondary min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold"
                  >
                    Cancel Stream
                  </button>
                </div>
              </div>
            )}

            {/* Friendly placeholder when no photo is chosen yet */}
            {!cameraStreamActive && !capturedPhotoUrl && !photoCompressing && (
              <div className="p-4 rounded-2xl bg-canvas border border-dashed border-stoneline text-center space-y-2">
                <p className="text-xs font-semibold text-ink">
                  Tap <strong>“Open Phone Camera”</strong> above for instant native camera capture on iPhone &amp; Android.
                </p>
                {cameraStreamError ? (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    {cameraStreamError}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={startBrowserCamera}
                    className="text-xs font-semibold text-cedar underline hover:text-cedar-hover py-1"
                  >
                    Or try in-browser webcam stream
                  </button>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-stoneline flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={declinePhotoRequest}
                className="min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Decline Request
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCameraStream();
                    setShowCameraModal(false);
                  }}
                  className="btn-secondary min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={!capturedPhotoUrl || photoCompressing}
                  onClick={submitCapturedPhoto}
                  className="btn-hunter min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Submit Photo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hunter Photo Intel Viewer Modal (z-index: 99999) */}
      {viewerPhotoModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="aui-modal-backdrop"
        >
          <div
            style={{
              maxHeight: '90dvh',
              width: 'min(92vw, 480px)',
              overflowY: 'auto',
            }}
            className="aui-card aui-modal-box p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-cedar">Private Hunter Intel</span>
                <h3 className="font-display font-bold text-lg text-ink">Photo from {viewerPhotoModal.nickname}</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewerPhotoModal(null)}
                className="btn-secondary min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <div className="w-full h-64 rounded-2xl overflow-hidden bg-canvas border border-stoneline">
              <img src={viewerPhotoModal.url} alt="Submitted Hider Photo" className="w-full h-full object-cover" />
            </div>
            <p className="text-xs text-ink-muted">
              Stored privately for this match only. Automatically purged when the game finishes.
            </p>
          </div>
        </div>
      )}

      {/* Install App Modal (z-index: 99999) */}
      {showInstallModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="aui-modal-backdrop"
        >
          <div
            style={{
              maxHeight: '90dvh',
              width: 'min(92vw, 480px)',
              overflowY: 'auto',
            }}
            className="aui-card aui-modal-box p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-cedar">Add to Home Screen</span>
                <h3 className="font-display font-bold text-lg text-ink">Install AUI Manhunt App</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                className="btn-secondary min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 text-xs text-ink-secondary leading-relaxed">
              <div className="p-4 rounded-2xl bg-canvas border border-stoneline space-y-2">
                <strong className="text-ink font-display text-sm block">🍎 iPhone &amp; iPad (Safari)</strong>
                <div className="p-2.5 rounded-xl bg-white border border-stoneline font-semibold text-ink">
                  1. Tap the Share button in Safari 📤
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-stoneline font-semibold text-ink">
                  2. Select &ldquo;Add to Home Screen&rdquo; ➕
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-canvas border border-stoneline space-y-1.5">
                <strong className="text-ink font-display text-sm block">🤖 Android (Chrome)</strong>
                <p>
                  Tap the browser menu <strong>(⋮)</strong> in the top corner and select <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </p>
              </div>
              <p className="text-[11px] text-ink-muted">
                Installing AUI Manhunt launches it full-screen like a native campus app and keeps Screen Wake Lock (☀️ Awake) active during the hunt.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Stack (z-index: 100000) */}
      <div
        style={{ zIndex: 100000 }}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 max-w-sm w-[92%] pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 rounded-2xl border shadow-lg text-xs font-semibold flex items-center justify-between gap-3 ${
              t.tone === 'error'
                ? 'bg-red-800 text-white border-red-900'
                : t.tone === 'warning'
                ? 'bg-amber-800 text-white border-amber-900'
                : 'bg-ink text-white border-stone-800'
            }`}
          >
            <span className="leading-snug">{t.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Close notification"
              className="shrink-0 w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center text-white font-bold text-sm leading-none transition"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
