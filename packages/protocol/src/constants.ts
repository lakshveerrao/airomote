/**
 * AiroMote Motion Protocol — constants shared (by hand) with firmware/controller/main/communication/protocol.h
 * Keep these two files in sync. Any change to layout bumps PROTOCOL_VERSION.
 */
export const PROTOCOL_MAGIC = 0xa5;
export const PROTOCOL_VERSION = 1;
export const PACKET_SIZE = 32;

export enum PacketType {
  MOTION = 0x01,
  INFO = 0x02,
  CALIBRATION = 0x03,
  FACTORY_RESULT = 0x04,
  LOG = 0x05,
  COMMAND = 0x10,
}

export enum CommandId {
  NONE = 0,
  RECALIBRATE = 1,
  SET_DEVICE_ID = 2,
  SET_RATE_HZ = 3,
  FACTORY_TEST = 4,
  RESET_FACTORY = 5,
  REBOOT = 6,
  IDENTIFY = 7,
  GET_INFO = 8,
  SET_NAME = 9,
  ENTER_DIAGNOSTICS = 10,
  EXIT_DIAGNOSTICS = 11,
}

/** Bit flags in the `status` byte (byte 4) present in every device→host packet. */
export enum StatusFlag {
  SENSOR_OK = 1 << 0,
  CALIBRATED = 1 << 1,
  STATIONARY = 1 << 2,
  LOW_BATTERY = 1 << 3,
  CHARGING = 1 << 4,
  BUTTON_PRESSED = 1 << 5,
  DIAGNOSTICS_MODE = 1 << 6,
  ERROR = 1 << 7,
}

export enum CalibrationState {
  NONE = 0,
  WAITING_STILL = 1,
  SAMPLING = 2,
  READY = 3,
  FAILED = 4,
}

export enum DeviceErrorCode {
  NONE = 0,
  MPU_NOT_FOUND = 1,
  MPU_WHOAMI_MISMATCH = 2,
  MPU_READ_FAILED = 3,
  CALIBRATION_TIMEOUT = 4,
  CALIBRATION_UNSTABLE = 5,
  NVS_FAILED = 6,
  BLE_INIT_FAILED = 7,
  BATTERY_READ_FAILED = 8,
  WATCHDOG_RESET = 9,
  BROWNOUT_RESET = 10,
}

/** Order of tests in the FACTORY_RESULT packet payload. */
export const FACTORY_TESTS = [
  'boot',
  'mpuDetected',
  'accelerometer',
  'gyroscope',
  'calibration',
  'wireless',
  'battery',
  'button',
  'led',
  'nvs',
] as const;
export type FactoryTestName = (typeof FACTORY_TESTS)[number];

export enum FactoryTestResult {
  PENDING = 0,
  PASS = 1,
  FAIL = 2,
  SKIPPED = 3,
}

/** Scale factors — firmware sends integers, host converts to physical units. */
export const ACCEL_SCALE_MG = 1; // i16 milli-g
export const GYRO_SCALE_DDPS = 10; // i16 tenths of deg/s
export const ANGLE_SCALE_CDEG = 100; // i16 hundredths of a degree
export const BATTERY_UNKNOWN = 255;

/** BLE GATT identifiers (Nordic-UART-like stream, custom UUIDs). */
export const BLE_SERVICE_UUID = '7a3e0001-4d6f-7469-6f6e-416572304d43';
export const BLE_TX_CHAR_UUID = '7a3e0002-4d6f-7469-6f6e-416572304d43'; // device → host (notify)
export const BLE_RX_CHAR_UUID = '7a3e0003-4d6f-7469-6f6e-416572304d43'; // host → device (write)
export const BLE_NAME_PREFIX = 'AiroMote-';

/** Rates (documented in docs/PROTOCOL.md). */
export const SENSOR_SAMPLE_RATE_HZ = 200;
export const DEFAULT_PACKET_RATE_HZ = 100;
export const INFO_PACKET_INTERVAL_MS = 1000;
