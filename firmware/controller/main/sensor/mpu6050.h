/**
 * @file mpu6050.h
 * @brief MPU6050 driver on the IDF i2c_master API. Detects 0x68 then 0x69.
 *
 * Configuration: ±8 g, ±2000 dps, DLPF 98 Hz (gyro/accel), 1 kHz base / divider 4 → 200 Hz.
 * Readings are returned in the chip frame in physical units; the axis remap to the body
 * frame happens in motion.c using the BODY_* macros from board_config.h.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

typedef struct {
    float accel_g[3];   /* chip frame, g */
    float gyro_dps[3];  /* chip frame, deg/s */
    float temp_c;
} mpu6050_sample_t;

typedef struct {
    bool found;
    uint8_t address;      /* 0x68 / 0x69 / 0 */
    uint8_t who_am_i;
    bool whoami_ok;       /* genuine 0x68 or accepted clone */
    bool clone_warning;   /* WHO_AM_I was 0x70/0x72 (MPU6500/6050 clone) */
    uint32_t read_errors;
} mpu6050_status_t;

/** Create the I2C bus, probe both addresses, verify WHO_AM_I and configure the sensor. */
esp_err_t mpu6050_init(void);

/** Burst-read accel/temp/gyro (14 bytes). */
esp_err_t mpu6050_read(mpu6050_sample_t *out);

/** Probe every 7-bit address on the bus; returns how many responded (for wiring diagnostics). */
size_t mpu6050_scan_bus(uint8_t *found, size_t max);

/**
 * Health check: WHO_AM_I readable, accel magnitude plausible (0.5–1.5 g while at rest),
 * gyro not saturated. Fills flags bit0 whoami, bit1 accel, bit2 gyro.
 */
esp_err_t mpu6050_health_check(uint8_t *sensor_flags);

const mpu6050_status_t *mpu6050_status(void);
