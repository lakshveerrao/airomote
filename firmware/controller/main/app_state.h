/**
 * @file app_state.h
 * @brief Small shared runtime state (single writer per field, plain loads/stores).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "communication/protocol.h"

typedef struct {
    uint8_t device_id;          /* 1 or 2 (0 = unassigned) */
    uint8_t status;             /* AERO_STATUS_* bit flags */
    uint8_t calibration_state;  /* AERO_CAL_* */
    uint8_t error_code;         /* AERO_ERR_* */
    uint8_t battery_pct;        /* 0..100 or AERO_BATTERY_UNKNOWN */
    uint16_t battery_mv;        /* 0 = unknown */
    uint8_t mpu_addr;           /* 0x68 / 0x69 / 0 */
    uint8_t sensor_flags;       /* bit0 whoami ok, bit1 accel ok, bit2 gyro ok */
    uint8_t mac[6];             /* BLE public address = unique id */
    uint8_t packet_rate_hz;     /* motion packets per second */
    bool diagnostics_mode;
    bool serial_stream;         /* binary packets on the USB port */
} app_state_t;

extern app_state_t g_app;

static inline void app_set_status(uint8_t flag, bool on)
{
    if (on) g_app.status |= flag; else g_app.status &= (uint8_t)~flag;
}

/** Record an error: sets the ERROR status bit and remembers the first code. */
static inline void app_set_error(uint8_t code)
{
    if (g_app.error_code == AERO_ERR_NONE) g_app.error_code = code;
    app_set_status(AERO_STATUS_ERROR, true);
}

/** Clear the error (e.g. sensor found on a later retry). */
static inline void app_clear_error(void)
{
    g_app.error_code = AERO_ERR_NONE;
    app_set_status(AERO_STATUS_ERROR, false);
}
