# Factory Test

For assembling the first ~100 controllers. One technician, one laptop with Chrome/Edge, the
Aero web app (installed as a PWA or `npm run dev`), one controller at a time.

## Where

Settings → Developer Mode (on) → **Factory Test** (`/settings/factory`). The page is written
for the assembly bench: big status, PASS/FAIL per check, one final verdict.

## Procedure

1. **Flash** the firmware (`python -m platformio run -d firmware/controller -t upload`). The LED
   fast-blinks on boot, then blinks at 1 Hz while calibrating, then heartbeats.
2. **Connect** the controller in Step 1 of the page — Bluetooth (picker shows `Aero-…`) or USB.
3. **Identity** appears automatically from the INFO packet: firmware version/build, hardware
   revision, unique id, controller id, battery. Use *Set as Controller 1 / 2* to assign the slot
   id that will be printed on the unit. *Identify* blinks the LED to confirm which unit it is.
4. Press **Run tests**. The device runs its self-test and streams progressive results; the host
   adds its own checks. Follow the on-screen prompt ("Tilt the controller").
5. Read the verdict: **CONTROLLER PASSED** (green) or **CONTROLLER FAILED** (red, with the failed
   items). *Copy report* puts id / firmware / date / results on the clipboard for the batch log.
6. **Test next controller** disconnects and resets the page.

## Checks

| Check | Device side | Host side |
|---|---|---|
| ESP32 boot | reset reason normal, no error code | INFO packet received |
| MPU6050 detected | WHO_AM_I at 0x68 or 0x69 | INFO `mpuAddress` ≠ 0, sensor flags |
| Accelerometer | |a| within 0.85–1.15 g at rest, non-constant samples | pitch changes > 30° when tilted within 10 s |
| Gyroscope | non-zero, non-saturated readings | angular speed > 100 °/s during the tilt |
| Calibration | reaches READY, quality ≥ threshold | slot calibration phase reaches *ready* |
| Wireless | BLE connected + notifications subscribed | packet rate ≥ 50 Hz for 2 s, loss < 5 % |
| Battery | ADC read succeeds (if `BOARD_HAS_BATTERY_SENSE`) else SKIPPED | value present |
| Button / LED | detected / driven if configured, else SKIPPED | — |
| Storage (NVS) | write + read back a test key | — |

Result codes in the packet: 0 pending, 1 pass, 2 fail, 3 skipped. Overall PASS requires every
non-skipped check to pass. Skipped hardware (no battery divider, WS2812 instead of a plain LED)
does not fail a unit.

## Simulator

For training or demoing the bench flow without hardware, the page accepts a *Simulated*
controller (Developer Mode). `SimulatedController.failFactoryTest` in Developer → Simulator
forces a chosen check to FAIL to see the red path.
