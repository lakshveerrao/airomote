# Aero controller firmware (ESP32-C6 Mini + MPU6050)

ESP-IDF 6.0 firmware for the two Aero motion controllers. Each controller streams calibrated
motion packets over Bluetooth LE (NimBLE) — and optionally over USB — using the versioned
32-byte protocol shared with the web app (`packages/protocol`).

## Framework decision: ESP-IDF (via PlatformIO)

ESP-IDF was chosen over Arduino because on the ESP32-C6 it gives us:

- **NimBLE directly**, with control over connection interval (7.5–15 ms), MTU negotiation and
  a non-blocking notify queue — this is what keeps motion latency low and stable.
- **Production plumbing**: NVS for config/calibration, task watchdog, brownout detector,
  reset-reason reporting, and an **OTA-ready partition table** (two app slots) from day one.
- **Deterministic tasks**: a 200 Hz sensor task with `vTaskDelayUntil` and a 1 kHz tick.
- The PlatformIO `espidf` framework wraps the same IDF, so the project is also a plain
  IDF project (`idf.py set-target esp32c6 && idf.py build`).

Arduino-ESP32 3.x would have worked but adds a large abstraction layer, slower BLE
(Bluedroid by default) and no straightforward partition/OTA/watchdog story.

## Build / flash / monitor

```bash
# from the repo root (PlatformIO Core 6.x, platform espressif32 ≥ 7 with framework-espidf 6.x)
python -m platformio run -d firmware/controller                 # build
python -m platformio run -d firmware/controller -t upload       # flash over the USB-C port
python -m platformio device monitor -d firmware/controller -b 115200
```

The first build compiles the whole IDF (several minutes). Output: `.pio/build/aero_c6/firmware.bin`.

Plain ESP-IDF alternative:

```bash
cd firmware/controller
idf.py set-target esp32c6 && idf.py build && idf.py -p COMx flash monitor
```

Flashing uses the ESP32-C6's native USB Serial/JTAG port — no external UART bridge. If the
board does not enumerate, hold BOOT (GPIO9) while pressing RESET.

## Module layout (`main/`)

| Path | Responsibility |
| --- | --- |
| `main.c` | Init order, tasks (sensor 200 Hz, tx, housekeeping), watchdog, packet fan-out |
| `config/board_config.h` | **Every hardware-specific value** (GPIOs, I2C, battery divider, axis remap) |
| `config/config_store.*` | NVS: device id, name, packet rate, serial-stream flag, stored calibration |
| `sensor/mpu6050.*` | I2C master driver, 0x68/0x69 detection, WHO_AM_I, ±8 g / ±2000 dps, DLPF 98 Hz, health check |
| `calibration/calibration.*` | Automatic stillness-gated calibration state machine, auto re-bias, persistence |
| `motion/motion.*` | Axis remap → body frame, bias removal, low-pass, complementary pitch/roll |
| `communication/protocol.*` | 32-byte packet encoders, command decoder, CRC-16/CCITT-FALSE |
| `communication/ble_transport.*` | NimBLE peripheral: service `7a3e0001-…`, TX notify / RX write, reconnect, tx queue |
| `communication/serial_transport.*` | USB Serial/JTAG text console + optional binary stream |
| `communication/command_handler.*` | Executes host commands (BLE, USB packets, console lines) |
| `communication/transport.h` | Fan-out API (`transport_send_packet`) implemented in `main.c` |
| `power/battery.*` | ADC + calibration → mV → %, low-battery flag, charger status |
| `diagnostics/diagnostics.*` | Reset reason → error code, LED patterns, button, factory self-test |

## What to change in `board_config.h` (before the first flash)

All defaults are marked `UNVERIFIED`. Check the schematic of your ESP32-C6 Mini board and set:

| Macro | Default | Verify |
| --- | --- | --- |
| `BOARD_I2C_SDA_GPIO` / `BOARD_I2C_SCL_GPIO` | 6 / 7 | Pins wired to the MPU6050; presence of pull-ups (`BOARD_I2C_INTERNAL_PULLUPS`) |
| `BOARD_MPU_ADDR_PRIMARY/FALLBACK` | 0x68 / 0x69 | AD0 pin level on the MPU6050 breakout |
| `BODY_X/Y/Z(x,y,z)` | identity | Sensor orientation on the PCB so +X = forward, +Y = left, +Z = up |
| `BOARD_STATUS_LED_GPIO` (+`_ACTIVE_HIGH`) | 8 | Plain LED pin (many devkits have a WS2812 on GPIO8 instead) |
| `BOARD_BUTTON_GPIO` (+`_ACTIVE_LOW`) | 9 | Usually the BOOT button |
| `BOARD_HAS_BATTERY_SENSE` | 0 | Set 1 only with a divider on an **ADC1** pin; then set `BOARD_BATTERY_ADC_GPIO/_CHANNEL`, `BOARD_BATTERY_DIVIDER` |
| `BOARD_HAS_CHARGE_STATUS` | 0 | Charger STAT pin if wired |

With `BOARD_HAS_BATTERY_SENSE=0` the controller reports battery = unknown and the app hides it.

## Rates (and why)

| Stage | Rate | Notes |
| --- | --- | --- |
| MPU6050 sampling | 200 Hz | DLPF 98 Hz; enough bandwidth for strikes/strums, low aliasing |
| Motion packets | 100 Hz (default, 25–200 via `rate`) | Every 2nd filtered sample; ≈ 3.2 kB/s per controller |
| BLE connection interval | 7.5–15 ms requested | Two packets can share one notification when MTU ≥ 67 |
| INFO packet | 1 Hz | Identity, battery, error code |
| Calibration packet | on completion | Offsets + quality |

## Automatic calibration

On boot (and on the `RECALIBRATE` command): `WAITING_STILL` → stillness detected for 0.5 s →
`SAMPLING` (≥ 400 samples, 2 s) → `READY`. Motion during sampling restarts it; 20 s without
stillness → `FAILED` while the last stored offsets stay active. Gravity must read 0.85–1.15 g
or the run is rejected (`CALIBRATION_UNSTABLE`). Once ready, 10 s of stillness triggers a slow
re-bias blend (never during motion). Results persist in NVS so a rebooted controller is
usable immediately while the fresh calibration runs.

## Serial console (115200, USB port)

`help`, `info`, `cal`, `id 1|2`, `name <text>`, `rate <hz>`, `stream on|off`, `factory`,
`identify`, `reset` (factory reset + reboot), `reboot`. The same port accepts raw 32-byte
COMMAND packets; with `stream on` it also carries the binary motion stream for the web app's
Web Serial transport.

## LED patterns

booting: fast blink · calibrating: 1 Hz blink · ready: heartbeat, solid while connected ·
error: double blink · identify: rapid blink 1.5 s · button held 5 s: factory reset.

## Error codes (INFO byte 23)

| Code | Meaning | Typical fix |
| --- | --- | --- |
| 1 | MPU_NOT_FOUND | Check SDA/SCL GPIOs, wiring, power to the MPU6050 |
| 2 | MPU_WHOAMI_MISMATCH | Unknown sensor; a 0x70/0x72 clone is accepted with a warning |
| 3 | MPU_READ_FAILED | Bus errors at runtime; restart after ~10 s of failures |
| 4 | CALIBRATION_TIMEOUT | Controller never held still for 2 s |
| 5 | CALIBRATION_UNSTABLE | Gravity out of range (sensor range/orientation issue) |
| 6 | NVS_FAILED | Flash/partition problem; `reset` |
| 7 | BLE_INIT_FAILED | NimBLE could not start (check sdkconfig) |
| 8 | BATTERY_READ_FAILED | ADC error |
| 9 / 10 | WATCHDOG_RESET / BROWNOUT_RESET | Previous boot ended abnormally; check power |

## Factory self-test

Trigger with the `FACTORY_TEST` command (web Factory Test page) or `factory` on the console.
Results stream as `FACTORY_RESULT` packets in this order: boot, mpuDetected, accelerometer,
gyroscope, calibration, wireless, battery, button (press it within 6 s, else SKIPPED), led
(blinks 1.5 s, technician confirms), nvs.

## OTA readiness

`partitions.csv` provides `ota_0`/`ota_1` (1.9 MB each) + `otadata`. The image is built for OTA
slots, so adding an update path later (BLE or USB transfer into the inactive slot with
`esp_ota_*`) needs no partition change.
