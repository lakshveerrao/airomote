# AiroMote — two motion controllers, one app

AiroMote is a pair of handheld motion controllers (ESP32-C6 Mini + MPU6050, battery powered,
Bluetooth LE) and a browser app that turns the same two remotes into a kart-racing controller,
two drumsticks, a guitar (chord hand + strumming hand) and a workout rep counter.

The firmware never decides what a movement *means*. It streams calibrated motion packets; the
app's motion engine turns them into gestures, a configurable mapping turns gestures into
universal actions (`TILT_LEFT`, `STRIKE`, `STRUM_DOWN`, `ACCELERATE` …), and each activity
consumes only those actions. WASD is a testing fallback that produces the same actions.

```
movement → MPU6050 → ESP32-C6 firmware → 32-byte packets (BLE / USB)
        → transport → controller manager → motion engine → action mapper → activity
```

**Version 1 experiences:** Motion Kart · Drums · Guitar · Squats · Push-ups. Everything else
is a Coming Soon card.

## Repository

| Path | What |
|---|---|
| `apps/web` | React + TypeScript + Vite PWA (Three.js / React Three Fiber, Web Audio) |
| `firmware/controller` | ESP-IDF firmware for the controllers (PlatformIO project, also plain IDF) |
| `packages/protocol` | packet format, codec, stream reassembly, sequence tracking |
| `packages/motion-core` | motion engine: filters, orientation, gesture detectors, synthetic streams |
| `packages/activity-engine` | universal actions, mapping presets, activity definitions/registry |
| `packages/music-engine` | Web Audio drum kit + Karplus-Strong guitar |
| `tests` | end-to-end pipeline tests (simulator → manager → engine → mapper) |
| `docs` | ARCHITECTURE · PROTOCOL · FIRMWARE · MOTION_ENGINE · ACTIVITY_SYSTEM · MUSIC_ENGINE · FACTORY_TEST · TROUBLESHOOTING |

## Hardware

Per controller: ESP32-C6 Mini module/board, MPU6050 on I²C (0x68, 0x69 auto-detected),
Li-Po battery (+ optional divider to an ADC1 pin for battery %), optional status LED and
button. Both controllers run the identical firmware; the slot (Controller 1 / 2) is chosen by
where you connect it in the app and can be stored on the device (`SET_DEVICE_ID`).

Exact GPIOs depend on your board revision — set them in
`firmware/controller/main/config/board_config.h` (all defaults are marked UNVERIFIED). See
[docs/FIRMWARE.md](docs/FIRMWARE.md).

## Web app

Requirements: Node 20+ (tested on 24), Chrome or Edge (Web Bluetooth / Web Serial).

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm test             # vitest: protocol, motion, mapping, music, detectors, kart core, pipeline
npm run typecheck    # tsc across packages and app
npm run build        # production build + service worker (apps/web/dist)
npm run preview      # serve the production build
```

Install as an app: open the site in Chrome/Edge → *Install AiroMote*. The app shell, activities,
3D scenes and synthesised audio all work offline; nothing needs a server.

## Firmware

```bash
python -m platformio run -d firmware/controller               # build
python -m platformio run -d firmware/controller -t upload     # flash over the board's USB port
python -m platformio device monitor -d firmware/controller -b 115200
```

First build compiles ESP-IDF (10–25 min); later builds take seconds. Output
`firmware/controller/.pio/build/aero_c6/firmware.bin`. Console commands: `help info cal id 1|2
name <x> rate <hz> stream on|off factory identify reset reboot`.

## First run

1. Open the app → **Setup** starts automatically.
2. Turn on Controller 1 → **Connect** (Bluetooth picker shows `AiroMote-…`; USB also works).
3. Turn on Controller 2 → Connect (or *Skip* to use one controller).
4. Put both controllers down for a moment: **Hold still → Calibrating → Ready** happens on the
   device automatically (gyro offsets, accelerometer baseline, neutral pose). No numbers shown.
5. Move them: two 3D controllers mirror your movement. **Done** → Home.

Later: Settings → Controllers lets you rename, swap 1↔2, recalibrate each or both, identify
(LED blink), disconnect and forget. Bluetooth devices you have permitted are reconnected
automatically on the next launch where the browser allows it.

## Automatic calibration

On power-up the firmware checks the MPU6050, waits until the controller is still, samples ~2 s,
computes gyro offsets and the resting accelerometer baseline, checks gravity magnitude, saves
the result to flash and starts streaming with the `CALIBRATED` flag. Standing still for 10 s
later triggers a gentle re-bias; nothing is ever recalibrated while moving. The app captures
the pose at that moment as the activity **neutral** (steering centre, drum aim centre) and
adds its own slow host-side gyro-bias tracking. Manual: Settings → Recalibrate; inside an
activity: Pause → Re-centre.

## Using the five experiences

- **Motion Kart** (Games): hold a controller like a wheel. Tilt left/right to steer, tip
  forward to accelerate, back to brake, shake to boost. Presets: Motion Steering (one
  controller), Dual Controller (1 steers, 2 is the throttle), Gesture Steering (rotate like a
  dial), Keyboard (testing). Sensitivity Low/Normal/High. 3 laps, 3 opponents, lap times.
- **Drums** (Music): two controllers are sticks. Turn a stick to aim — the target drum lights
  up (hi-hat, snare, toms, floor; raise the stick for crash/ride) — flick down to hit. Hit
  harder for louder. Forward jab = kick. Both sticks are independent.
- **Guitar** (Music): Controller 1 is the fret hand: tilt left C, right G, forward Am, back F,
  turn left Em, right D. Controller 2 strums: swing down / up; harder = louder; shake to mute.
- **Squats** (Workout): hold one controller against your chest. Stand still 1.5 s, then squat.
  Reps count only for STANDING → DESCENDING → BOTTOM → ASCENDING → STANDING with enough depth
  and a plausible duration. Live reps, timer, phase, rhythm hint; summary with average rep
  time and consistency; history saved locally.
- **Push-ups** (Workout): strap/tuck one controller on your upper arm (front toward the
  elbow). Get into the top position, hold still, go. Same state-machine validation.

## Simulator (no hardware needed)

Settings → Developer Mode → **Diagnostics & Simulator** (`/settings/developer`). Connect a
*Simulated* controller into either slot: it emits real encoded packets through the same
transport → decoder → engine → mapper path, including a boot calibration sequence, battery,
packet-loss and dropout injection. Pose pad / sliders, Strike, Swing, Shake, and workout
helpers (`simulateSquat`, `simulatePushup`) drive every activity. In activity intros the
*Simulate* button appears when Developer Mode is on. From the console:
`window.__aero.controllerManager.connect(1, 'simulator')`.

Keyboard fallback (development/accessibility only) generates the same universal actions:
Motion Kart W/A/S/D or arrows, Shift boost; Drums 1–7 aim, Space hit, K kick; Guitar 1–6 chords,
Q/E strum, M mute. The optional Gamepad adapter maps a standard pad the same way.

## Adding an activity or a mapping

See [docs/ACTIVITY_SYSTEM.md](docs/ACTIVITY_SYSTEM.md). Short version: add
`apps/web/src/activities/<id>/definition.ts` (roles, mapping presets, setup steps) and a
full-screen component, register both in `activities/index.ts`. A new mapping is one rule in a
preset (`tiltAxis`, `rateAxis`, `tiltZone`, `gesture`, `zone`, …). No firmware changes.

## Developer Mode

Settings → Developer Mode shows raw and filtered accel/gyro, orientation, packet rate, latency,
loss, sequence stats, calibration offsets, host bias, gesture/action/connection logs, a live
oscilloscope and 3D mirror, motion config, and the simulator. Normal screens never show numbers.

## Factory test

Settings → Developer → **Factory Test**: connect a unit, read identity, *Run tests*, get
PASS/FAIL per check (boot, MPU, accel, gyro, calibration, wireless, battery, button, LED,
storage) and a final CONTROLLER PASSED / FAILED verdict with a copyable report. Details in
[docs/FACTORY_TEST.md](docs/FACTORY_TEST.md).

## Known browser limitations

- Web Bluetooth and Web Serial: Chrome / Edge (desktop, Android for BLE) on https or
  localhost. Not in Firefox or Safari. Linux Chrome may need the Web Bluetooth flag.
- Silent reconnect after reload relies on `navigator.bluetooth.getDevices()`; otherwise one
  click reconnects.
- WebHID transport is prepared but inactive (the firmware exposes BLE + USB-CDC).
- Background tabs throttle timers → motion stalls; keep AiroMote in the foreground. Headless
  browsers throttle even harder (screenshot scripts accept `HEADED=1`).
- Audio starts after the Start click (autoplay policy).

## Testing

`npm test` runs 98+ tests: protocol codec/validation/stream/sequence, motion filters and
gesture detectors with noisy input, action mapping and role resolution, music engine, squat and
push-up state machines (clean reps, half reps, shaking, holds), kart race core, and the
end-to-end pipeline (one and two controllers, dropout/reconnect, packet loss, commands, swap,
factory results). Visual checks: `apps/web/scripts/screenshot*.mjs` (Playwright).

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## What is deliberately not built

Accounts, cloud sync, payments, leaderboards, multiplayer, CMS, chatbots, or extra games,
instruments and workouts beyond the five above. The architecture supports them; V1 ships the
five experiences working end to end.
