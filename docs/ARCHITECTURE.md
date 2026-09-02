# Architecture

```
Physical movement
  → MPU6050 (200 Hz)                      firmware/controller/main/sensor
  → calibration + filtering                firmware/controller/main/{calibration,motion}
  → 32-byte motion packets (100 Hz)        firmware/controller/main/communication  ·  packages/protocol
  → BLE notify / USB serial
  → ControllerTransport                    apps/web/src/core/transport/{bluetooth,serial,hid,simulator}.ts
  → ControllerManager                      apps/web/src/core/ControllerManager.ts
      (stream decode, sequence tracking, INFO/CALIBRATION bookkeeping, commands)
  → MotionEngine                           packages/motion-core
      (filters, orientation, stationary, gestures, confidence)
  → ActionMapper (preset × roles)          packages/activity-engine
      universal actions: TILT_*, SWING_*, STRIKE, STRUM_*, ACCELERATE, CONTINUOUS_X …
  → ActionBus / ActionState                apps/web/src/core/session.ts
  → Activity component                     apps/web/src/activities/<id>/
      Motion Kart · Drums · Guitar · Squats · Push-ups
```

The same physical tilt therefore means "steer" in Motion Kart, "aim at a drum" in Drums, "pick
a chord" in Guitar and "part of a rep" in a workout, purely by configuration.

## Monorepo

| Path | Purpose |
|---|---|
| `packages/protocol` | Packet layout, encoders/decoders, stream reassembly, sequence tracking, device clock. Pure TS, no browser APIs. |
| `packages/motion-core` | Motion engine: filters, complementary orientation, gesture state machines, per-controller processor, synthetic packet generator for tests/simulator. |
| `packages/activity-engine` | Universal actions, mapping rules/presets, `ActionMapper`, activity definition contract, registry, role resolution. |
| `packages/music-engine` | Web Audio engine, synthesised drum kit, Karplus-Strong guitar. Injectable AudioContext for tests. |
| `apps/web` | React + Vite PWA: transports, controller manager, stores, features (home/setup/settings/diagnostics/workout) and activities. |
| `firmware/controller` | ESP-IDF firmware for ESP32-C6 + MPU6050. |
| `tests/` | End-to-end pipeline tests (simulator transport → manager → engine → mapper). |

## Key rules

1. **Transports move bytes only.** They never know about packets or activities. Adding a
   WebSocket bridge or WebHID means one new class implementing `ControllerTransport`.
2. **Everything motion-related enters through `MotionEngine.ingest(packet)`.** Real controllers
   and the simulator both produce real encoded packets, so the simulator exercises the exact
   production path (decoder → sequence → engine → mapper).
3. **Activities consume actions, never keys or packets.** Keyboard and gamepad are extra
   `ActionEvent` sources for testing/accessibility. Workouts additionally read the role's
   `ControllerMotionState` for their exercise detectors (raw motion → detector → state machine →
   rep validation → metrics) — still through the engine, never through a transport.
4. **Roles, not hands.** Activities declare roles (`driver`, `stick1`, `fret`, `body`…) and a
   default assignment; `resolveRoles()` adapts to what is connected (one or two controllers) and
   the user's preference (swap). Controller 1/2 are just slots.
5. **No motion data through React state.** Hot paths use refs and direct subscriptions;
   UI-facing state (connection, battery, calibration) is throttled to ~60 Hz.
6. **Normal UI shows words, not numbers.** Raw values live only in Settings → Developer Mode.

## Two-controller model

`ControllerManager` owns two slots. Each slot has at most one transport. Packets carry the
device's configured `deviceId`, but the slot is chosen by where the user connected, so a device
configured as "2" plugged into slot 1 still works; **Swap** exchanges slots without reconnecting.
`MotionEngine` keeps an independent `ControllerProcessor` (filters, orientation, gesture state
machines, neutral pose) per slot.

## Calibration flow

Firmware: boot → MPU health → wait until still → sample ≥2 s → gyro offsets + accel baseline →
persist → stream with `CALIBRATED` flag; auto re-bias when still for 10 s; never during motion.
Host: shows *Hold still → Calibrating → Ready*; on READY captures the current orientation as the
activity **neutral** (steering centre, drum aim centre). Host-side `GyroBiasTracker` catches slow
drift. Manual: Settings → Recalibrate (sends `RECALIBRATE`); activities have "Re-centre".

## Adding activity #100

1. `apps/web/src/activities/<id>/definition.ts` — `ActivityDefinition` (roles, presets of
   mapping rules, setup steps, keyboard fallback, optional motion overrides).
2. `apps/web/src/activities/<id>/<Name>.tsx` — full-screen component using
   `useActivitySession(definition)` + `ActivityChrome`.
3. Register both in `apps/web/src/activities/index.ts`.

No firmware, protocol, transport or motion-engine change. See ACTIVITY_SYSTEM.md.

## Persistence

`localStorage` via zustand `persist`: settings (`aero.settings.v1`) and session history
(`aero.history.v1`). History is a flat list of `ActivitySessionRecord`, ready to sync to an
account later without schema changes. No login, no server, works offline (PWA shell + assets).
