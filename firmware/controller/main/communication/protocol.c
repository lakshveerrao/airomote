/**
 * @file protocol.c
 * @brief Packet encoders/decoder. Reference: packages/protocol/src/codec.ts.
 */
#include "communication/protocol.h"

#include <string.h>

uint16_t aero_crc16(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

static inline void put_u16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static inline void put_i16(uint8_t *p, int16_t v) { put_u16(p, (uint16_t)v); }
static inline void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
static inline uint16_t get_u16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

static void write_header(uint8_t out[AERO_PACKET_SIZE], uint8_t type, const aero_header_t *h)
{
    memset(out, 0, AERO_PACKET_SIZE);
    out[0] = AERO_PROTOCOL_MAGIC;
    out[1] = AERO_PROTOCOL_VERSION;
    out[2] = type;
    out[3] = h->device_id;
    out[4] = h->status;
    out[5] = h->calibration_state;
    put_u16(&out[6], h->sequence);
}

static void finalize(uint8_t out[AERO_PACKET_SIZE])
{
    put_u16(&out[AERO_PACKET_SIZE - 2], aero_crc16(out, AERO_PACKET_SIZE - 2));
}

void aero_encode_motion(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const aero_motion_payload_t *p)
{
    write_header(out, AERO_PKT_MOTION, h);
    put_u32(&out[8], p->timestamp_ms);
    for (int i = 0; i < 3; i++) put_i16(&out[12 + 2 * i], p->accel_mg[i]);
    for (int i = 0; i < 3; i++) put_i16(&out[18 + 2 * i], p->gyro_ddps[i]);
    put_i16(&out[24], p->pitch_cdeg);
    put_i16(&out[26], p->roll_cdeg);
    out[28] = p->battery_pct;
    out[29] = 0;
    finalize(out);
}

void aero_encode_info(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const aero_info_payload_t *p)
{
    write_header(out, AERO_PKT_INFO, h);
    put_u32(&out[8], p->uptime_ms);
    out[12] = p->fw_major;
    out[13] = p->fw_minor;
    out[14] = p->fw_patch;
    out[15] = p->hw_rev;
    put_u16(&out[16], p->fw_build);
    out[18] = p->battery_pct;
    put_u16(&out[19], p->battery_mv);
    out[21] = p->mpu_addr;
    out[22] = p->sensor_flags;
    out[23] = p->error_code;
    memcpy(&out[24], p->unique_id, 6);
    finalize(out);
}

void aero_encode_calibration(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const aero_calibration_payload_t *p)
{
    write_header(out, AERO_PKT_CALIBRATION, h);
    put_u32(&out[8], p->timestamp_ms);
    for (int i = 0; i < 3; i++) put_i16(&out[12 + 2 * i], p->gyro_offset_ddps[i]);
    for (int i = 0; i < 3; i++) put_i16(&out[18 + 2 * i], p->accel_baseline_mg[i]);
    out[24] = p->quality > 100 ? 100 : p->quality;
    uint32_t sc = (p->sample_count + 5) / 10;
    out[25] = (uint8_t)(sc > 255 ? 255 : sc);
    finalize(out);
}

void aero_encode_factory_result(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, const uint8_t results[AERO_FT_COUNT])
{
    write_header(out, AERO_PKT_FACTORY_RESULT, h);
    out[8] = AERO_FT_COUNT;
    for (int i = 0; i < AERO_FT_COUNT && 9 + i < 30; i++) out[9 + i] = results[i];
    finalize(out);
}

void aero_encode_log(uint8_t out[AERO_PACKET_SIZE], const aero_header_t *h, uint8_t level, const char *msg)
{
    write_header(out, AERO_PKT_LOG, h);
    size_t len = strlen(msg);
    if (len > 20) len = 20;
    out[8] = level;
    out[9] = (uint8_t)len;
    memcpy(&out[10], msg, len);
    finalize(out);
}

bool aero_decode_command(const uint8_t in[AERO_PACKET_SIZE], uint8_t *cmd, uint8_t args[21])
{
    if (in[0] != AERO_PROTOCOL_MAGIC || in[2] != AERO_PKT_COMMAND) return false;
    if (get_u16(&in[AERO_PACKET_SIZE - 2]) != aero_crc16(in, AERO_PACKET_SIZE - 2)) return false;
    *cmd = in[8];
    memcpy(args, &in[9], 21);
    return true;
}
