export interface SequenceStats {
  received: number;
  dropped: number;
  duplicates: number;
  outOfOrder: number;
  /** 0..1 fraction of packets lost over the whole session. */
  lossRatio: number;
}

/**
 * Tracks u16 sequence numbers per device. Returns whether a packet should be processed.
 * Late (out-of-order) packets are reported but not processed — a motion sample from the past
 * is useless for a real-time pipeline. Large forward jumps (reconnect / reboot) reset tracking.
 */
export class SequenceTracker {
  private last: number | null = null;
  readonly stats: SequenceStats = { received: 0, dropped: 0, duplicates: 0, outOfOrder: 0, lossRatio: 0 };

  constructor(
    private readonly modulo = 65536,
    private readonly resetGap = 1000,
  ) {}

  /** @returns 'accept' | 'duplicate' | 'late' */
  track(seq: number): 'accept' | 'duplicate' | 'late' {
    this.stats.received++;
    if (this.last === null) {
      this.last = seq;
      return 'accept';
    }
    const diff = (seq - this.last + this.modulo) % this.modulo;
    if (diff === 0) {
      this.stats.duplicates++;
      return 'duplicate';
    }
    if (diff > this.modulo / 2) {
      // negative wrap -> older than last
      if (this.modulo - diff > this.resetGap) {
        this.last = seq; // device rebooted / reconnected
        return 'accept';
      }
      this.stats.outOfOrder++;
      return 'late';
    }
    if (diff > 1) {
      if (diff > this.resetGap) {
        this.last = seq;
        return 'accept';
      }
      this.stats.dropped += diff - 1;
    }
    this.last = seq;
    const expected = this.stats.received + this.stats.dropped - this.stats.duplicates;
    this.stats.lossRatio = expected > 0 ? this.stats.dropped / expected : 0;
    return 'accept';
  }

  reset(): void {
    this.last = null;
  }
}
