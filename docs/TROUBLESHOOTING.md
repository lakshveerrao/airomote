# Troubleshooting

## Connecting

| Symptom | Cause / fix |
|---|---|
| No **Bluetooth** button, only USB | Web Bluetooth needs Chrome or Edge on a secure origin (https or localhost). Firefox/Safari do not support it — use Chrome/Edge, or USB (Web Serial). |
| Picker shows no `Aero-…` device | Controller not powered / not advertising (LED should heartbeat). Already connected to another tab or the OS Bluetooth panel — disconnect there. On Linux enable the experimental Web Bluetooth flag. |
| Connects, then "Reconnecting…" repeatedly | Weak link or interference; move closer, remove USB 3 hubs near the dongle. The app retries with back-off up to ~1 minute. |
| USB connect fails | The console is busy in another program (PlatformIO monitor). Close it. Type `stream on` in the console once so the port carries the binary stream. |
| Connected but "Not connected" in Aero after a page reload | Chrome only auto-reconnects previously permitted devices with `getDevices()` available; otherwise connect again (one click). |

## Calibration

| Symptom | Fix |
|---|---|
| Stuck on **Hold still** | The controller is moving or vibrating (table with a running laptop fan, hand tremor). Put it down on a stable surface for 3 s. |
| **Calibration failed** | Gravity out of range: sensor range or axis remap wrong (`board_config.h`), or the MPU is a clone with bad scaling. Check Developer → raw accel ≈ (0, 0, 1) at rest. |
| Steering / aim drifts to one side | Re-centre: pause → *Re-centre controllers*, or Settings → Recalibrate. Check *Auto re-centre* is on. Drift after 30 s of stillness is expected to relax back automatically. |
| Yaw (drums aim, Em/D chords) drifts | MPU6050 has no compass; relative heading is gyro-only and decays to centre while still. Re-aim with a small deliberate turn. |

## Motion feel

| Symptom | Fix |
|---|---|
| Steering too twitchy / too lazy | Intro → Sensitivity Low/Normal/High (per activity). |
| Strikes missed / double hits | Sensitivity High for lighter sticks; Low if you play hard. Check packet rate ≥ 80 Hz in Developer — below that, check BLE interference. |
| Squats not counted | Hold the controller against the chest (front up) and complete the full range; small partial squats are rejected on purpose. Stand still 1.5 s after Start for calibration. |
| Push-ups not counted | Controller must be on the **upper arm**, not in the hand (the hand does not move). Arm angle must change ≥ 35°. |
| Low frame rate in 3D activities | Aero picks a scene quality tier from the GPU (shadows off and lower pixel ratio on integrated GPUs). Force it with `localStorage.setItem('aero.sceneQuality','low')` (or `'high'`) and reload. Close other GPU-heavy tabs. |
| Noticeable lag | Close other tabs using the GPU; keep the app in the foreground (background tabs throttle timers). BLE interval set by the OS may be 30 ms on some laptops. |

## Developer

| Symptom | Fix |
|---|---|
| Packet rate shows 1–5 Hz in headless/automated browsers | Headless Chromium throttles timers and rAF; use a visible browser window (the screenshot scripts accept `HEADED=1`). |
| `vitest` fails on `tests/pipeline.test.ts` timing | These tests use fake timers; run with the repo's `vitest.config.ts` (`npm test`). |
| Firmware build: `strncpy` / `-Werror` errors | IDF 6 enables `-Werror` for some string warnings; use bounded `memcpy` as in `command_handler.c`. |
| Firmware build: NimBLE symbol clash `ble_transport_init` | NimBLE owns that symbol; our API is prefixed `aero_ble_*`. |
| `MPU_NOT_FOUND` | SDA/SCL swapped or wrong GPIO; verify with the `info` console command and `board_config.h`. |
| LED does nothing | Many ESP32-C6 boards have a WS2812 RGB LED on GPIO8, not a plain LED. Set the real LED pin or leave `BOARD_STATUS_LED_GPIO` at −1. |

## Reset everything

Settings → Danger zone → *Reset all settings* (clears local settings and workout history), and
on the device `RESET_FACTORY` (Developer page) or hold the button 5 s.
