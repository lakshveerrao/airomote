# AiroMote Motion Protocol (v1)

Shared by `firmware/controller/main/communication/protocol.h` and `packages/protocol/src`.
Both sides must be changed together; any layout change bumps `PROTOCOL_VERSION`.

## Design

- **Fixed 32-byte binary packets**, little-endian, CRC-16 protected. One packet = one BLE
  notification at the default rate; the firmware may concatenate 2 packets when the negotiated
  MTU allows. Serial carries the same bytes back-to-back.
- **Magic byte `0xA5`** starts every packet so a byte stream can be resynchronised after a
  corrupted or partial packet (`PacketStreamDecoder`).
- **Sequence numbers** (u16, wrap) detect drops, duplicates and out-of-order delivery.
- **Device timestamp** (u32 ms since boot) is mapped to host time by `DeviceClock`, which also
  yields a latency estimate from arrival jitter.
- Integer units keep packets small: milli-g, 0.1 °/s, 0.01°.

## Common header (bytes 0–7)

| Byte | Field | Notes |
|---|---|---|
| 0 | magic | `0xA5` |
| 1 | protocolVersion | `1` |
| 2 | packetType | see below |
| 3 | deviceId | controller slot `1` or `2`; `0` = unassigned |
| 4 | status | bit flags: 0 SENSOR_OK, 1 CALIBRATED, 2 STATIONARY, 3 LOW_BATTERY, 4 CHARGING, 5 BUTTON_PRESSED, 6 DIAGNOSTICS_MODE, 7 ERROR |
| 5 | calibrationState | 0 NONE, 1 WAITING_STILL, 2 SAMPLING, 3 READY, 4 FAILED |
| 6–7 | sequence | u16 |
| 30–31 | crc16 | CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over bytes 0–29 |

## Packet types

### `0x01` MOTION (device → host, 100 Hz default)

| Bytes | Field | Unit |
|---|---|---|
| 8–11 | timestamp | ms since boot, u32 |
| 12–17 | accel x, y, z | i16 milli-g |
| 18–23 | gyro x, y, z | i16 × 0.1 °/s |
| 24–25 | pitch | i16 × 0.01° (firmware estimate) |
| 26–27 | roll | i16 × 0.01° |
| 28 | battery | 0–100, `255` = unknown |
| 29 | reserved | 0 |

Axes are already remapped by the firmware into the **body frame**: +X forward, +Y left, +Z up.
At rest on a table the packet reads accel ≈ (0, 0, +1000).

### `0x02` INFO (device → host, every 1 s and on `GET_INFO`)

| Bytes | Field |
|---|---|
| 8–11 | uptime ms |
| 12,13,14 | firmware major, minor, patch |
| 15 | hardware revision |
| 16–17 | firmware build number (u16) |
| 18 | battery % (255 unknown) |
| 19–20 | battery millivolts (0 unknown) |
| 21 | MPU6050 I²C address actually used (0x68/0x69, 0 if none) |
| 22 | sensor flags: bit0 WHO_AM_I ok, bit1 accel ok, bit2 gyro ok |
| 23 | error code (see below) |
| 24–29 | unique id (6 bytes, BLE MAC) |

### `0x03` CALIBRATION (device → host, after each calibration)

| Bytes | Field |
|---|---|
| 8–11 | timestamp |
| 12–17 | gyro offsets x, y, z (0.1 °/s) |
| 18–23 | accel resting baseline x, y, z (milli-g) |
| 24 | quality 0–100 |
| 25 | sample count / 10 |

### `0x04` FACTORY_RESULT (device → host, progressive during factory test)

Byte 8 = test count (10). Bytes 9–18 = one result per test, in this order:
`boot, mpuDetected, accelerometer, gyroscope, calibration, wireless, battery, button, led, nvs`.
Values: 0 PENDING, 1 PASS, 2 FAIL, 3 SKIPPED. The host also verifies the wireless link and
motion response itself (see FACTORY_TEST.md).

### `0x05` LOG (device → host)

Byte 8 level (0 info, 1 warn, 2 error), byte 9 length, bytes 10–29 UTF-8 text.

### `0x10` COMMAND (host → device)

Byte 8 = command id, bytes 9–29 = arguments.

| Id | Command | Args |
|---|---|---|
| 1 | RECALIBRATE | – |
| 2 | SET_DEVICE_ID | u8 (1 or 2), persisted |
| 3 | SET_RATE_HZ | u8 packet rate (25–200) |
| 4 | FACTORY_TEST | – |
| 5 | RESET_FACTORY | – (clears NVS, reboots) |
| 6 | REBOOT | – |
| 7 | IDENTIFY | – (LED blinks 1.5 s) |
| 8 | GET_INFO | – |
| 9 | SET_NAME | UTF-8 ≤ 20 bytes |
| 10 | ENTER_DIAGNOSTICS | – |
| 11 | EXIT_DIAGNOSTICS | – |

## Error codes

0 NONE · 1 MPU_NOT_FOUND · 2 MPU_WHOAMI_MISMATCH · 3 MPU_READ_FAILED · 4 CALIBRATION_TIMEOUT ·
5 CALIBRATION_UNSTABLE · 6 NVS_FAILED · 7 BLE_INIT_FAILED · 8 BATTERY_READ_FAILED ·
9 WATCHDOG_RESET · 10 BROWNOUT_RESET

## BLE GATT

| | UUID |
|---|---|
| Service | `7a3e0001-4d6f-7469-6f6e-416572304d43` |
| TX (notify, device → host) | `7a3e0002-4d6f-7469-6f6e-416572304d43` |
| RX (write / write-no-response, host → device) | `7a3e0003-4d6f-7469-6f6e-416572304d43` |
| Advertised name | `AiroMote-<deviceId>-<last 4 hex of MAC>` |

Connection parameters requested by the device: interval 7.5–15 ms, MTU ≥ 64.

## Rates

| Stage | Rate | Why |
|---|---|---|
| MPU6050 sampling | 200 Hz (DLPF 98 Hz) | headroom for strike/swing peaks, filtering in firmware |
| Wireless packets | 100 Hz (every 2nd filtered sample) | fits a 15 ms BLE interval with 1–2 notifications; ~3.2 kB/s |
| INFO packets | 1 Hz | battery/uptime/health |
| Browser render | display rate (60–144 Hz) | motion state is read per frame from refs, never through React state |

The browser never waits for a packet to render; the latest state is always available. Typical
end-to-end latency (sensor → screen) is one BLE interval plus one frame: ~20–35 ms.

## Robustness on the host

- `PacketStreamDecoder`: reassembles partial/concatenated chunks, resyncs on magic after CRC failure.
- `SequenceTracker`: drops duplicates and late packets, counts losses, resets on reboot (large
  jump or device timestamp going backwards).
- `MotionEngine.checkStale`: a controller with no packets for 2 s is marked disconnected; held
  actions are released so a game never keeps steering with a dead controller.
- Transports reconnect automatically with back-off (BLE) or on user action (Serial).
