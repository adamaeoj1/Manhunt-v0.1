'use client';

/**
 * Pure Web Audio API Synthesizer for AUI Campus Manhunt.
 * Generates 100% procedural audio without any external .mp3 or .wav files.
 * Compatible with iOS Safari, Android Chrome, and desktop browsers.
 */
class ManhuntSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private unlocked = false;
  private autoUnlockBound = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.registerGlobalAutoUnlock();
    }
  }

  /**
   * Registers global first-interaction listeners (pointerdown, touchstart, click, keydown)
   * so that the very first touch/click anywhere on the page creates & resumes the shared AudioContext.
   */
  public registerGlobalAutoUnlock(): void {
    if (typeof window === 'undefined' || this.autoUnlockBound) return;
    this.autoUnlockBound = true;

    const unlockHandler = () => {
      try {
        const ctx = this.getOrCreateContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (!this.unlocked) {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(this.getDestination(ctx));
          source.start(0);
          this.unlocked = true;
        }
        if (ctx.state === 'running') {
          window.removeEventListener('pointerdown', unlockHandler, true);
          window.removeEventListener('touchstart', unlockHandler, true);
          window.removeEventListener('click', unlockHandler, true);
          window.removeEventListener('keydown', unlockHandler, true);
        }
      } catch {}
    };

    window.addEventListener('pointerdown', unlockHandler, { capture: true, passive: true });
    window.addEventListener('touchstart', unlockHandler, { capture: true, passive: true });
    window.addEventListener('click', unlockHandler, { capture: true, passive: true });
    window.addEventListener('keydown', unlockHandler, { capture: true, passive: true });
  }

  private getOrCreateContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    this.registerGlobalAutoUnlock();
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private async ensureContextRunning(): Promise<AudioContext | null> {
    const ctx = this.getOrCreateContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }
    this.unlocked = true;
    return ctx;
  }

  private getDestination(ctx: AudioContext): AudioNode {
    if (!this.masterGain || this.masterGain.context !== ctx) {
      try {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-14, ctx.currentTime);
        compressor.knee.setValueAtTime(18, ctx.currentTime);
        compressor.ratio.setValueAtTime(4, ctx.currentTime);
        compressor.attack.setValueAtTime(0.003, ctx.currentTime);
        compressor.release.setValueAtTime(0.15, ctx.currentTime);

        this.masterGain = ctx.createGain();
        this.masterGain.gain.setValueAtTime(1.35, ctx.currentTime);
        this.masterGain.connect(compressor);
        compressor.connect(ctx.destination);
      } catch {
        return ctx.destination;
      }
    }
    return this.masterGain;
  }

  /**
   * Automatically schedule disconnection and cleanup of Web Audio nodes
   * immediately when playback ends to completely prevent memory leaks.
   */
  private scheduleNodeCleanup(
    sourceNode: AudioScheduledSourceNode | AudioNode,
    nodesToDisconnect: (AudioNode | null | undefined)[],
    durationSeconds = 1.0
  ): void {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        if ('disconnect' in sourceNode) sourceNode.disconnect();
      } catch {}
      nodesToDisconnect.forEach((node) => {
        if (node) {
          try {
            node.disconnect();
          } catch {}
        }
      });
    };

    if ('onended' in sourceNode) {
      (sourceNode as AudioScheduledSourceNode).onended = cleanup;
    }
    setTimeout(cleanup, Math.ceil((durationSeconds + 0.15) * 1000));
  }

  public isUnlocked(): boolean {
    return this.unlocked || Boolean(this.ctx && this.ctx.state === 'running');
  }

  /**
   * Unlocks mobile browser audio on a direct user tap and immediately plays
   * a clear, rising Activation Chime.
   */
  public unlockAndPlayActivationChime(): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // Play a 1-frame silent buffer first to unlock iOS Safari audio hardware
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.getDestination(ctx));
      source.start(0);

      this.unlocked = true;
      this.playActivationChime();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Activation Chime: Clear rising major arpeggio (C5 -> E5 -> G5 -> C6).
   */
  public playActivationChime(): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.09;
        const duration = 0.22;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.65, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + duration);
        this.scheduleNodeCleanup(osc, [gain], idx * 0.09 + duration);
      });

      this.vibrate([80]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Live Note / Activity Alert Chime:
   * Crisp two-tone tactical notification ping played when a new note or game event arrives.
   */
  public playNoteAlertChime(): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const notes = [
        { freq: 659.25, offset: 0, dur: 0.13 },
        { freq: 987.77, offset: 0.14, dur: 0.22 },
      ];
      notes.forEach(({ freq, offset, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + offset;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.62, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur);
        this.scheduleNodeCleanup(osc, [gain], offset + dur);
      });

      this.vibrate([100, 50, 120]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hunter Sound Alert / Siren:
   * Loud, unmistakable alternating siren oscillating between 600Hz and 1200Hz
   * for 4 full seconds, paired with tactical vibration pattern.
   */
  public playHunterSiren(durationSeconds = 4.0): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const subOsc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      subOsc.type = 'square';

      const cycleDuration = 0.4;
      const totalCycles = Math.ceil(durationSeconds / cycleDuration);

      for (let i = 0; i < totalCycles; i++) {
        const tLow = now + i * cycleDuration;
        const tHigh = tLow + cycleDuration / 2;
        if (tLow < now + durationSeconds) {
          osc.frequency.setValueAtTime(600, tLow);
          osc.frequency.linearRampToValueAtTime(1200, tHigh);
          subOsc.frequency.setValueAtTime(600, tLow);
        }
        if (tHigh < now + durationSeconds) {
          osc.frequency.setValueAtTime(1200, tHigh);
          osc.frequency.linearRampToValueAtTime(600, Math.min(now + durationSeconds, tLow + cycleDuration));
          subOsc.frequency.setValueAtTime(1200, tHigh);
        }
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.85, now + 0.05);
      gain.gain.setValueAtTime(0.85, Math.max(now + 0.06, now + durationSeconds - 0.15));
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationSeconds);

      osc.connect(gain);
      subOsc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      subOsc.start(now);
      osc.stop(now + durationSeconds);
      subOsc.stop(now + durationSeconds);

      this.scheduleNodeCleanup(osc, [gain], durationSeconds);
      this.scheduleNodeCleanup(subOsc, [], durationSeconds);

      this.vibrate([400, 150, 400, 150, 600]);
      return true;
    } catch {
      return false;
    }
  }

  public playSiren(durationSeconds = 4.0): boolean {
    return this.playHunterSiren(durationSeconds);
  }

  /**
   * Proximity Heartbeat ("lub-dub" low-frequency pulse) for Hiders when a Hunter
   * is within 40m (<20m = CRITICAL fast pulse, 20m-40m = NEAR steady pulse).
   */
  public playHeartbeatPulse(intensity: 'NEAR' | 'CRITICAL' = 'NEAR'): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const peakGain = intensity === 'CRITICAL' ? 0.65 : 0.42;
      const baseFreq = intensity === 'CRITICAL' ? 95 : 75;

      // Two-beat "lub-dub" pulse
      const beats = [
        { offset: 0, dur: 0.11, freqStart: baseFreq + 25, freqEnd: baseFreq - 15, amp: peakGain },
        { offset: 0.15, dur: 0.13, freqStart: baseFreq + 15, freqEnd: baseFreq - 20, amp: peakGain * 0.85 },
      ];

      beats.forEach(({ offset, dur, freqStart, freqEnd, amp }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + offset;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqStart, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(35, freqEnd), start + dur);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(amp, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur);
        this.scheduleNodeCleanup(osc, [gain], offset + dur);
      });

      if (intensity === 'CRITICAL') {
        this.vibrate([60, 50, 60]);
      }
      return true;
    } catch {
      return false;
    }
  }

  public playHeartbeat(intensity: 'NEAR' | 'CRITICAL' = 'NEAR'): boolean {
    return this.playHeartbeatPulse(intensity);
  }

  /**
   * Ghost Cloak Activation Tone: Stealthy sci-fi shimmer sound when Hider cloaks for 60s.
   */
  public playGhostCloakTone(): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const notes = [587.33, 440, 329.63, 293.66];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.07;
        const dur = 0.2;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur);
        this.scheduleNodeCleanup(osc, [gain], idx * 0.07 + dur);
      });

      this.vibrate([120, 60, 120]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Photo Request Alert: Urgent double-chime notification when a Hunter requests a photo.
   */
  public playPhotoRequestAlert(): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const pattern = [
        { freq: 880, offset: 0, dur: 0.14 },
        { freq: 1174.66, offset: 0.16, dur: 0.18 },
        { freq: 880, offset: 0.42, dur: 0.14 },
        { freq: 1174.66, offset: 0.58, dur: 0.24 },
      ];

      pattern.forEach(({ freq, offset, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + offset;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.7, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur);
        this.scheduleNodeCleanup(osc, [gain], offset + dur);
      });

      this.vibrate([250, 100, 250]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Countdown Tick: Short beep for the final 10 seconds of the hiding countdown.
   */
  public playCountdownTick(secondsLeft: number): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const isFinalSecond = secondsLeft <= 1;
      const isLastFive = secondsLeft <= 5;
      const freq = isFinalSecond ? 1046.5 : isLastFive ? 880 : 740;
      const dur = isFinalSecond ? 0.28 : 0.13;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(isLastFive ? 0.65 : 0.5, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + dur);
      this.scheduleNodeCleanup(osc, [gain], dur);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Game Start / End Fanfare: Clear multi-note signal when the hunt begins or finishes.
   */
  public playGameTransitionTone(type: 'START' | 'FINISH'): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const notes =
        type === 'START'
          ? [440, 554.37, 659.25, 880]
          : [880, 659.25, 554.37, 440];

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.11;
        const dur = 0.24;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.65, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur);
        this.scheduleNodeCleanup(osc, [gain], idx * 0.11 + dur);
      });

      this.vibrate(type === 'START' ? [200, 100, 300] : [300, 120, 300]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Celebratory Victory / Game Over Fanfare played when the match finishes.
   */
  public playVictoryFanfare(winnerTeam: 'HUNTERS' | 'HIDERS' | 'NONE' | null = 'HUNTERS'): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      if (winnerTeam === 'NONE') {
        return this.playGameTransitionTone('FINISH');
      }

      // Triumphant brass-style fanfare (C5 -> E5 -> G5 -> C6 chord finale)
      const fanfareNotes = [
        { freqs: [523.25, 261.63], offset: 0, dur: 0.14 },
        { freqs: [659.25, 329.63], offset: 0.16, dur: 0.14 },
        { freqs: [783.99, 392.0], offset: 0.32, dur: 0.16 },
        { freqs: [1046.5, 659.25, 523.25], offset: 0.5, dur: 0.65 },
      ];

      fanfareNotes.forEach(({ freqs, offset, dur }) => {
        const start = now + offset;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.6, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        gain.connect(dest);

        freqs.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          osc.type = idx === 0 ? 'triangle' : 'sawtooth';
          osc.frequency.setValueAtTime(f, start);
          osc.connect(gain);
          osc.start(start);
          osc.stop(start + dur);
          this.scheduleNodeCleanup(osc, idx === 0 ? [gain] : [], offset + dur);
        });
      });

      this.vibrate([160, 80, 160, 80, 420]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Walkie-Talkie Radio Squelch + PTT Chirp:
   * Realistic bandpass-filtered white noise burst + tactical two-tone chirp.
   */
  public playRadioSquelch(phase: 'START' | 'END' = 'START'): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;
      const noiseDur = 0.14;
      const sampleRate = ctx.sampleRate;
      const frameCount = Math.max(1, Math.floor(sampleRate * noiseDur));
      const noiseBuffer = ctx.createBuffer(1, frameCount, sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < frameCount; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.65;
      }

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1350, now);
      filter.Q.setValueAtTime(1.4, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.01, now);
      noiseGain.gain.linearRampToValueAtTime(0.5, now + 0.02);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(dest);
      noiseSource.start(now);
      noiseSource.stop(now + noiseDur);
      this.scheduleNodeCleanup(noiseSource, [filter, noiseGain], noiseDur);

      // PTT Chirp tones
      const tones = phase === 'START' ? [1420, 1880] : [1880, 1320];
      tones.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + 0.03 + idx * 0.045;
        const dur = 0.045;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.42, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur);
        this.scheduleNodeCleanup(osc, [gain], 0.03 + idx * 0.045 + dur);
      });

      this.vibrate(phase === 'START' ? [45] : [30, 30]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Plays an incoming or outgoing Walkie-Talkie voice clip with radio squelch
   * and optional Voice Disguise (pitch shift + bandpass filter).
   * Decodes Base64 to ArrayBuffer and plays via Web Audio API AudioBufferSourceNode
   * to guarantee bypass of browser autoplay policies on iOS Safari & Android Chrome.
   */
  public async playWalkieTalkieAudio(
    base64DataUrl: string,
    disguisePitch = false,
    onEnded?: () => void
  ): Promise<boolean> {
    this.playRadioSquelch('START');

    const finishPlayback = () => {
      this.playRadioSquelch('END');
      if (onEnded) onEnded();
    };

    try {
      const ctx = await this.ensureContextRunning();
      const dest = ctx ? this.getDestination(ctx) : null;
      if (!base64DataUrl || base64DataUrl === 'SYNTH_VOICE' || !base64DataUrl.startsWith('data:audio')) {
        // Fallback synthesized walkie-talkie voice cadence when mic hardware is unavailable
        if (ctx && dest) {
          const now = ctx.currentTime + 0.16;
          const syllables = disguisePitch
            ? [190, 215, 175, 230, 165, 205]
            : [310, 360, 290, 390, 280, 340];
          syllables.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            const start = now + idx * 0.22;
            const dur = 0.17;

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, start);
            osc.frequency.linearRampToValueAtTime(freq * 0.92, start + dur);

            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(disguisePitch ? 950 : 1350, start);
            filter.Q.setValueAtTime(1.2, start);

            gain.gain.setValueAtTime(0.001, start);
            gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(dest);
            osc.start(start);
            osc.stop(start + dur);
            this.scheduleNodeCleanup(osc, [filter, gain], idx * 0.22 + dur);
          });
        }
        setTimeout(finishPlayback, 1650);
        return true;
      }

      // Convert Base64 data URL to ArrayBuffer for Web Audio API decodeAudioData
      const commaIdx = base64DataUrl.indexOf(',');
      const base64 = commaIdx >= 0 ? base64DataUrl.slice(commaIdx + 1) : base64DataUrl;
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      if (ctx && dest) {
        try {
          const decodedBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = decodedBuffer;
          source.playbackRate.value = disguisePitch ? 0.78 : 1.0;

          const radioFilter = ctx.createBiquadFilter();
          radioFilter.type = 'bandpass';
          radioFilter.frequency.setValueAtTime(disguisePitch ? 980 : 1450, ctx.currentTime);
          radioFilter.Q.setValueAtTime(0.85, ctx.currentTime);

          const boostGain = ctx.createGain();
          boostGain.gain.setValueAtTime(1.75, ctx.currentTime);

          source.connect(radioFilter);
          radioFilter.connect(boostGain);
          boostGain.connect(dest);

          source.onended = () => {
            try {
              source.disconnect();
              radioFilter.disconnect();
              boostGain.disconnect();
            } catch {}
            finishPlayback();
          };
          source.start(ctx.currentTime + 0.12);
          this.scheduleNodeCleanup(
            source,
            [radioFilter, boostGain],
            decodedBuffer.duration / (disguisePitch ? 0.78 : 1.0) + 0.5
          );
          return true;
        } catch {
          // Fall through to HTMLAudioElement fallback if decodeAudioData encounters codec issues
        }
      }

      const audioEl = new Audio(base64DataUrl);
      audioEl.volume = 1.0;
      const anyAudio = audioEl as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      if (disguisePitch) {
        anyAudio.preservesPitch = false;
        anyAudio.mozPreservesPitch = false;
        anyAudio.webkitPreservesPitch = false;
        audioEl.playbackRate = 0.78;
      }
      audioEl.onended = () => finishPlayback();
      audioEl.onerror = () => finishPlayback();
      await audioEl.play();
      return true;
    } catch {
      finishPlayback();
      return false;
    }
  }

  /**
   * Alias for backwards compatibility.
   */
  public async playWalkieAudioMessage(
    audioDataUrl: string,
    disguised = false,
    onEnded?: () => void
  ): Promise<boolean> {
    return this.playWalkieTalkieAudio(audioDataUrl, disguised, onEnded);
  }

  /**
   * Silent Radio Text-to-Speech (TTS) Fallback:
   * Speaks a quick tactical radio message using the browser's native SpeechSynthesis API,
   * preceded and followed by realistic walkie-talkie radio squelch tones.
   */
  public playSilentRadioTTS(
    text: string,
    disguised = false,
    onEnded?: () => void
  ): boolean {
    this.playRadioSquelch('START');

    const cleanText = text.trim();
    if (!cleanText) {
      this.playRadioSquelch('END');
      if (onEnded) onEnded();
      return false;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'en-US';
        utterance.pitch = disguised ? 0.65 : 1.05;
        utterance.rate = disguised ? 0.92 : 1.08;
        utterance.volume = 1.0;

        utterance.onend = () => {
          this.playRadioSquelch('END');
          if (onEnded) onEnded();
        };
        utterance.onerror = () => {
          this.playRadioSquelch('END');
          if (onEnded) onEnded();
        };

        window.speechSynthesis.speak(utterance);
        return true;
      } catch {
        this.playRadioSquelch('END');
        if (onEnded) onEnded();
        return false;
      }
    } else {
      // Fallback to procedural radio syllables
      this.playWalkieTalkieAudio('SYNTH_VOICE', disguised, onEnded);
      return true;
    }
  }

  /**
   * Quick Taunt Soundboard Synthesizer:
   * Generates distinct, loud procedural audio for each of the 4 Quick Taunts.
   */
  public playTauntSound(
    tauntType: 'CATCH_ME' | 'I_SEE_YOU' | 'AIRHORN' | 'TOO_SLOW'
  ): boolean {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const dest = this.getDestination(ctx);

      const now = ctx.currentTime;

      if (tauntType === 'CATCH_ME') {
        // Playful 5-note "Catch Me If You Can!" melody (G5 - E5 - A5 - G5 - E5)
        const melody = [
          { freq: 783.99, offset: 0, dur: 0.16 },
          { freq: 659.25, offset: 0.18, dur: 0.16 },
          { freq: 880.0, offset: 0.36, dur: 0.22 },
          { freq: 783.99, offset: 0.6, dur: 0.18 },
          { freq: 659.25, offset: 0.8, dur: 0.32 },
        ];
        melody.forEach(({ freq, offset, dur }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const start = now + offset;
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.linearRampToValueAtTime(0.58, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
          osc.connect(gain);
          gain.connect(dest);
          osc.start(start);
          osc.stop(start + dur);
          this.scheduleNodeCleanup(osc, [gain], offset + dur);
        });
        this.vibrate([90, 50, 90, 50, 140]);
      } else if (tauntType === 'I_SEE_YOU') {
        // Suspenseful radar-lock double sting ("I See You!")
        const stings = [
          { f1: 554.37, f2: 587.33, offset: 0, dur: 0.25 },
          { f1: 783.99, f2: 830.61, offset: 0.3, dur: 0.48 },
        ];
        stings.forEach(({ f1, f2, offset, dur }) => {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();
          const start = now + offset;
          osc1.type = 'sawtooth';
          osc2.type = 'triangle';
          osc1.frequency.setValueAtTime(f1, start);
          osc2.frequency.setValueAtTime(f2, start);
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.linearRampToValueAtTime(0.65, start + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(dest);
          osc1.start(start);
          osc2.start(start);
          osc1.stop(start + dur);
          osc2.stop(start + dur);
          this.scheduleNodeCleanup(osc1, [gain], offset + dur);
          this.scheduleNodeCleanup(osc2, [], offset + dur);
        });
        this.vibrate([180, 90, 260]);
      } else if (tauntType === 'AIRHORN') {
        // Classic multi-oscillator stadium Airhorn (short - short - loooong)
        const blasts = [
          { offset: 0, dur: 0.14 },
          { offset: 0.18, dur: 0.14 },
          { offset: 0.36, dur: 0.68 },
        ];
        const chordFreqs = [370.0, 466.16, 554.37, 740.0];
        blasts.forEach(({ offset, dur }) => {
          const start = now + offset;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.linearRampToValueAtTime(0.75, start + 0.015);
          gain.gain.setValueAtTime(0.7, Math.max(start + 0.02, start + dur - 0.06));
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
          gain.connect(dest);

          chordFreqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq * 0.97, start);
            osc.frequency.linearRampToValueAtTime(freq, start + 0.03);
            osc.connect(gain);
            osc.start(start);
            osc.stop(start + dur);
            this.scheduleNodeCleanup(osc, idx === 0 ? [gain] : [], offset + dur);
          });
        });
        this.vibrate([120, 60, 120, 60, 400]);
      } else {
        // TOO_SLOW: Fast zippy whoosh + playful descending slide
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.18);
        osc.frequency.exponentialRampToValueAtTime(340, now + 0.58);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.65, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + 0.6);
        this.scheduleNodeCleanup(osc, [gain], 0.65);
        this.vibrate([70, 40, 180]);
      }

      return true;
    } catch {
      return false;
    }
  }

  public vibrate(pattern: number | number[]): void {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {}
  }
}

export const soundEngine = new ManhuntSoundEngine();
