import {
  CommandId,
  DeviceClock,
  PacketStreamDecoder,
  PacketType,
  encodeCommandPacket,
  encodeSetNameArgs,
  type CalibrationPacket,
  type DevicePacket,
  type FactoryResultPacket,
  type InfoPacket,
  CalibrationState,
} from '@aero/protocol';
import type { ControllerId, MotionEngine } from '@aero/motion-core';
import type { ControllerTransport, TransportKind, TransportState } from './transport/types';
import { BluetoothTransport } from './transport/bluetooth';
import { SerialTransport } from './transport/serial';
import { SimulatorTransport } from './transport/simulator';
import { HidTransport } from './transport/hid';

export type CalibrationPhase = 'none' | 'hold-still' | 'calibrating' | 'ready' | 'failed';

export interface ControllerSlotState {
  id: ControllerId;
  transportKind: TransportKind | null;
  transportState: TransportState;
  transportName: string | null;
  transportId: string | null;
  error: string | null;
  /** Live stream flowing (packets in the last ~2 s). */
  streaming: boolean;
  calibration: CalibrationPhase;
  battery: number | null;
  info: InfoPacket | null;
  lastCalibration: CalibrationPacket | null;
  factory: FactoryResultPacket | null;
  packetRateHz: number;
  latencyMs: number;
  lossRatio: number;
  crcErrors: number;
  lastPacketAt: number;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  controllerId: ControllerId | null;
  message: string;
}

type Listener = (slots: Record<ControllerId, ControllerSlotState>) => void;

function emptySlot(id: ControllerId): ControllerSlotState {
  return {
    id,
    transportKind: null,
    transportState: 'disconnected',
    transportName: null,
    transportId: null,
    error: null,
    streaming: false,
    calibration: 'none',
    battery: null,
    info: null,
    lastCalibration: null,
    factory: null,
    packetRateHz: 0,
    latencyMs: 0,
    lossRatio: 0,
    crcErrors: 0,
    lastPacketAt: 0,
  };
}

/**
 * Owns the two controller slots. Each slot has at most one transport. Bytes → packets →
 * MotionEngine, plus INFO/CALIBRATION/FACTORY bookkeeping and commands to the device.
 * UI state is published at a throttled rate; motion consumers subscribe to the engine directly.
 */
export class ControllerManager {
  readonly slots: Record<ControllerId, ControllerSlotState> = { 1: emptySlot(1), 2: emptySlot(2) };
  private transports: Partial<Record<ControllerId, ControllerTransport>> = {};
  private decoders: Partial<Record<ControllerId, PacketStreamDecoder>> = {};
  private clocks: Record<ControllerId, DeviceClock> = { 1: new DeviceClock(), 2: new DeviceClock() };
  private unsubscribers: Partial<Record<ControllerId, Array<() => void>>> = {};
  private listeners = new Set<Listener>();
  private packetListeners = new Set<(id: ControllerId, p: DevicePacket) => void>();
  private logListeners = new Set<(e: LogEntry) => void>();
  readonly log: LogEntry[] = [];
  private publishTimer: number | null = null;
  private staleTimer: number | null = null;
  private rateCounters: Record<ControllerId, number[]> = { 1: [], 2: [] };

  constructor(readonly engine: MotionEngine) {
    if (typeof window !== 'undefined') {
      this.staleTimer = window.setInterval(() => this.tickStale(), 500);
    }
    engine.on('connection', (id, connected) => {
      this.slots[id].streaming = connected;
      if (!connected) this.slots[id].packetRateHz = 0;
      this.publish();
    });
  }

  // ---------- subscriptions ----------
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  onPacket(cb: (id: ControllerId, p: DevicePacket) => void): () => void {
    this.packetListeners.add(cb);
    return () => this.packetListeners.delete(cb);
  }

  onLog(cb: (e: LogEntry) => void): () => void {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }

  snapshot(): Record<ControllerId, ControllerSlotState> {
    return { 1: { ...this.slots[1] }, 2: { ...this.slots[2] } };
  }

  getTransport(id: ControllerId): ControllerTransport | undefined {
    return this.transports[id];
  }

  getSimulator(id: ControllerId): SimulatorTransport | undefined {
    const t = this.transports[id];
    return t instanceof SimulatorTransport ? t : undefined;
  }

  // ---------- connect / disconnect ----------
  createTransport(kind: TransportKind, id: ControllerId): ControllerTransport {
    switch (kind) {
      case 'bluetooth':
        return new BluetoothTransport();
      case 'serial':
        return new SerialTransport();
      case 'hid':
        return new HidTransport();
      case 'simulator':
        return new SimulatorTransport(id);
    }
  }

  /** Connect a slot using a fresh transport of the given kind (must be called from a user gesture for BLE/Serial). */
  async connect(id: ControllerId, kind: TransportKind): Promise<void> {
    await this.attach(id, this.createTransport(kind, id));
  }

  /** Attach an existing transport instance (e.g. re-acquired permitted BLE device). */
  async attach(id: ControllerId, transport: ControllerTransport): Promise<void> {
    await this.detach(id, false);
    this.transports[id] = transport;
    const slot = this.slots[id];
    slot.transportKind = transport.kind;
    slot.error = null;
    slot.calibration = 'none';
    slot.factory = null;
    this.clocks[id].reset();
    const decoder = new PacketStreamDecoder(
      (p) => this.handlePacket(id, p),
      (e) => {
        if (e.reason === 'bad_crc') slot.crcErrors++;
      },
    );
    this.decoders[id] = decoder;
    const unsubs: Array<() => void> = [];
    unsubs.push(transport.onData((bytes, t) => decoder.push(bytes, t)));
    unsubs.push(
      transport.onStateChange((state, error) => {
        slot.transportState = state;
        slot.transportName = transport.info.name ?? null;
        slot.transportId = transport.info.id ?? null;
        if (error) {
          slot.error = error;
          this.pushLog('error', id, error);
        } else this.pushLog('info', id, `transport ${state}`);
        if (state !== 'connected') {
          this.engine.markDisconnected(id);
          slot.streaming = false;
          if (state === 'disconnected' || state === 'error') slot.calibration = 'none';
        }
        this.publish();
      }),
    );
    this.unsubscribers[id] = unsubs;
    this.publish();
    try {
      await transport.connect();
      slot.transportName = transport.info.name ?? null;
      slot.transportId = transport.info.id ?? null;
      this.pushLog('info', id, `connected via ${transport.kind} (${transport.info.name ?? 'unnamed'})`);
      // Ask for identity right away; firmware also sends INFO periodically.
      void this.sendCommand(id, CommandId.GET_INFO).catch(() => undefined);
    } catch (e) {
      slot.error = (e as Error).message;
      slot.transportState = 'error';
      this.publish();
      throw e;
    }
    this.publish();
  }

  async disconnect(id: ControllerId): Promise<void> {
    await this.detach(id, true);
  }

  async forget(id: ControllerId): Promise<void> {
    const t = this.transports[id];
    if (t instanceof BluetoothTransport || t instanceof SerialTransport) await t.forget();
    await this.detach(id, true);
  }

  private async detach(id: ControllerId, publish: boolean): Promise<void> {
    const t = this.transports[id];
    if (t) {
      try {
        await t.disconnect();
      } catch {
        /* ignore */
      }
    }
    for (const u of this.unsubscribers[id] ?? []) u();
    delete this.unsubscribers[id];
    delete this.transports[id];
    delete this.decoders[id];
    this.engine.markDisconnected(id);
    this.slots[id] = { ...emptySlot(id) };
    if (publish) this.publish();
  }

  /** Swap the two slots (device 1 becomes controller 2 and vice-versa) without reconnecting. */
  swap(): void {
    const t1 = this.transports[1];
    const t2 = this.transports[2];
    const d1 = this.decoders[1];
    const d2 = this.decoders[2];
    const u1 = this.unsubscribers[1];
    const u2 = this.unsubscribers[2];
    const s1 = this.slots[1];
    const s2 = this.slots[2];
    this.transports = { 1: t2, 2: t1 };
    this.decoders = { 1: d2, 2: d1 };
    this.unsubscribers = { 1: u2, 2: u1 };
    this.slots[1] = { ...s2, id: 1 };
    this.slots[2] = { ...s1, id: 2 };
    // Rebind decoders so packets route to the new slot ids.
    for (const id of [1, 2] as ControllerId[]) {
      const d = this.decoders[id];
      const t = this.transports[id];
      if (!d || !t) continue;
      for (const u of this.unsubscribers[id] ?? []) u();
      const decoder = new PacketStreamDecoder((p) => this.handlePacket(id, p));
      this.decoders[id] = decoder;
      this.unsubscribers[id] = [
        t.onData((bytes, at) => decoder.push(bytes, at)),
        t.onStateChange((state, error) => {
          this.slots[id].transportState = state;
          if (error) this.slots[id].error = error;
          if (state !== 'connected') this.engine.markDisconnected(id);
          this.publish();
        }),
      ];
    }
    this.engine.markDisconnected(1);
    this.engine.markDisconnected(2);
    this.pushLog('info', null, 'swapped controller slots');
    this.publish();
  }

  // ---------- commands ----------
  async sendCommand(id: ControllerId, command: CommandId, args?: Uint8Array | number[]): Promise<void> {
    const t = this.transports[id];
    if (!t || t.state !== 'connected') throw new Error(`Controller ${id} is not connected`);
    await t.send(encodeCommandPacket(command, args));
  }

  async recalibrate(id: ControllerId): Promise<void> {
    this.slots[id].calibration = 'hold-still';
    this.publish();
    await this.sendCommand(id, CommandId.RECALIBRATE);
    this.pushLog('info', id, 'recalibration requested');
  }

  async identify(id: ControllerId): Promise<void> {
    await this.sendCommand(id, CommandId.IDENTIFY);
  }

  async setDeviceId(id: ControllerId, newId: ControllerId): Promise<void> {
    await this.sendCommand(id, CommandId.SET_DEVICE_ID, [newId]);
  }

  async setDeviceName(id: ControllerId, name: string): Promise<void> {
    await this.sendCommand(id, CommandId.SET_NAME, encodeSetNameArgs(name));
  }

  async runFactoryTest(id: ControllerId): Promise<void> {
    this.slots[id].factory = null;
    this.publish();
    await this.sendCommand(id, CommandId.FACTORY_TEST);
  }

  async factoryReset(id: ControllerId): Promise<void> {
    await this.sendCommand(id, CommandId.RESET_FACTORY);
  }

  async reboot(id: ControllerId): Promise<void> {
    await this.sendCommand(id, CommandId.REBOOT);
  }

  /** Re-centre the neutral orientation used by activities (steering centre etc.). */
  setNeutral(id?: ControllerId): void {
    this.engine.setNeutral(id);
  }

  // ---------- packet handling ----------
  private handlePacket(id: ControllerId, p: DevicePacket): void {
    const slot = this.slots[id];
    slot.lastPacketAt = p.receivedAt;
    for (const l of this.packetListeners) l(id, p);
    switch (p.type) {
      case PacketType.MOTION: {
        this.clocks[id].sync(p.timestamp, p.receivedAt);
        const state = this.engine.ingest(p, id);
        if (state) {
          const counter = this.rateCounters[id];
          counter.push(p.receivedAt);
          while (counter.length && p.receivedAt - counter[0] > 1000) counter.shift();
          if (p.battery !== null) slot.battery = p.battery;
          const phase = calibrationPhase(p.calibrationState, state.calibrated);
          if (phase !== slot.calibration) {
            if (phase === 'ready') {
              // New calibration → this pose is the new neutral for activities.
              this.engine.setNeutral(id);
              this.pushLog('info', id, 'calibration ready');
            }
            slot.calibration = phase;
            this.publish();
          }
        }
        break;
      }
      case PacketType.INFO:
        slot.info = p;
        if (p.battery !== null) slot.battery = p.battery;
        this.publish();
        break;
      case PacketType.CALIBRATION:
        slot.lastCalibration = p;
        this.pushLog('info', id, `calibration q=${p.quality} gyro=(${p.gyroOffset.x.toFixed(1)}, ${p.gyroOffset.y.toFixed(1)}, ${p.gyroOffset.z.toFixed(1)})`);
        this.publish();
        break;
      case PacketType.FACTORY_RESULT:
        slot.factory = p;
        this.publish();
        break;
      case PacketType.LOG:
        this.pushLog(p.level >= 2 ? 'error' : p.level === 1 ? 'warn' : 'info', id, `device: ${p.message}`);
        break;
    }
  }

  private tickStale(): void {
    const now = performance.now();
    this.engine.checkStale(now);
    let changed = false;
    for (const id of [1, 2] as ControllerId[]) {
      const slot = this.slots[id];
      const counter = this.rateCounters[id];
      while (counter.length && now - counter[0] > 1000) counter.shift();
      const rate = counter.length;
      const stats = this.engine.getSequenceStats(id);
      const streaming = this.engine.getState(id).connected;
      if (
        rate !== slot.packetRateHz ||
        streaming !== slot.streaming ||
        Math.abs(this.clocks[id].latencyMs - slot.latencyMs) > 0.5 ||
        stats.lossRatio !== slot.lossRatio
      ) {
        slot.packetRateHz = rate;
        slot.streaming = streaming;
        slot.latencyMs = this.clocks[id].latencyMs;
        slot.lossRatio = stats.lossRatio;
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  private publish(): void {
    if (this.publishTimer !== null) return;
    this.publishTimer = window.setTimeout(() => {
      this.publishTimer = null;
      const snap = this.snapshot();
      for (const l of this.listeners) l(snap);
    }, 16);
  }

  private pushLog(level: LogEntry['level'], controllerId: ControllerId | null, message: string): void {
    const e: LogEntry = { t: Date.now(), level, controllerId, message };
    this.log.push(e);
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    for (const l of this.logListeners) l(e);
  }

  destroy(): void {
    if (this.staleTimer !== null) clearInterval(this.staleTimer);
  }
}

export function calibrationPhase(state: CalibrationState, calibrated: boolean): CalibrationPhase {
  switch (state) {
    case CalibrationState.WAITING_STILL:
      return 'hold-still';
    case CalibrationState.SAMPLING:
      return 'calibrating';
    case CalibrationState.READY:
      return 'ready';
    case CalibrationState.FAILED:
      return 'failed';
    default:
      return calibrated ? 'ready' : 'none';
  }
}
