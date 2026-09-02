import { describe, expect, it } from 'vitest';
import {
  CalibrationState,
  CommandId,
  DeviceClock,
  FACTORY_TESTS,
  FactoryTestResult,
  PACKET_SIZE,
  PacketStreamDecoder,
  PacketType,
  SequenceTracker,
  StatusFlag,
  crc16,
  decodeCommandPacket,
  decodePacket,
  encodeCalibrationPacket,
  encodeCommandPacket,
  encodeFactoryResultPacket,
  encodeInfoPacket,
  encodeLogPacket,
  encodeMotionPacket,
  encodeSetNameArgs,
  type DevicePacket,
} from './index';

const motion = (seq: number, t = 1000) =>
  encodeMotionPacket({
    deviceId: 1,
    sequence: seq,
    timestamp: t,
    status: StatusFlag.SENSOR_OK | StatusFlag.CALIBRATED,
    calibrationState: CalibrationState.READY,
    accel: { x: 0.012, y: -0.5, z: 0.98 },
    gyro: { x: 12.3, y: -250.7, z: 0.4 },
    pitch: 12.34,
    roll: -45.67,
    battery: 87,
  });

describe('crc16', () => {
  it('matches the CCITT-FALSE check value', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });
});

describe('motion packet round trip', () => {
  it('encodes to 32 bytes and decodes to the same values within scale resolution', () => {
    const bytes = motion(42);
    expect(bytes.length).toBe(PACKET_SIZE);
    const r = decodePacket(bytes, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.packet;
    expect(p.type).toBe(PacketType.MOTION);
    if (p.type !== PacketType.MOTION) return;
    expect(p.deviceId).toBe(1);
    expect(p.sequence).toBe(42);
    expect(p.timestamp).toBe(1000);
    expect(p.receivedAt).toBe(5);
    expect(p.accel.x).toBeCloseTo(0.012, 3);
    expect(p.accel.y).toBeCloseTo(-0.5, 3);
    expect(p.gyro.y).toBeCloseTo(-250.7, 1);
    expect(p.pitch).toBeCloseTo(12.34, 2);
    expect(p.roll).toBeCloseTo(-45.67, 2);
    expect(p.battery).toBe(87);
    expect(p.status & StatusFlag.CALIBRATED).toBeTruthy();
    expect(p.calibrationState).toBe(CalibrationState.READY);
  });

  it('reports unknown battery as null and clamps out-of-range values', () => {
    const bytes = encodeMotionPacket({
      timestamp: 0,
      accel: { x: 99, y: 0, z: 0 },
      gyro: { x: 0, y: 0, z: 0 },
      battery: null,
    });
    const r = decodePacket(bytes);
    expect(r.ok && r.packet.type === PacketType.MOTION && r.packet.battery).toBeNull();
    expect(r.ok && r.packet.type === PacketType.MOTION && r.packet.accel.x).toBeCloseTo(32.767, 2);
  });
});

describe('validation', () => {
  it('rejects wrong length, magic, version, type and crc', () => {
    expect(decodePacket(new Uint8Array(10))).toEqual({ ok: false, reason: 'bad_length' });
    const bad = motion(1);
    bad[0] = 0x00;
    expect(decodePacket(bad)).toEqual({ ok: false, reason: 'bad_magic' });
    const flipped = motion(1);
    flipped[15] ^= 0xff;
    expect(decodePacket(flipped)).toEqual({ ok: false, reason: 'bad_crc' });
    const v = motion(1);
    v[1] = 99;
    new DataView(v.buffer).setUint16(30, crc16(v, 0, 30), true);
    expect(decodePacket(v)).toEqual({ ok: false, reason: 'bad_version' });
    const t = motion(1);
    t[2] = 0x7f;
    new DataView(t.buffer).setUint16(30, crc16(t, 0, 30), true);
    expect(decodePacket(t)).toEqual({ ok: false, reason: 'unknown_type' });
  });

  it('rejects random garbage without throwing', () => {
    for (let i = 0; i < 200; i++) {
      const g = new Uint8Array(PACKET_SIZE);
      for (let j = 0; j < PACKET_SIZE; j++) g[j] = Math.floor(Math.random() * 256);
      expect(decodePacket(g).ok).toBe(false);
    }
  });
});

describe('info / calibration / factory / log packets', () => {
  it('round trips info', () => {
    const r = decodePacket(
      encodeInfoPacket({
        deviceId: 2,
        uptimeMs: 123456,
        firmwareVersion: [1, 2, 3],
        firmwareBuild: 77,
        hardwareRevision: 1,
        battery: 55,
        batteryMillivolts: 3870,
        mpuAddress: 0x69,
        sensorFlags: 0b111,
        uniqueId: 'a0:b1:c2:d3:e4:f5',
      }),
    );
    expect(r.ok && r.packet.type === PacketType.INFO && r.packet).toMatchObject({
      deviceId: 2,
      uptimeMs: 123456,
      firmwareVersion: '1.2.3',
      firmwareBuild: 77,
      battery: 55,
      batteryMillivolts: 3870,
      mpuAddress: 0x69,
      uniqueId: 'a0:b1:c2:d3:e4:f5',
    });
  });

  it('round trips calibration', () => {
    const r = decodePacket(
      encodeCalibrationPacket({
        timestamp: 5,
        gyroOffset: { x: 1.5, y: -2.5, z: 0.1 },
        accelBaseline: { x: 0.01, y: 0.02, z: 1.0 },
        quality: 92,
        sampleCount: 400,
      }),
    );
    expect(r.ok && r.packet.type === PacketType.CALIBRATION && r.packet.gyroOffset.y).toBeCloseTo(-2.5, 1);
    expect(r.ok && r.packet.type === PacketType.CALIBRATION && r.packet.sampleCount).toBe(400);
    expect(r.ok && r.packet.type === PacketType.CALIBRATION && r.packet.quality).toBe(92);
  });

  it('decodes factory results with overall pass only when everything passed', () => {
    const all: Record<string, FactoryTestResult> = {};
    for (const t of FACTORY_TESTS) all[t] = FactoryTestResult.PASS;
    let r = decodePacket(encodeFactoryResultPacket(all));
    expect(r.ok && r.packet.type === PacketType.FACTORY_RESULT && r.packet.overallPass).toBe(true);
    all.gyroscope = FactoryTestResult.FAIL;
    r = decodePacket(encodeFactoryResultPacket(all));
    expect(r.ok && r.packet.type === PacketType.FACTORY_RESULT && r.packet.overallPass).toBe(false);
    all.gyroscope = FactoryTestResult.PENDING;
    r = decodePacket(encodeFactoryResultPacket(all));
    expect(r.ok && r.packet.type === PacketType.FACTORY_RESULT && r.packet.complete).toBe(false);
  });

  it('round trips log and command packets', () => {
    const r = decodePacket(encodeLogPacket(2, 'hello'));
    expect(r.ok && r.packet.type === PacketType.LOG && r.packet.message).toBe('hello');
    const c = decodeCommandPacket(encodeCommandPacket(CommandId.SET_NAME, encodeSetNameArgs('Blue')));
    expect(c?.command).toBe(CommandId.SET_NAME);
    expect(new TextDecoder().decode(c!.args.subarray(0, 4))).toBe('Blue');
  });
});

describe('PacketStreamDecoder', () => {
  it('reassembles packets split across chunks and concatenated in one chunk', () => {
    const out: DevicePacket[] = [];
    const d = new PacketStreamDecoder((p) => out.push(p));
    const a = motion(1);
    const b = motion(2);
    const c = motion(3);
    const joined = new Uint8Array(64);
    joined.set(a, 0);
    joined.set(b, 32);
    d.push(joined);
    d.push(c.subarray(0, 7));
    d.push(c.subarray(7, 20));
    d.push(c.subarray(20));
    expect(out.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(d.stats.packets).toBe(3);
  });

  it('resynchronises after garbage and corrupted packets', () => {
    const out: DevicePacket[] = [];
    const d = new PacketStreamDecoder((p) => out.push(p));
    const good = motion(9);
    const corrupt = motion(8);
    corrupt[20] ^= 0x55;
    d.push(Uint8Array.from([0x00, 0x11, 0xa5, 0x01])); // noise incl. a stray magic
    d.push(corrupt);
    d.push(good);
    expect(out.map((p) => p.sequence)).toEqual([9]);
    expect(d.stats.crcErrors).toBeGreaterThanOrEqual(1);
  });
});

describe('SequenceTracker', () => {
  it('counts drops, duplicates, and late packets', () => {
    const t = new SequenceTracker();
    expect(t.track(10)).toBe('accept');
    expect(t.track(11)).toBe('accept');
    expect(t.track(14)).toBe('accept'); // dropped 12, 13
    expect(t.track(14)).toBe('duplicate');
    expect(t.track(13)).toBe('late');
    expect(t.track(15)).toBe('accept');
    expect(t.stats.dropped).toBe(2);
    expect(t.stats.duplicates).toBe(1);
    expect(t.stats.outOfOrder).toBe(1);
  });
  it('handles u16 wrap-around and reboot resets', () => {
    const t = new SequenceTracker();
    t.track(65534);
    expect(t.track(65535)).toBe('accept');
    expect(t.track(0)).toBe('accept');
    expect(t.stats.dropped).toBe(0);
    expect(t.track(5000)).toBe('accept'); // big jump = reboot, not 5000 drops
    expect(t.stats.dropped).toBe(0);
  });
});

describe('DeviceClock', () => {
  it('maps device time onto host time and estimates latency from jitter', () => {
    const c = new DeviceClock();
    const host0 = 10_000;
    c.sync(0, host0 + 20);
    c.sync(10, host0 + 30);
    c.sync(20, host0 + 45); // this one arrived 5ms late
    expect(c.latencyMs).toBeGreaterThan(3);
    expect(c.latencyMs).toBeLessThan(6);
  });
  it('unwraps u32 device timestamps', () => {
    const c = new DeviceClock();
    c.sync(0xfffffff0, 1000);
    const t = c.sync(5, 1030);
    expect(t).toBeGreaterThan(1000);
  });
});
