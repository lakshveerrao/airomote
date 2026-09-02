import {
  ACCEL_SCALE_MG,
  ANGLE_SCALE_CDEG,
  BATTERY_UNKNOWN,
  CalibrationState,
  DeviceErrorCode,
  FACTORY_TESTS,
  FactoryTestResult,
  GYRO_SCALE_DDPS,
  PACKET_SIZE,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  PacketType,
  type FactoryTestName,
} from './constants';
import { crc16 } from './crc';
import type {
  CalibrationPacket,
  DevicePacket,
  FactoryResultPacket,
  InfoPacket,
  LogPacket,
  MotionPacket,
  PacketHeader,
  Vec3,
} from './types';

export type DecodeError = {
  ok: false;
  reason: 'bad_magic' | 'bad_length' | 'bad_crc' | 'bad_version' | 'unknown_type' | 'bad_payload';
};
export type DecodeResult = { ok: true; packet: DevicePacket } | DecodeError;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function readHeader(view: DataView): PacketHeader {
  return {
    protocolVersion: view.getUint8(1),
    type: view.getUint8(2) as PacketType,
    deviceId: view.getUint8(3),
    status: view.getUint8(4),
    calibrationState: view.getUint8(5) as CalibrationState,
    sequence: view.getUint16(6, true),
  };
}

function writeHeader(view: DataView, type: PacketType, h: Partial<PacketHeader>): void {
  view.setUint8(0, PROTOCOL_MAGIC);
  view.setUint8(1, h.protocolVersion ?? PROTOCOL_VERSION);
  view.setUint8(2, type);
  view.setUint8(3, h.deviceId ?? 0);
  view.setUint8(4, h.status ?? 0);
  view.setUint8(5, h.calibrationState ?? CalibrationState.NONE);
  view.setUint16(6, (h.sequence ?? 0) & 0xffff, true);
}

function finalize(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(PACKET_SIZE - 2, crc16(bytes, 0, PACKET_SIZE - 2), true);
  return bytes;
}

const clampI16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Decode exactly one 32-byte packet. `receivedAt` defaults to performance.now() when available. */
export function decodePacket(bytes: Uint8Array, receivedAt?: number): DecodeResult {
  if (bytes.length !== PACKET_SIZE) return { ok: false, reason: 'bad_length' };
  if (bytes[0] !== PROTOCOL_MAGIC) return { ok: false, reason: 'bad_magic' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crc = view.getUint16(PACKET_SIZE - 2, true);
  if (crc !== crc16(bytes, 0, PACKET_SIZE - 2)) return { ok: false, reason: 'bad_crc' };
  const header = readHeader(view);
  if (header.protocolVersion !== PROTOCOL_VERSION) return { ok: false, reason: 'bad_version' };
  const now = receivedAt ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());

  switch (header.type) {
    case PacketType.MOTION: {
      const battery = view.getUint8(28);
      const packet: MotionPacket = {
        ...header,
        type: PacketType.MOTION,
        timestamp: view.getUint32(8, true),
        receivedAt: now,
        accel: {
          x: view.getInt16(12, true) / (1000 * ACCEL_SCALE_MG),
          y: view.getInt16(14, true) / (1000 * ACCEL_SCALE_MG),
          z: view.getInt16(16, true) / (1000 * ACCEL_SCALE_MG),
        },
        gyro: {
          x: view.getInt16(18, true) / GYRO_SCALE_DDPS,
          y: view.getInt16(20, true) / GYRO_SCALE_DDPS,
          z: view.getInt16(22, true) / GYRO_SCALE_DDPS,
        },
        pitch: view.getInt16(24, true) / ANGLE_SCALE_CDEG,
        roll: view.getInt16(26, true) / ANGLE_SCALE_CDEG,
        battery: battery === BATTERY_UNKNOWN ? null : Math.min(100, battery),
      };
      return { ok: true, packet };
    }
    case PacketType.INFO: {
      const battery = view.getUint8(18);
      const mv = view.getUint16(19, true);
      const id: string[] = [];
      for (let i = 0; i < 6; i++) id.push(view.getUint8(24 + i).toString(16).padStart(2, '0'));
      const packet: InfoPacket = {
        ...header,
        type: PacketType.INFO,
        uptimeMs: view.getUint32(8, true),
        firmwareVersion: `${view.getUint8(12)}.${view.getUint8(13)}.${view.getUint8(14)}`,
        hardwareRevision: view.getUint8(15),
        firmwareBuild: view.getUint16(16, true),
        battery: battery === BATTERY_UNKNOWN ? null : Math.min(100, battery),
        batteryMillivolts: mv === 0 ? null : mv,
        mpuAddress: view.getUint8(21),
        sensorFlags: view.getUint8(22),
        errorCode: view.getUint8(23) as DeviceErrorCode,
        uniqueId: id.join(':'),
        receivedAt: now,
      };
      return { ok: true, packet };
    }
    case PacketType.CALIBRATION: {
      const packet: CalibrationPacket = {
        ...header,
        type: PacketType.CALIBRATION,
        timestamp: view.getUint32(8, true),
        gyroOffset: {
          x: view.getInt16(12, true) / GYRO_SCALE_DDPS,
          y: view.getInt16(14, true) / GYRO_SCALE_DDPS,
          z: view.getInt16(16, true) / GYRO_SCALE_DDPS,
        },
        accelBaseline: {
          x: view.getInt16(18, true) / 1000,
          y: view.getInt16(20, true) / 1000,
          z: view.getInt16(22, true) / 1000,
        },
        quality: view.getUint8(24),
        sampleCount: view.getUint8(25) * 10,
        receivedAt: now,
      };
      return { ok: true, packet };
    }
    case PacketType.FACTORY_RESULT: {
      const count = Math.min(view.getUint8(8), FACTORY_TESTS.length);
      const results = {} as Record<FactoryTestName, FactoryTestResult>;
      let complete = true;
      let overallPass = true;
      FACTORY_TESTS.forEach((name, i) => {
        const r = i < count ? (view.getUint8(9 + i) as FactoryTestResult) : FactoryTestResult.SKIPPED;
        results[name] = r;
        if (r === FactoryTestResult.PENDING) complete = false;
        if (r === FactoryTestResult.FAIL) overallPass = false;
      });
      const packet: FactoryResultPacket = {
        ...header,
        type: PacketType.FACTORY_RESULT,
        results,
        complete,
        overallPass: complete && overallPass,
        receivedAt: now,
      };
      return { ok: true, packet };
    }
    case PacketType.LOG: {
      const len = Math.min(view.getUint8(9), 20);
      const packet: LogPacket = {
        ...header,
        type: PacketType.LOG,
        level: view.getUint8(8),
        message: textDecoder.decode(bytes.subarray(10, 10 + len)),
        receivedAt: now,
      };
      return { ok: true, packet };
    }
    default:
      return { ok: false, reason: 'unknown_type' };
  }
}

// ---------- Encoders (used by the simulator, tests and as the reference for firmware) ----------

export interface MotionEncodeInput extends Partial<PacketHeader> {
  timestamp: number;
  accel: Vec3; // g
  gyro: Vec3; // deg/s
  pitch?: number;
  roll?: number;
  battery?: number | null;
}

export function encodeMotionPacket(input: MotionEncodeInput): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  writeHeader(view, PacketType.MOTION, input);
  view.setUint32(8, input.timestamp >>> 0, true);
  view.setInt16(12, clampI16(input.accel.x * 1000), true);
  view.setInt16(14, clampI16(input.accel.y * 1000), true);
  view.setInt16(16, clampI16(input.accel.z * 1000), true);
  view.setInt16(18, clampI16(input.gyro.x * GYRO_SCALE_DDPS), true);
  view.setInt16(20, clampI16(input.gyro.y * GYRO_SCALE_DDPS), true);
  view.setInt16(22, clampI16(input.gyro.z * GYRO_SCALE_DDPS), true);
  view.setInt16(24, clampI16((input.pitch ?? 0) * ANGLE_SCALE_CDEG), true);
  view.setInt16(26, clampI16((input.roll ?? 0) * ANGLE_SCALE_CDEG), true);
  view.setUint8(
    28,
    input.battery == null ? BATTERY_UNKNOWN : Math.max(0, Math.min(100, Math.round(input.battery))),
  );
  view.setUint8(29, 0);
  return finalize(bytes);
}

export interface InfoEncodeInput extends Partial<PacketHeader> {
  uptimeMs: number;
  firmwareVersion: [number, number, number];
  firmwareBuild: number;
  hardwareRevision: number;
  battery?: number | null;
  batteryMillivolts?: number | null;
  mpuAddress: number;
  sensorFlags: number;
  errorCode?: DeviceErrorCode;
  uniqueId: string; // "aa:bb:cc:dd:ee:ff"
}

export function encodeInfoPacket(input: InfoEncodeInput): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  writeHeader(view, PacketType.INFO, input);
  view.setUint32(8, input.uptimeMs >>> 0, true);
  view.setUint8(12, input.firmwareVersion[0]);
  view.setUint8(13, input.firmwareVersion[1]);
  view.setUint8(14, input.firmwareVersion[2]);
  view.setUint8(15, input.hardwareRevision);
  view.setUint16(16, input.firmwareBuild & 0xffff, true);
  view.setUint8(18, input.battery == null ? BATTERY_UNKNOWN : Math.round(input.battery));
  view.setUint16(19, input.batteryMillivolts ?? 0, true);
  view.setUint8(21, input.mpuAddress);
  view.setUint8(22, input.sensorFlags);
  view.setUint8(23, input.errorCode ?? DeviceErrorCode.NONE);
  const parts = input.uniqueId.split(':').map((p) => parseInt(p, 16) & 0xff);
  for (let i = 0; i < 6; i++) view.setUint8(24 + i, parts[i] ?? 0);
  return finalize(bytes);
}

export interface CalibrationEncodeInput extends Partial<PacketHeader> {
  timestamp: number;
  gyroOffset: Vec3;
  accelBaseline: Vec3;
  quality: number;
  sampleCount: number;
}

export function encodeCalibrationPacket(input: CalibrationEncodeInput): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  writeHeader(view, PacketType.CALIBRATION, input);
  view.setUint32(8, input.timestamp >>> 0, true);
  view.setInt16(12, clampI16(input.gyroOffset.x * GYRO_SCALE_DDPS), true);
  view.setInt16(14, clampI16(input.gyroOffset.y * GYRO_SCALE_DDPS), true);
  view.setInt16(16, clampI16(input.gyroOffset.z * GYRO_SCALE_DDPS), true);
  view.setInt16(18, clampI16(input.accelBaseline.x * 1000), true);
  view.setInt16(20, clampI16(input.accelBaseline.y * 1000), true);
  view.setInt16(22, clampI16(input.accelBaseline.z * 1000), true);
  view.setUint8(24, Math.max(0, Math.min(100, Math.round(input.quality))));
  view.setUint8(25, Math.min(255, Math.round(input.sampleCount / 10)));
  return finalize(bytes);
}

export function encodeFactoryResultPacket(
  results: Partial<Record<FactoryTestName, FactoryTestResult>>,
  header: Partial<PacketHeader> = {},
): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  writeHeader(view, PacketType.FACTORY_RESULT, header);
  view.setUint8(8, FACTORY_TESTS.length);
  FACTORY_TESTS.forEach((name, i) => view.setUint8(9 + i, results[name] ?? FactoryTestResult.PENDING));
  return finalize(bytes);
}

export function encodeLogPacket(level: number, message: string, header: Partial<PacketHeader> = {}): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  writeHeader(view, PacketType.LOG, header);
  const msg = textEncoder.encode(message).subarray(0, 20);
  view.setUint8(8, level);
  view.setUint8(9, msg.length);
  bytes.set(msg, 10);
  return finalize(bytes);
}

/** Host → device command. Args are copied into bytes 9..29 (max 21 bytes). */
export function encodeCommandPacket(command: number, args: Uint8Array | number[] = []): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  writeHeader(view, PacketType.COMMAND, {});
  view.setUint8(8, command);
  const a = args instanceof Uint8Array ? args : Uint8Array.from(args);
  bytes.set(a.subarray(0, 21), 9);
  return finalize(bytes);
}

export function decodeCommandPacket(bytes: Uint8Array): { command: number; args: Uint8Array } | null {
  if (bytes.length !== PACKET_SIZE || bytes[0] !== PROTOCOL_MAGIC) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(PACKET_SIZE - 2, true) !== crc16(bytes, 0, PACKET_SIZE - 2)) return null;
  if (view.getUint8(2) !== PacketType.COMMAND) return null;
  return { command: view.getUint8(8), args: bytes.slice(9, 30) };
}

export function encodeSetNameArgs(name: string): Uint8Array {
  return textEncoder.encode(name).subarray(0, 20);
}
