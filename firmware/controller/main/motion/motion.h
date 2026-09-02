/**
 * @file motion.h
 * @brief Chip → body frame remap, bias removal, light low-pass, pitch/roll estimate.
 *
 * Output units match the wire format: milli-g, 0.1 deg/s, 0.01 deg.
 * Body frame: +X forward, +Y left, +Z up. pitch > 0 nose up, roll > 0 right side down
 * (identical to the web app's motion-core conventions).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "sensor/mpu6050.h"

typedef struct {
    float accel_g[3];    /* body frame, raw (bias not applied to accel) */
    float gyro_dps[3];   /* body frame, bias removed, lightly filtered */
    float gyro_raw_dps[3];
    int16_t accel_mg[3];
    int16_t gyro_ddps[3];
    int16_t pitch_cdeg;
    int16_t roll_cdeg;
    bool stationary;
} motion_sample_t;

void motion_init(void);

/** Process one chip-frame sample; dt in seconds. */
void motion_update(const mpu6050_sample_t *in, float dt, motion_sample_t *out);

/** Body-frame remap only (used to feed the calibration with raw body-frame data). */
void motion_remap(const mpu6050_sample_t *in, float accel_body_g[3], float gyro_body_dps[3]);
