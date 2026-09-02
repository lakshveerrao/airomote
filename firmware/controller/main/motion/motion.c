/**
 * @file motion.c
 */
#include "motion/motion.h"

#include <math.h>
#include <string.h>

#include "calibration/calibration.h"
#include "config/board_config.h"
#include "communication/protocol.h"

#define RAD2DEG 57.29577951f
#define GYRO_LP_HZ 60.0f      /* light: keeps strikes crisp, kills quantisation noise */
#define ACCEL_LP_HZ 40.0f
#define COMP_ALPHA 0.98f

static float s_pitch, s_roll;
static float s_gyro_f[3], s_acc_f[3];
static bool s_init;

void motion_init(void)
{
    s_init = false;
    s_pitch = s_roll = 0;
}

void motion_remap(const mpu6050_sample_t *in, float a[3], float g[3])
{
    const float *ca = in->accel_g, *cg = in->gyro_dps;
    a[0] = BODY_X(ca[0], ca[1], ca[2]);
    a[1] = BODY_Y(ca[0], ca[1], ca[2]);
    a[2] = BODY_Z(ca[0], ca[1], ca[2]);
    g[0] = BODY_X(cg[0], cg[1], cg[2]);
    g[1] = BODY_Y(cg[0], cg[1], cg[2]);
    g[2] = BODY_Z(cg[0], cg[1], cg[2]);
}

static float lp(float prev, float x, float dt, float fc)
{
    float rc = 1.0f / (6.2831853f * fc);
    float a = dt / (rc + dt);
    return prev + a * (x - prev);
}

void motion_update(const mpu6050_sample_t *in, float dt, motion_sample_t *out)
{
    float a[3], g[3], off[3];
    motion_remap(in, a, g);
    memcpy(out->gyro_raw_dps, g, sizeof(g));
    calibration_active_offsets(off);
    for (int i = 0; i < 3; i++) g[i] -= off[i];

    if (!s_init) {
        memcpy(s_gyro_f, g, sizeof(g));
        memcpy(s_acc_f, a, sizeof(a));
        s_pitch = atan2f(a[0], sqrtf(a[1] * a[1] + a[2] * a[2])) * RAD2DEG;
        s_roll = atan2f(a[1], a[2]) * RAD2DEG;
        s_init = true;
    }
    for (int i = 0; i < 3; i++) {
        s_gyro_f[i] = lp(s_gyro_f[i], g[i], dt, GYRO_LP_HZ);
        s_acc_f[i] = lp(s_acc_f[i], a[i], dt, ACCEL_LP_HZ);
    }

    /* Complementary filter. pitchRate = -gyro.y, rollRate = gyro.x (body convention). */
    float acc_pitch = atan2f(s_acc_f[0], sqrtf(s_acc_f[1] * s_acc_f[1] + s_acc_f[2] * s_acc_f[2])) * RAD2DEG;
    float acc_roll = atan2f(s_acc_f[1], s_acc_f[2]) * RAD2DEG;
    float mag = sqrtf(s_acc_f[0] * s_acc_f[0] + s_acc_f[1] * s_acc_f[1] + s_acc_f[2] * s_acc_f[2]);
    float trust = 1.0f - fabsf(mag - 1.0f) * 2.0f;
    if (trust < 0) trust = 0;
    if (trust > 1) trust = 1;
    float w = 1.0f - (1.0f - COMP_ALPHA) * trust;
    s_pitch = w * (s_pitch + (-s_gyro_f[1]) * dt) + (1.0f - w) * acc_pitch;
    float gr = s_roll + s_gyro_f[0] * dt;
    float d = acc_roll - gr;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    s_roll = gr + (1.0f - w) * d;
    while (s_roll > 180) s_roll -= 360;
    while (s_roll < -180) s_roll += 360;

    memcpy(out->accel_g, a, sizeof(a));
    memcpy(out->gyro_dps, s_gyro_f, sizeof(s_gyro_f));
    for (int i = 0; i < 3; i++) {
        out->accel_mg[i] = aero_clamp_i16((int32_t)lroundf(a[i] * 1000.0f));
        out->gyro_ddps[i] = aero_clamp_i16((int32_t)lroundf(s_gyro_f[i] * 10.0f));
    }
    out->pitch_cdeg = aero_clamp_i16((int32_t)lroundf(s_pitch * 100.0f));
    out->roll_cdeg = aero_clamp_i16((int32_t)lroundf(s_roll * 100.0f));
    out->stationary = calibration_get()->stationary;
}
