import {
  CalibrationState,
  StatusFlag,
  decodeCommandPacket,
  CommandId,
  encodeCalibrationPacket,
  encodeFactoryResultPacket,
  encodeInfoPacket,
  encodeMotionPacket,
  FACTORY_TESTS,
  FactoryTestResult,
} from '@aero/protocol';
import type { ControllerId } from '@aero/motion-core';
import { BaseTransport, type TransportKind } from './types';
import { SimulatedController } from '../simulator/SimulatedController';

/**
 * Simulator transport. Emits *real encoded packets* on a timer from a SimulatedController
 * model, so the whole pipeline (stream decoder → sequence tracking → motion engine → mapper →
 * activity) is exercised exactly as with hardware. It even answers commands (recalibrate,
 * factory test, identify) the way the firmware does.
 */
export class SimulatorTransport extends BaseTransport {
  readonly kind: TransportKind = 'simulator';
  readonly canReconnect = true;
  readonly model: SimulatedController;
  private timer: number | null = null;
  private sequence = 0;
  private startedAt = 0;
  private lastInfo = 0;
  private lastTick = 0;
  /** Packet-loss injection for testing (0..1). */
  dropRate = 0;

  constructor(
    public readonly controllerId: ControllerId,
    public rateHz = 100,
  ) {
    super();
    this.model = new SimulatedController(controllerId);
    this.info = { kind: 'simulator', name: `Simulated ${controllerId}`, id: `sim-${controllerId}` };
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    this.startedAt = performance.now();
    this.lastTick = this.startedAt;
    this.model.beginCalibration();
    await new Promise((r) => setTimeout(r, 250));
    this.timer = window.setInterval(() => this.tick(), 1000 / this.rateHz);
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.setState('disconnected');
  }

  /** Simulate a link drop for N ms then come back (tests reconnect handling). */
  simulateDropout(ms = 1500): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.setState('reconnecting');
    window.setTimeout(() => {
      if (this.state !== 'reconnecting') return;
      this.timer = window.setInterval(() => this.tick(), 1000 / this.rateHz);
      this.setState('connected');
    }, ms);
  }

  async send(bytes: Uint8Array): Promise<void> {
    const cmd = decodeCommandPacket(bytes);
    if (!cmd) return;
    switch (cmd.command) {
      case CommandId.RECALIBRATE:
        this.model.beginCalibration();
        break;
      case CommandId.IDENTIFY:
        this.model.identify();
        break;
      case CommandId.GET_INFO:
        this.emitInfo(performance.now());
        break;
      case CommandId.FACTORY_TEST:
        this.runFactoryTest();
        break;
      case CommandId.SET_DEVICE_ID:
        break;
      case CommandId.REBOOT:
        this.sequence = 0;
        this.startedAt = performance.now();
        this.model.beginCalibration();
        break;
      default:
        break;
    }
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const sample = this.model.step(dt);
    const seq = this.sequence;
    this.sequence = (this.sequence + 1) & 0xffff;
    if (this.dropRate > 0 && Math.random() < this.dropRate) return;
    const status =
      StatusFlag.SENSOR_OK |
      (sample.calibrationState === CalibrationState.READY ? StatusFlag.CALIBRATED : 0) |
      (sample.stationary ? StatusFlag.STATIONARY : 0) |
      (sample.battery !== null && sample.battery < 15 ? StatusFlag.LOW_BATTERY : 0);
    const bytes = encodeMotionPacket({
      deviceId: this.controllerId,
      sequence: seq,
      timestamp: Math.round(now - this.startedAt),
      status,
      calibrationState: sample.calibrationState,
      accel: sample.accel,
      gyro: sample.gyro,
      pitch: sample.pitch,
      roll: sample.roll,
      battery: sample.battery,
    });
    this.emitData(bytes, now);
    if (sample.calibrationJustFinished) {
      this.emitData(
        encodeCalibrationPacket({
          deviceId: this.controllerId,
          sequence: seq,
          timestamp: Math.round(now - this.startedAt),
          calibrationState: CalibrationState.READY,
          status,
          gyroOffset: sample.gyroBias,
          accelBaseline: { x: 0, y: 0, z: 1 },
          quality: 96,
          sampleCount: 400,
        }),
        now,
      );
    }
    if (now - this.lastInfo > 1000) this.emitInfo(now);
  }

  private emitInfo(now: number): void {
    this.lastInfo = now;
    this.emitData(
      encodeInfoPacket({
        deviceId: this.controllerId,
        sequence: this.sequence,
        status: StatusFlag.SENSOR_OK | StatusFlag.CALIBRATED,
        calibrationState: this.model.calibrationState,
        uptimeMs: Math.round(now - this.startedAt),
        firmwareVersion: [1, 0, 0],
        firmwareBuild: 0,
        hardwareRevision: 0,
        battery: this.model.battery,
        batteryMillivolts: this.model.battery === null ? null : Math.round(3300 + (this.model.battery / 100) * 900),
        mpuAddress: 0x68,
        sensorFlags: 0b111,
        uniqueId: `si:mu:la:te:d0:0${this.controllerId}`,
      }),
      now,
    );
  }

  private runFactoryTest(): void {
    const results: Partial<Record<(typeof FACTORY_TESTS)[number], FactoryTestResult>> = {};
    let i = 0;
    const step = () => {
      const name = FACTORY_TESTS[i];
      if (!name) return;
      results[name] = name === 'button' || name === 'led' ? FactoryTestResult.SKIPPED : FactoryTestResult.PASS;
      if (this.model.failFactoryTest === name) results[name] = FactoryTestResult.FAIL;
      this.emitData(encodeFactoryResultPacket(results, { deviceId: this.controllerId }), performance.now());
      i++;
      if (i < FACTORY_TESTS.length) window.setTimeout(step, 220);
    };
    step();
  }
}
