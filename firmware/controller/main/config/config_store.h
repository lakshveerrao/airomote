/**
 * @file config_store.h
 * @brief Persistent configuration in NVS (namespace "aero").
 *
 * Stored: device id (1/2), user name, packet rate, serial-stream flag, and the last good
 * calibration (gyro offsets / accel baseline) so the controller is usable immediately
 * after boot while the fresh calibration runs.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#define AERO_NAME_MAX 20

typedef struct {
    uint8_t device_id;               /* 1 or 2 */
    char name[AERO_NAME_MAX + 1];
    uint8_t packet_rate_hz;          /* 25..200 */
    bool serial_stream;              /* binary packets over USB serial */
    bool has_calibration;
    float gyro_offset_dps[3];        /* body frame */
    float accel_baseline_g[3];       /* body frame, at rest */
    uint8_t calibration_quality;     /* 0..100 */
    uint32_t boot_count;
} aero_config_t;

/** Initialise NVS (erasing and re-initialising if the partition is corrupt/outdated). */
esp_err_t config_store_init(void);

/** Load config from NVS into @p cfg, applying defaults for missing keys. */
esp_err_t config_store_load(aero_config_t *cfg);

/** Persist the whole config. */
esp_err_t config_store_save(const aero_config_t *cfg);

/** Erase the "aero" namespace (factory reset). */
esp_err_t config_store_erase(void);

/** Write a self-test value and read it back — used by the factory test. */
bool config_store_selftest(void);

/** Global, loaded once at boot. */
extern aero_config_t g_config;
