'use client';

/**
 * Screen Wake Lock API manager to prevent mobile phone screens from dimming or locking
 * during active Manhunt gameplay so GPS updates and sound alerts stay active.
 */
class ScreenWakeLockManager {
  private sentinel: any = null;
  private shouldKeepAwake = false;

  public async acquire(): Promise<boolean> {
    this.shouldKeepAwake = true;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return false;
    }
    try {
      if (this.sentinel && !this.sentinel.released) {
        return true;
      }
      this.sentinel = await (navigator as any).wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  public async release(): Promise<void> {
    this.shouldKeepAwake = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {}
      this.sentinel = null;
    }
  }

  public async handleVisibilityRestore(): Promise<boolean> {
    if (this.shouldKeepAwake && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      return this.acquire();
    }
    return false;
  }

  public isActive(): boolean {
    return Boolean(this.sentinel && !this.sentinel.released);
  }
}

export const wakeLockManager = new ScreenWakeLockManager();
