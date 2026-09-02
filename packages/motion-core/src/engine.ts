import { PacketType, SequenceTracker, type DevicePacket, type MotionPacket } from '@aero/protocol';
import { ControllerProcessor, emptyState } from './processor';
import type { ControllerId, ControllerMotionState, GestureEvent, MotionConfig, MotionSensitivity } from './types';
import { DEFAULT_MOTION_CONFIG, configForSensitivity } from './types';

export type MotionEngineEvents = {
  state: (state: ControllerMotionState) => void;
  gesture: (event: GestureEvent) => void;
  connection: (controllerId: ControllerId, connected: boolean) => void;
};

type Listener<K extends keyof MotionEngineEvents> = MotionEngineEvents[K];

/**
 * The single entry point for all motion data — real controllers and the simulator both feed
 * packets in here. Everything downstream (actions, activities) only sees states and gestures.
 */
export class MotionEngine {
  private readonly processors = new Map<ControllerId, ControllerProcessor>();
  private readonly sequences = new Map<ControllerId, SequenceTracker>();
  private readonly lastDeviceTs = new Map<ControllerId, number>();
  private readonly listeners: { [K in keyof MotionEngineEvents]: Set<Listener<K>> } = {
    state: new Set(),
    gesture: new Set(),
    connection: new Set(),
  };
  private config: MotionConfig;
  /** No packet for this long (host ms) → the controller is considered gone. */
  staleMs = 2000;

  constructor(config: MotionConfig = DEFAULT_MOTION_CONFIG) {
    this.config = config;
    this.processors.set(1, new ControllerProcessor(1, config));
    this.processors.set(2, new ControllerProcessor(2, config));
    this.sequences.set(1, new SequenceTracker());
    this.sequences.set(2, new SequenceTracker());
  }

  on<K extends keyof MotionEngineEvents>(event: K, cb: Listener<K>): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  setSensitivity(level: MotionSensitivity['level']): void {
    this.config = configForSensitivity(level);
    for (const p of this.processors.values()) p.config = this.config;
  }

  setConfig(config: MotionConfig): void {
    this.config = config;
    for (const p of this.processors.values()) p.config = config;
  }

  getConfig(): MotionConfig {
    return this.config;
  }

  /**
   * Feed any decoded device packet. Non-motion packets are ignored here (the controller
   * manager handles INFO/CALIBRATION); duplicates and late packets are dropped.
   * @returns the new state when a motion packet was processed.
   */
  ingest(packet: DevicePacket, controllerId?: ControllerId): ControllerMotionState | null {
    if (packet.type !== PacketType.MOTION) return null;
    const id = (controllerId ?? (packet.deviceId as ControllerId)) as ControllerId;
    if (id !== 1 && id !== 2) return null;
    const seq = this.sequences.get(id)!;
    // Device clock went backwards by a lot -> the controller rebooted; sequence numbers restart.
    const lastTs = this.lastDeviceTs.get(id);
    if (lastTs !== undefined && packet.timestamp < lastTs - 500) seq.reset();
    this.lastDeviceTs.set(id, packet.timestamp);
    if (seq.track(packet.sequence) !== 'accept') return null;
    const proc = this.processors.get(id)!;
    const wasConnected = proc.state.connected;
    const state = proc.process(packet as MotionPacket, (e) => this.emit('gesture', e));
    if (!wasConnected) this.emit('connection', id, true);
    this.emit('state', state);
    return state;
  }

  /** Called by the controller manager when a transport disconnects or the stream goes stale. */
  markDisconnected(id: ControllerId): void {
    const proc = this.processors.get(id)!;
    if (!proc.state.connected) return;
    proc.markDisconnected();
    this.sequences.get(id)!.reset();
    this.lastDeviceTs.delete(id);
    this.emit('connection', id, false);
    this.emit('state', proc.state);
  }

  /** Mark controllers stale when no packet arrived for `staleMs`. Call from a timer. */
  checkStale(nowHostMs: number): void {
    for (const [id, proc] of this.processors) {
      if (proc.state.connected && nowHostMs - proc.state.hostTime > this.staleMs) this.markDisconnected(id);
    }
  }

  setNeutral(id?: ControllerId): void {
    if (id) this.processors.get(id)!.setNeutral();
    else for (const p of this.processors.values()) p.setNeutral();
  }

  getState(id: ControllerId): ControllerMotionState {
    return this.processors.get(id)?.state ?? emptyState(id);
  }

  getProcessor(id: ControllerId): ControllerProcessor {
    return this.processors.get(id)!;
  }

  getSequenceStats(id: ControllerId) {
    return this.sequences.get(id)!.stats;
  }

  connectedIds(): ControllerId[] {
    return ([1, 2] as ControllerId[]).filter((id) => this.processors.get(id)!.state.connected);
  }

  private emit<K extends keyof MotionEngineEvents>(event: K, ...args: Parameters<MotionEngineEvents[K]>): void {
    for (const cb of this.listeners[event]) (cb as (...a: Parameters<MotionEngineEvents[K]>) => void)(...args);
  }
}
