/**
 * @file calibration.h
 * @brief Automatic gyro/accel calibration state machine.
 *
 *   NONE → WAITING_STILL → SAMPLING → READY
 *                 ↑            │
 *                 └── motion ──┘         (timeout 20 s → FAILED, stored offsets stay in use)
 *
 * - Stillness = gyro & accel variance over a 0.5 s window below thresholds.
 * - SAMPLING collects ≥ 400 samples (2 s @ 200 Hz); result = mean gyro (offset), mean accel
 *   (resting baseline). Gravity magnitude must be 0.85–1.15 g, else FAILED (UNSTABLE).
 * - READY: while stationary for ≥ 10 s the offsets are slowly blended toward the current
 *   mean (auto re-bias for thermal drift). Never during motion.
 * All vectors are in the body frame.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint8_t state;             /* AERO_CAL_* */
    float gyro_offset_dps[3];
    float accel_baseline_g[3];
    uint8_t quality;           /* 0..100 */
    uint16_t sample_count;
    bool just_completed;       /* set for one poll after READY/FAILED, cleared by calibration_take_event() */
    bool stationary;           /* current stillness estimate */
} calibration_t;

/** Reset to WAITING_STILL. If stored offsets exist they remain active until replaced. */
void calibration_begin(void);

/** Load previously stored offsets (from NVS) as the active set — state stays NONE until begin(). */
void calibration_load_stored(const float gyro_offset_dps[3], const float accel_baseline_g[3], uint8_t quality);

/** Feed one raw body-frame sample at the sensor rate. */
void calibration_feed(const float accel_g[3], const float gyro_dps[3], uint32_t now_ms);

const calibration_t *calibration_get(void);

/** Returns true once after a calibration completes (READY or FAILED); clears the flag. */
bool calibration_take_event(void);

/** Active gyro offsets (stored or fresh) — what motion.c subtracts. */
void calibration_active_offsets(float gyro_offset_dps[3]);
