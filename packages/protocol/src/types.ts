import type { CalibrationState, DeviceErrorCode, FactoryTestName, FactoryTestResult, PacketType } from './constants';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PacketHeader {
  protocolVersion: number;
  type: PacketType;
  /** Controller slot configured on the device: 1 or 2. 0 = unassigned. */
  deviceId: number;
  status: number; // StatusFlag bitfield
  calibrationState: CalibrationState;
  sequence: number; // u16, wraps
}

export interface MotionPacket extends PacketHeader {
  type: PacketType.MOTION;
  /** Device millis since boot (u32, wraps). */
  timestamp: number;
  /** Arrival time on host (performance.now()) — filled in by the transport layer. */
  receivedAt: number;
  /** Acceleration in g. */
  accel: Vec3;
  /** Angular velocity in deg/s. */
  gyro: Vec3;
  /** Firmware-side orientation estimate in degrees (pitch/roll). */
  pitch: number;
  roll: number;
  /** 0-100, or null when the hardware cannot report it. */
  battery: number | null;
}

export interface InfoPacket extends PacketHeader {
  type: PacketType.INFO;
  uptimeMs: number;
  firmwareVersion: string; // "1.2.3"
  firmwareBuild: number;
  hardwareRevision: number;
  battery: number | null;
  batteryMillivolts: number | null;
  mpuAddress: number; // 0x68 / 0x69 / 0
  sensorFlags: number; // bit0 whoami ok, bit1 accel ok, bit2 gyro ok
  errorCode: DeviceErrorCode;
  /** 6-byte unique id (BLE MAC / efuse) as lowercase hex "aa:bb:cc:dd:ee:ff". */
  uniqueId: string;
  receivedAt: number;
}

export interface CalibrationPacket extends PacketHeader {
  type: PacketType.CALIBRATION;
  timestamp: number;
  gyroOffset: Vec3; // deg/s
  accelBaseline: Vec3; // g
  quality: number; // 0-100
  sampleCount: number;
  receivedAt: number;
}

export interface FactoryResultPacket extends PacketHeader {
  type: PacketType.FACTORY_RESULT;
  results: Record<FactoryTestName, FactoryTestResult>;
  overallPass: boolean;
  complete: boolean;
  receivedAt: number;
}

export interface LogPacket extends PacketHeader {
  type: PacketType.LOG;
  level: number;
  message: string;
  receivedAt: number;
}

export type DevicePacket = MotionPacket | InfoPacket | CalibrationPacket | FactoryResultPacket | LogPacket;
