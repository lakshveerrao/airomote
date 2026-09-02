# Firmware (`firmware/controller`)

ESP-IDF 6.0 firmware for the ESP32-C6 Mini + MPU6050 controllers, built with PlatformIO
(`platform = espressif32`, `framework = espidf`, board `esp32-c6-devkitm-1`). The full,
maintained firmware reference lives in `firmware/controller/README.md`; this page is the
product-level summary.

## Why ESP-IDF (not Arduino)

- NimBLE with direct control over connection interval (7.5–15 ms), MTU and a non-blocking
  notification queue — the single biggest factor in motion latency.
- Production plumbing out of the box: NVS config, task watchdog, brownout detection, reset
  reason reporting, OTA-ready two-slot partition table.
- Deterministic 200 Hz sensor task. Arduino-ESP32 3.x would work but layers Bluedroid and
  loop-based timing on top, with a weaker partition/OTA/watchdog story.

## Build, flash, monitor

```bash
python -m platformio run -d firmware/controller               # build → .pio/build/aero_c6/firmware.bin
python -m platformio run -d firmware/controller -t upload     # flash via native USB Serial/JTAG
python -m platformio device monitor -d firmware/controller -b 115200
```

Or plain IDF: `cd firmware/controller && idf.py set-target esp32c6 && idf.py build flash monitor`.
If the board does not enumerate, hold BOOT (GPIO9) while pressing RESET.

## Modules

| Module | Role |
|---|---|
| `main/main.c` | init order, tasks (sensor 200 Hz, tx 100 Hz, housekeeping 1 Hz), watchdog feed, packet fan-out |
| `config/board_config.h` | **all** hardware-specific values (see below) |
| `config/config_store` | NVS: device id, name, packet rate, serial-stream flag, calibration |
| `sensor/mpu6050` | new `i2c_master` driver, 0x68 → 0x69 detection, WHO_AM_I, ±8 g / ±2000 dps, DLPF 98 Hz, health |
| `calibration/calibration` | stillness-gated state machine, quality score, auto re-bias, persistence |
| `motion/motion` | axis remap → body frame, bias removal, low-pass, complementary pitch/roll |
| `communication/protocol` | packet encoders / command decoder / CRC (mirror of `packages/protocol`) |
| `communication/ble_transport` | NimBLE peripheral, TX notify + RX write, reconnect, tx queue |
| `communication/serial_transport` | USB console (text) + optional binary stream for Web Serial |
| `communication/command_handler` | executes host commands from BLE, USB packets, or console lines |
| `power/battery` | ADC → mV → % (LiPo curve), low-battery flag, optional charger status |
| `diagnostics/diagnostics` | reset reason → error code, LED patterns, button, factory self-test |

## board_config.h — verify before the first flash

Every default is marked `UNVERIFIED`:

| Macro | Default | Check on the schematic |
|---|---|---|
| `BOARD_I2C_SDA_GPIO`, `BOARD_I2C_SCL_GPIO` | 6, 7 | MPU6050 wiring, external pull-ups |
| `BOARD_I2C_FREQ_HZ` | 400000 | |
| `BOARD_MPU_ADDR_PRIMARY`, `_FALLBACK` | 0x68, 0x69 | AD0 level |
| `BODY_X/Y/Z(x,y,z)` | identity | chip orientation so +X forward, +Y left, +Z up |
| `BOARD_STATUS_LED_GPIO` | 8 | many C6 boards have a WS2812 on 8, not a plain LED |
| `BOARD_BUTTON_GPIO` | 9 | usually BOOT |
| `BOARD_HAS_BATTERY_SENSE`, `BOARD_BATTERY_ADC_GPIO`, `BOARD_BATTERY_DIVIDER` | 0 | needs an ADC1 pin + divider; unknown battery is reported as 255 otherwise |

## Runtime behaviour

- **Boot**: NVS → config → LED → I2C + MPU (retry, then error code) → battery → BLE →
  tasks. Stored calibration is applied immediately; a fresh calibration starts when still.
- **Calibration**: `WAITING_STILL` (0.5 s still) → `SAMPLING` (≥400 samples) → `READY`;
  restarts on motion; `FAILED` after 20 s or if gravity ∉ 0.85–1.15 g; results persist; slow
  re-bias after 10 s of stillness.
- **Streaming**: MOTION 100 Hz (configurable 25–200), INFO 1 Hz, CALIBRATION on completion.
- **Commands**: see PROTOCOL.md. `SET_DEVICE_ID` decides whether the device announces as
  `AiroMote-1-xxxx` or `AiroMote-2-xxxx`; the app can also just connect either device to either slot.
- **Watchdog / safe restart**: both tasks feed the task WDT; repeated sensor failures restart
  the sensor, then the device; reset reason becomes `WATCHDOG_RESET` / `BROWNOUT_RESET` in INFO.
- **Factory test**: `FACTORY_TEST` command or `factory` console command runs boot / MPU /
  accel / gyro / calibration / wireless / battery / button / LED / NVS checks and streams
  progressive `FACTORY_RESULT` packets (see FACTORY_TEST.md).
- **Factory reset**: `RESET_FACTORY` command, `reset` console command, or hold the button 5 s.
- **OTA-ready**: `partitions.csv` has `ota_0`/`ota_1` + `otadata`; a future updater only needs
  to write the inactive slot with `esp_ota_*` — no partition change.

## Versioning

`-DAERO_FW_MAJOR/MINOR/PATCH`, `-DAERO_FW_BUILD`, `-DAERO_HW_REV` in `platformio.ini` are
reported in every INFO packet and shown in Settings → Developer and the factory test page.
Protocol version is `1` (`protocol.h` / `packages/protocol/src/constants.ts`).
