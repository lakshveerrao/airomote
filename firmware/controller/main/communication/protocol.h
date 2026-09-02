/**
 * @file protocol.h
 * @brief Aero motion protocol v1 — 32-byte little-endian packets.
 *
 * MUST stay byte-for-byte identical to packages/protocol/src/{constants,codec}.ts.
 * Any layout change bumps AERO_PROTOCOL_VERSION in both places.
 *
 * Common header (bytes 0-7):
 *   0 magic 0xA5 | 1 version | 2 type | 3 deviceId | 4 status flags | 5 calibration state | 6-7 seq u16
 * Bytes 30-31: CRC-16/CCITT-FALSE over bytes 0-29.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define AERO_PROTOCOL_MAGIC   0xA5
#define AERO_PROTOCOL_VERSION 1
#define AERO_PACKET_SIZE      32
#define AERO_BATTERY_UNKNOWN  255

/* Packet types */
#define AERO_PKT_MOTION         0x01
#define AERO_PKT_INFO           0x02
#define AERO_PKT_CALIBRATION    0x03
#define AERO_PKT_FACTORY_RESULT 0x04
#define AERO_PKT_LOG            0x05
#define AERO_PKT_COMMAND        0x10

/* Host -> device commands (byte 8), args in bytes 9..29 */
#define AERO_CMD_NONE              0
#define AERO_CMD_RECALIBRATE       1
#define AERO_CMD_SET_DEVICE_ID     2
#define AERO_CMD_SET_RATE_HZ       3
#define AERO_CMD_FACTORY_TEST      4
#define AERO_CMD_RESET_FACTORY     5
#define AERO_CMD_REBOOT            6
#define AERO_CMD_IDENTIFY          7
#define AERO_CMD_GET_INFO          8
#define AERO_CMD_SET_NAME          9
#define AERO_CMD_ENTER_DIAGNOSTICS 10
#define AERO_CMD_EXIT_DIAGNOSTICS  11

/* Status flags (byte 4) */
#define AERO_STATUS_SENSOR_OK        (1u << 0)
#define AERO_STATUS_CALIBRATED       (1u << 1)
#define AERO_STATUS_STATIONARY       (1u << 2)
#define AERO_STATUS_LOW_BATTERY      (1u << 3)
#define AERO_STATUS_CHARGING         (1u << 4)
#define AERO_STATUS_BUTTON_PRESSED   (1u << 5)
#define AERO_STATUS_DIAGNOSTICS_MODE (1u << 6)
#define AERO_STATUS_ERROR            (1u << 7)

/* Calibration states (byte 5) */
#define AERO_CAL_NONE          0
#define AERO_CAL_WAITING_STILL 1
#define AERO_CAL_SAMPLING      2
#define AERO_CAL_READY         3
#define AERO_CAL_FAILED        4

/* Error codes (INFO byte 23) */
#define AERO_ERR_NONE                0
#define AERO_ERR_MPU_NOT_FOUND       1
#define AERO_ERR_MPU_WHOAMI_MISMATCH 2
#define AERO_ERR_MPU_READ_FAILED     3
#define AERO_ERR_CALIBRATION_TIMEOUT 4
#define AERO_ERR_CALIBRATION_UNSTABLE 5
#define AERO_ERR_NVS_FAILED          6
#define AERO_ERR_BLE_INIT_FAILED     7
#define AERO_ERR_BATTERY_READ_FAILED 8
#define AERO_ERR_WATCHDOG_RESET      9
#define AERO_ERR_BROWNOUT_RESET      10

/* Factory test indices (FACTORY_RESULT bytes 9..18) and results */
enum {
    AERO_FT_BOOT = 0,
    AERO_FT_MPU_DETECTED,
    AERO_FT_ACCELEROMETER,
    AERO_FT_GYROSCOPE,
    AERO_FT_CALIBRATION,
    AERO_FT_WIRELESS,
    AERO_FT_BATTERY,
    AERO_FT_BUTTON,
    AERO_FT_LED,
    AERO_FT_NVS,
    AERO_FT_COUNT
};
#define AERO_FT_PENDING 0
#define AERO_FT_PASS    1
#define AERO_FT_FAIL    2
#define AERO_FT_SKIPPED 3

/* Log levels */
#define AERO_LOG_INFO  0
#define AERO_LOG_WARN  1
#define AERO_LOG_ERROR 2

typedef struct {
    uint8_t device_id;
    uint8_t status;
    uint8_t calibration_state;
    uint16_t sequence;
} aero_header_t;

typedef struct {
    uint32_t timestamp_ms;
    int16_t accel_mg[3];   /* body frame, milli-g */
    int16_t gyro_ddps[3];  /* body frame, 0.1 deg/s */
    int16_t pitch_cdeg;    /* 0.01 deg, + nose up */
    int16_t roll_cdeg;     /* 0.01 deg, + right side down */
    uint8_t battery_pct;   /* 0..100 or AERO_BATTERY_UNKNOWN */
} aero_motion_payload_t;

typedef struct {
    uint32_t uptime_ms;
    uint8_t fw_major, fw_minor, fw_patch;
    uint8_t hw_rev;
    uint16_t fw_build;
    uint8_t battery_pct;
    uint16_t battery_mv;   /* 0 = unknown */
    uint8_t mpu_addr;
    uint8_t sensor_flags;
    uint8_t error_code;
    uint8_t unique_id[6];
} aero_info_payload_t;

typedef struct {
    uint32_t timestamp_ms;
    int16_t gyro_offset_ddps[3];
    int16_t accel_baseline_mg[3];
    uint8_t quality;       /* 0..100 */
    uint16_t sample_count;
} aero_calibration_payload_t;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), no reflection, no xor-out. */
uint16_t aero_crc16(const uint8_t *data, size_t len);

/* Encoders: write exactly AERO_PACKET_SIZE bytes into out. */
void aero_encode_motion(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const aero_motion_payload_t *p);
void aero_encode_info(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const aero_info_payload_t *p);
void aero_encode_calibration(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const aero_calibration_payload_t *p);
void aero_encode_factory_result(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const uint8_t results[AERO_FT_COUNT]);
void aero_encode_log(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, uint8_t level, const char *msg);

/**
 * Validate a host command packet. Returns true and fills cmd/args (21 bytes) when
 * magic, type, and CRC are correct.
 */
bool aero_decode_command(const uint8_t in[AERO_PACKET_SIZE], uint8_t *cmd, uint8_t args[21]);

static inline int16_t aero_clamp_i16(int32_t v)
{
    return (int16_t)(v > 32767 ? 32767 : (v < -32768 ? -32768 : v));
}
