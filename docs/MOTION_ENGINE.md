# Motion Engine (`packages/motion-core`)

Input: decoded `MotionPacket`s (any source). Output: `ControllerMotionState` per controller and
`GestureEvent`s. Deterministic — time comes from packet timestamps — so it is fully unit-tested
with synthetic streams (`PacketSynth`).

## Frame and sign conventions

Body frame: **+X forward, +Y left, +Z up** (firmware remaps chip axes; see board_config.h).

| Angle / rate | Positive means | Derived from |
|---|---|---|
| pitch | front tips **up** | `atan2(ax, √(ay²+az²))`, rate = `−gyro.y` |
| roll | tilted to the **right** | `atan2(ay, az)`, rate = `gyro.x` |
| yaw (relative) | turned **left** (CCW from above) | integrated `gyro.z`; no magnetometer, so relative only |

## Pipeline per packet (`ControllerProcessor.process`)

1. **Timing** — `dt` from device timestamps, clamped (1–250 ms); gaps are not integrated.
2. **Stationary detection** — running std-dev of |accel| and |gyro| over 0.5 s below thresholds.
   Firmware's STATIONARY flag is also honoured.
3. **Gyro bias tracking** — `GyroBiasTracker` averages gyro only while provably still (never
   chases motion); firmware already removed boot bias, this catches thermal drift.
4. **Filtering** — dt-aware first-order low-pass: accel 25 Hz, gyro 40 Hz. Deliberately light to
   keep latency imperceptible; gesture detectors do their own peak logic.
5. **Orientation** — complementary filter (gyro weight 0.98; trust in the accelerometer is reduced
   when |accel| ≠ 1 g). Yaw integrates gyro z and **decays toward 0 while stationary**
   (`yawDecayDps`, default 2 °/s, 1 for Drums, 0.6 for Guitar) to bound drift — a still
   controller slowly "re-centres".
6. **Gravity removal** — `linearAccel = accel − gravity(orientation)`; `motionMagnitude`,
   `jerk` (spike indicator), `velocityHint` (leaky integration, a *speed hint* that decays in
   ~150 ms — never a position). We do not double-integrate to claim hand position: an MPU6050
   cannot do that reliably, and the product does not pretend it can.
7. **Neutral pose** — set automatically on the first stationary window and whenever firmware
   reports a fresh calibration, plus "Re-centre" in activities. `relative` orientation is what
   mappings use.
8. **Confidence** — 0..1 from calibration, packet rate, sensor saturation and neutral availability.
9. **Gesture detectors** (each a small state machine, all fed the same state):

| Detector | States / rule | Output |
|---|---|---|
| **Strike** | READY → DOWNSTROKE (nose-down rate + downward accel > 140 °/s eq.) → IMPACT (rate collapses to <45 % of peak or jerk spike) → RECOVERY (≥ 60 ms and slowed) → READY. Peak must exceed 220 °/s eq. or it is discarded as a wobble. | `strike` start/peak/end, intensity from peak rate + deceleration |
| **Swing** | dominant of 6 directional signals (pitch/yaw rates + linear accel) exceeds 120 °/s eq.; reported at its peak when it starts decaying; 80 ms cooldown | `swing` up/down/left/right/forward/back |
| **Shake** | ≥ 4 sign reversals of > 0.6 g on the dominant axis within 700 ms | `shake` start/peak/end |
| **Tilt** | relative roll / pitch with hysteresis (enter 18°, exit 10°), intensity to 55° | `tilt` left/right/forward/back start/peak/end |
| **Rotate** | relative yaw with hysteresis (enter 30°, exit 18°) | `rotate` left/right |

Sensitivity (Low/Normal/High) scales all thresholds (×1.35 / ×1 / ×0.75).

## Robustness

- Duplicate/late packets are dropped before processing (`SequenceTracker`); a reboot (device
  time going backwards, or a large sequence jump) resets tracking instead of counting thousands
  of "drops".
- Saturated or garbage values never produce NaN; confidence drops instead.
- `markDisconnected` resets filters and gesture state so a reconnect starts clean and no gesture
  is "half open".
- Two controllers are processed by independent processors; one striking never affects the other.

## Testing

`packages/motion-core/src/motion.test.ts` covers filters, orientation conventions, stationary /
neutral, duplicate/late/reboot handling, saturation, strike intensity scaling and no double count,
fast alternating strikes, no strike on slow tilt/noise, swing direction, tilt hysteresis, shake,
rotation, and two-controller independence. `PacketSynth` (also used by the browser simulator's
tests) generates physically consistent accel/gyro from an orientation path.
