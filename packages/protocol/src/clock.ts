/**
 * Maps device millis (u32, wraps) to host time, tracking drift with a slow filter.
 * Also produces a latency estimate = host arrival − predicted send time.
 */
export class DeviceClock {
  private offset: number | null = null; // hostTime − deviceTime
  private lastDevice = 0;
  private wraps = 0;
  private minOffset = Infinity;
  latencyMs = 0;

  private unwrap(deviceMs: number): number {
    if (deviceMs < this.lastDevice - 0x7fffffff) this.wraps++;
    this.lastDevice = deviceMs;
    return deviceMs + this.wraps * 0x100000000;
  }

  /** @returns device timestamp expressed on the host clock. */
  sync(deviceMs: number, hostMs: number): number {
    const d = this.unwrap(deviceMs);
    const offset = hostMs - d;
    if (this.offset === null) {
      this.offset = offset;
      this.minOffset = offset;
    } else {
      // The smallest observed offset is the one with least transport delay.
      if (offset < this.minOffset) this.minOffset = offset;
      // Drift: slowly let minOffset relax upward so clock drift does not lock latency at 0 forever.
      this.minOffset += 0.0005;
      this.offset = this.minOffset;
    }
    this.latencyMs = Math.max(0, offset - this.offset);
    return d + this.offset;
  }

  reset(): void {
    this.offset = null;
    this.minOffset = Infinity;
    this.wraps = 0;
    this.lastDevice = 0;
    this.latencyMs = 0;
  }
}
