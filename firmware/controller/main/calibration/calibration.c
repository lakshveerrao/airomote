/**
 * @file calibration.c
 */
#include "calibration/calibration.h"

#include <math.h>
#include <string.h>

#include "app_state.h"
#include "config/board_config.h"
#include "config/config_store.h"
#include "esp_log.h"

static const char *TAG = "calib";

#define STILL_WINDOW      (AERO_SENSOR_RATE_HZ / 2)   /* 0.5 s */
#define MIN_SAMPLES       400
#define TIMEOUT_MS        20000
#define REBIAS_STILL_MS   10000
#define STILL_GYRO_STD    2.5f    /* deg/s */
#define STILL_ACC_STD     0.03f   /* g */
#define STILL_GYRO_MEAN   15.0f   /* deg/s: offsets of an uncalibrated MPU rarely exceed this */

typedef struct {
    float buf[STILL_WINDOW];
    int idx, n;
    float sum, sumsq;
} window_t;

static void win_push(window_t *w, float x)
{
    if (w->n == STILL_WINDOW) {
        float old = w->buf[w->idx];
        w->sum -= old;
        w->sumsq -= old * old;
    } else {
        w->n++;
    }
    w->buf[w->idx] = x;
    w->sum += x;
    w->sumsq += x * x;
    w->idx = (w->idx + 1) % STILL_WINDOW;
}
static float win_mean(const window_t *w) { return w->n ? w->sum / w->n : 0; }
static float win_std(const window_t *w)
{
    if (!w->n) return 0;
    float m = win_mean(w);
    float v = w->sumsq / w->n - m * m;
    return v > 0 ? sqrtf(v) : 0;
}

static calibration_t s_cal;
static window_t s_gyro_win, s_acc_win;
static double s_acc_g[3], s_acc_a[3];  /* accumulators */
static double s_acc_g2[3];
static uint32_t s_n;
static uint32_t s_started_ms, s_still_since_ms;
static bool s_still_valid;

void calibration_load_stored(const float gyro_offset_dps[3], const float accel_baseline_g[3], uint8_t quality)
{
    memcpy(s_cal.gyro_offset_dps, gyro_offset_dps, sizeof(s_cal.gyro_offset_dps));
    memcpy(s_cal.accel_baseline_g, accel_baseline_g, sizeof(s_cal.accel_baseline_g));
    s_cal.quality = quality;
    ESP_LOGI(TAG, "using stored offsets (%.2f, %.2f, %.2f) q=%u", gyro_offset_dps[0], gyro_offset_dps[1],
             gyro_offset_dps[2], quality);
}

static void reset_accumulators(void)
{
    memset(s_acc_g, 0, sizeof(s_acc_g));
    memset(s_acc_a, 0, sizeof(s_acc_a));
    memset(s_acc_g2, 0, sizeof(s_acc_g2));
    s_n = 0;
}

void calibration_begin(void)
{
    s_cal.state = AERO_CAL_WAITING_STILL;
    s_cal.sample_count = 0;
    s_cal.just_completed = false;
    reset_accumulators();
    s_started_ms = 0;
    s_still_valid = false;
    g_app.calibration_state = s_cal.state;
    app_set_status(AERO_STATUS_CALIBRATED, false);
    ESP_LOGI(TAG, "calibration started: hold still");
}

static void finish(bool ok, uint32_t now_ms)
{
    if (ok) {
        float g[3], a[3], var = 0;
        for (int i = 0; i < 3; i++) {
            g[i] = (float)(s_acc_g[i] / s_n);
            a[i] = (float)(s_acc_a[i] / s_n);
            float v = (float)(s_acc_g2[i] / s_n) - g[i] * g[i];
            if (v > var) var = v;
        }
        float mag = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        if (mag < 0.85f || mag > 1.15f) {
            ESP_LOGE(TAG, "gravity magnitude %.3f g out of range", mag);
            app_set_error(AERO_ERR_CALIBRATION_UNSTABLE);
            s_cal.state = AERO_CAL_FAILED;
        } else {
            memcpy(s_cal.gyro_offset_dps, g, sizeof(g));
            memcpy(s_cal.accel_baseline_g, a, sizeof(a));
            /* quality: std 0 → 100, std 2.5 dps → 0 */
            float std = sqrtf(var > 0 ? var : 0);
            float q = 100.0f * (1.0f - std / STILL_GYRO_STD);
            s_cal.quality = (uint8_t)(q < 0 ? 0 : (q > 100 ? 100 : q));
            s_cal.sample_count = (uint16_t)(s_n > 65535 ? 65535 : s_n);
            s_cal.state = AERO_CAL_READY;
            app_set_status(AERO_STATUS_CALIBRATED, true);
            /* persist */
            memcpy(g_config.gyro_offset_dps, g, sizeof(g));
            memcpy(g_config.accel_baseline_g, a, sizeof(a));
            g_config.calibration_quality = s_cal.quality;
            g_config.has_calibration = true;
            config_store_save(&g_config);
            ESP_LOGI(TAG, "READY: gyro off (%.2f, %.2f, %.2f) dps, |g|=%.3f, q=%u, n=%lu", g[0], g[1], g[2], mag,
                     s_cal.quality, (unsigned long)s_n);
        }
    } else {
        s_cal.state = AERO_CAL_FAILED;
        app_set_error(AERO_ERR_CALIBRATION_TIMEOUT);
        ESP_LOGW(TAG, "FAILED: not still within %d s; keeping stored offsets", TIMEOUT_MS / 1000);
        if (g_config.has_calibration) app_set_status(AERO_STATUS_CALIBRATED, true);
    }
    s_cal.just_completed = true;
    s_still_since_ms = now_ms;
    g_app.calibration_state = s_cal.state;
}

void calibration_feed(const float accel_g[3], const float gyro_dps[3], uint32_t now_ms)
{
    float gmag = sqrtf(gyro_dps[0] * gyro_dps[0] + gyro_dps[1] * gyro_dps[1] + gyro_dps[2] * gyro_dps[2]);
    float amag = sqrtf(accel_g[0] * accel_g[0] + accel_g[1] * accel_g[1] + accel_g[2] * accel_g[2]);
    win_push(&s_gyro_win, gmag);
    win_push(&s_acc_win, amag);
    bool full = s_gyro_win.n == STILL_WINDOW;
    bool still = full && win_std(&s_gyro_win) < STILL_GYRO_STD && win_std(&s_acc_win) < STILL_ACC_STD &&
                 win_mean(&s_gyro_win) < STILL_GYRO_MEAN;
    s_cal.stationary = still;
    app_set_status(AERO_STATUS_STATIONARY, still);
    if (!still) s_still_valid = false;

    switch (s_cal.state) {
    case AERO_CAL_WAITING_STILL:
        if (s_started_ms == 0) s_started_ms = now_ms;
        if (still) {
            s_cal.state = AERO_CAL_SAMPLING;
            reset_accumulators();
            ESP_LOGI(TAG, "still detected, sampling");
        } else if (now_ms - s_started_ms > TIMEOUT_MS) {
            finish(false, now_ms);
        }
        break;
    case AERO_CAL_SAMPLING:
        if (!still) {
            ESP_LOGD(TAG, "movement during sampling, restarting");
            s_cal.state = AERO_CAL_WAITING_STILL;
            reset_accumulators();
            break;
        }
        for (int i = 0; i < 3; i++) {
            s_acc_g[i] += gyro_dps[i];
            s_acc_g2[i] += (double)gyro_dps[i] * gyro_dps[i];
            s_acc_a[i] += accel_g[i];
        }
        s_n++;
        s_cal.sample_count = (uint16_t)(s_n > 65535 ? 65535 : s_n);
        if (s_n >= MIN_SAMPLES) finish(true, now_ms);
        else if (now_ms - s_started_ms > TIMEOUT_MS) finish(false, now_ms);
        break;
    case AERO_CAL_READY:
    case AERO_CAL_FAILED:
        /* Auto re-bias: after ≥ 10 s of stillness, blend offsets toward the running mean. */
        if (still) {
            if (!s_still_valid) {
                s_still_valid = true;
                s_still_since_ms = now_ms;
                reset_accumulators();
            }
            for (int i = 0; i < 3; i++) s_acc_g[i] += gyro_dps[i];
            s_n++;
            if (now_ms - s_still_since_ms >= REBIAS_STILL_MS && s_n >= MIN_SAMPLES) {
                bool sane = true;
                float est[3];
                for (int i = 0; i < 3; i++) {
                    est[i] = (float)(s_acc_g[i] / s_n);
                    if (fabsf(est[i] - s_cal.gyro_offset_dps[i]) > 8.0f) sane = false;
                }
                if (sane) {
                    for (int i = 0; i < 3; i++) s_cal.gyro_offset_dps[i] += 0.2f * (est[i] - s_cal.gyro_offset_dps[i]);
                    ESP_LOGD(TAG, "re-bias → (%.2f, %.2f, %.2f)", s_cal.gyro_offset_dps[0], s_cal.gyro_offset_dps[1],
                             s_cal.gyro_offset_dps[2]);
                }
                s_still_since_ms = now_ms;
                reset_accumulators();
            }
        }
        break;
    default:
        break;
    }
    g_app.calibration_state = s_cal.state;
}

const calibration_t *calibration_get(void) { return &s_cal; }

bool calibration_take_event(void)
{
    bool e = s_cal.just_completed;
    s_cal.just_completed = false;
    return e;
}

void calibration_active_offsets(float gyro_offset_dps[3])
{
    memcpy(gyro_offset_dps, s_cal.gyro_offset_dps, sizeof(float) * 3);
}
