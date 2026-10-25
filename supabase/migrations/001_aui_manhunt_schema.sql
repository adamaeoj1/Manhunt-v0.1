-- ============================================================================
-- AUI CAMPUS MANHUNT (AL AKHAWAYN UNIVERSITY, IFRANE)
-- Production PostgreSQL Schema, Secret Role Isolation & Row Level Security
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) NOT NULL UNIQUE,
  title VARCHAR(60) NOT NULL DEFAULT 'AUI Campus Manhunt',
  state VARCHAR(20) NOT NULL DEFAULT 'LOBBY'
    CHECK (state IN ('LOBBY', 'COUNTDOWN', 'ACTIVE', 'PAUSED', 'FINISHED')),
  host_participant_id UUID,
  hunter_count INT NOT NULL DEFAULT 1 CHECK (hunter_count >= 1 AND hunter_count <= 4),
  duration_minutes INT NOT NULL DEFAULT 20 CHECK (duration_minutes >= 5 AND duration_minutes <= 90),
  countdown_seconds INT NOT NULL DEFAULT 10 CHECK (countdown_seconds >= 0 AND countdown_seconds <= 120),
  sound_uses_per_hunter INT NOT NULL DEFAULT 3 CHECK (sound_uses_per_hunter >= 1 AND sound_uses_per_hunter <= 10),
  sound_cooldown_seconds INT NOT NULL DEFAULT 90 CHECK (sound_cooldown_seconds >= 30 AND sound_cooldown_seconds <= 300),
  boundary_lat DOUBLE PRECISION NOT NULL DEFAULT 33.5395,
  boundary_lng DOUBLE PRECISION NOT NULL DEFAULT -5.1058,
  boundary_radius_m INT NOT NULL DEFAULT 260 CHECK (boundary_radius_m >= 80 AND boundary_radius_m <= 1500),
  countdown_ends_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  paused_remaining_ms INT,
  winner_team VARCHAR(20) CHECK (winner_team IN ('HUNTERS', 'HIDERS', 'NONE')),
  win_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  nickname VARCHAR(24) NOT NULL,
  avatar_color VARCHAR(16) NOT NULL DEFAULT '#14532D',
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CAPTURED', 'LEFT')),
  gps_consent BOOLEAN NOT NULL DEFAULT FALSE,
  gps_denied BOOLEAN NOT NULL DEFAULT FALSE,
  audio_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, nickname)
);

CREATE TABLE IF NOT EXISTS public.participant_roles (
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  role VARCHAR(12) NOT NULL CHECK (role IN ('HUNTER', 'HIDER')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, participant_id)
);

CREATE TABLE IF NOT EXISTS public.participant_locations (
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng >= -180 AND lng <= 180),
  accuracy_m INT NOT NULL CHECK (accuracy_m > 0),
  outside_meters INT NOT NULL DEFAULT 0,
  is_outside BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, participant_id)
);

CREATE TABLE IF NOT EXISTS public.sound_ability_usage (
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  hunter_participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  cooldown_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, hunter_participant_id)
);

CREATE TABLE IF NOT EXISTS public.sound_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  hunter_participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  target_participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  delivery_status VARCHAR(64) NOT NULL DEFAULT 'SENT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.photo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  hunter_participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  target_participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SUBMITTED', 'DECLINED', 'EXPIRED')),
  storage_path TEXT,
  photo_data_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  CONSTRAINT unique_one_photo_request_per_hider_per_game UNIQUE (game_id, target_participant_id)
);

CREATE OR REPLACE FUNCTION public.cleanup_sensitive_game_data()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.state = 'FINISHED' AND OLD.state IS DISTINCT FROM 'FINISHED' THEN
    DELETE FROM public.participant_locations WHERE game_id = NEW.id;
    UPDATE public.photo_requests
       SET photo_data_url = NULL,
           storage_path = NULL
     WHERE game_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_sensitive_game_data ON public.games;
CREATE TRIGGER trg_cleanup_sensitive_game_data
AFTER UPDATE ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_sensitive_game_data();

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sound_ability_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sound_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on games" ON public.games FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on participants" ON public.participants FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on participant_roles" ON public.participant_roles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on participant_locations" ON public.participant_locations FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on sound_ability_usage" ON public.sound_ability_usage FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on sound_alerts" ON public.sound_alerts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on photo_requests" ON public.photo_requests FOR ALL USING (auth.role() = 'service_role');
