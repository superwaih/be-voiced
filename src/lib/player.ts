import { useEffect, useSyncExternalStore } from "react";

type TimeListener = (t: number) => void;

interface PlayerSnapshot {
  playing: boolean;
  duration: number;
  error: boolean;
  ready: boolean;
}

/**
 * One media element is mounted at a time (workspace or editor). Continuous time goes to
 * subscribers through requestAnimationFrame and is applied to the DOM directly; React only
 * re-renders on discrete state (play/pause, duration, errors).
 */
class PlayerController {
  el: HTMLMediaElement | null = null;
  private timeListeners = new Set<TimeListener>();
  private stateListeners = new Set<() => void>();
  private raf = 0;
  private stopAt: number | null = null;
  private loopRange: { start: number; end: number } | null = null;
  private snapshot: PlayerSnapshot = { playing: false, duration: 0, error: false, ready: false };
  private cleanup: (() => void) | null = null;
  private pendingSeek: number | null = null;

  attach(el: HTMLMediaElement) {
    if (this.el === el) return;
    this.detach();
    this.el = el;
    const update = () => {
      this.setSnapshot({
        playing: !el.paused && !el.ended,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        error: !!el.error,
        ready: el.readyState >= 1,
      });
    };
    const onMeta = () => {
      if (this.pendingSeek !== null) {
        el.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
      update();
      this.emitTime();
    };
    const events = ["play", "pause", "ended", "durationchange", "error", "emptied"] as const;
    events.forEach((e) => el.addEventListener(e, update));
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("seeked", this.emitTime);
    this.cleanup = () => {
      events.forEach((e) => el.removeEventListener(e, update));
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("seeked", this.emitTime);
    };
    update();
    this.loop();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.cleanup?.();
    this.cleanup = null;
    this.el = null;
    this.stopAt = null;
    this.loopRange = null;
    this.setSnapshot({ playing: false, duration: 0, error: false, ready: false });
  }

  private loop = () => {
    const el = this.el;
    if (!el) return;
    if (!el.paused) {
      if (this.loopRange && el.currentTime >= this.loopRange.end) {
        el.currentTime = this.loopRange.start;
      } else if (this.stopAt !== null && el.currentTime >= this.stopAt) {
        el.pause();
        el.currentTime = this.stopAt;
        this.stopAt = null;
      }
      this.emitTime();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private emitTime = () => {
    const t = this.el?.currentTime ?? 0;
    this.timeListeners.forEach((fn) => fn(t));
  };

  private setSnapshot(next: PlayerSnapshot) {
    const s = this.snapshot;
    if (s.playing === next.playing && s.duration === next.duration && s.error === next.error && s.ready === next.ready) return;
    this.snapshot = next;
    this.stateListeners.forEach((fn) => fn());
  }

  get time() {
    return this.el?.currentTime ?? 0;
  }

  play() {
    const el = this.el;
    if (!el) return;
    if (this.loopRange && (el.currentTime < this.loopRange.start || el.currentTime >= this.loopRange.end - 0.05)) {
      el.currentTime = this.loopRange.start;
    }
    void el.play().catch(() => undefined);
  }

  pause() {
    this.el?.pause();
  }

  toggle() {
    if (!this.el) return;
    if (this.el.paused) this.play();
    else this.pause();
  }

  seek(t: number) {
    const el = this.el;
    if (!el) {
      this.pendingSeek = t;
      return;
    }
    if (el.readyState < 1) {
      this.pendingSeek = t;
      return;
    }
    el.currentTime = Math.max(0, Math.min(t, Number.isFinite(el.duration) ? el.duration : t));
    this.emitTime();
  }

  skip(delta: number) {
    this.seek(this.time + delta);
  }

  /** Play a range once and stop at its end. */
  playRange(start: number, end: number) {
    this.loopRange = null;
    this.stopAt = end;
    this.seek(start);
    void this.el?.play().catch(() => undefined);
  }

  /** Keep playback inside a range (clip editor). */
  setLoopRange(range: { start: number; end: number } | null) {
    this.loopRange = range;
    this.stopAt = null;
  }

  onTime(fn: TimeListener) {
    this.timeListeners.add(fn);
    fn(this.time);
    return () => {
      this.timeListeners.delete(fn);
    };
  }

  subscribeState = (fn: () => void) => {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  };

  getState = () => this.snapshot;
}

export const player = new PlayerController();

export function usePlayerState() {
  return useSyncExternalStore(player.subscribeState, player.getState);
}

/** Subscribe a DOM-updating callback to playback time without re-rendering React. */
export function usePlayerTime(fn: TimeListener, deps: unknown[] = []) {
  useEffect(() => player.onTime(fn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}
