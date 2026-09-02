/**
 * @file main.c
 * @brief Aero controller entry point: init order, tasks, watchdog, packet fan-out.
 *
 * Tasks
 *   sensor_task   200 Hz  read MPU6050 → calibration → motion → queue every Nth sample
 *   tx_task       drains the sample queue, encodes MOTION packets, sends (100 Hz default)
 *   house_task    100 Hz  LED/button, serial console, INFO every 1 s, battery every 5 s,
 *                         calibration events, factory test, watchdog
 *   ble host / ble_tx     inside ble_transport.c
 */
#include <stdio.h>
#include <string.h>

#include "app_state.h"
#include "calibration/calibration.h"
#include "communication/ble_transport.h"
#include "communication/command_handler.h"
#include "communication/protocol.h"
#include "communication/serial_transport.h"
#include "communication/transport.h"
#include "config/board_config.h"
#include "config/config_store.h"
#include "diagnostics/diagnostics.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "motion/motion.h"
#include "power/battery.h"
#include "sensor/mpu6050.h"

static const char *TAG = "aero";

app_state_t g_app;

static QueueHandle_t s_sample_queue;
static volatile uint16_t s_sequence;
static bool s_sensor_ok;

static inline uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

/* ------------------------------------------------------------------ transport fan-out */

uint16_t transport_next_sequence(void)
{
    return __atomic_fetch_add(&s_sequence, 1, __ATOMIC_RELAXED);
}

void transport_fill_header(aero_header_t *h)
{
    h->device_id = g_app.device_id;
    h->status = g_app.status;
    h->calibration_state = g_app.calibration_state;
    h->sequence = transport_next_sequence();
}

void transport_send_packet(const uint8_t pkt[AERO_PACKET_SIZE])
{
    aero_ble_send(pkt);
    serial_transport_send(pkt);
}

void transport_send_info(void)
{
    aero_header_t h;
    transport_fill_header(&h);
    aero_info_payload_t p = {
        .uptime_ms = now_ms(),
        .fw_major = AERO_FW_MAJOR,
        .fw_minor = AERO_FW_MINOR,
        .fw_patch = AERO_FW_PATCH,
        .hw_rev = AERO_HW_REV,
        .fw_build = AERO_FW_BUILD,
        .battery_pct = g_app.battery_pct,
        .battery_mv = g_app.battery_mv,
        .mpu_addr = g_app.mpu_addr,
        .sensor_flags = g_app.sensor_flags,
        .error_code = g_app.error_code,
    };
    memcpy(p.unique_id, g_app.mac, 6);
    uint8_t pkt[AERO_PACKET_SIZE];
    aero_encode_info(pkt, &h, &p);
    transport_send_packet(pkt);
}

void transport_send_log(uint8_t level, const char *msg)
{
    aero_header_t h;
    transport_fill_header(&h);
    uint8_t pkt[AERO_PACKET_SIZE];
    aero_encode_log(pkt, &h, level, msg);
    transport_send_packet(pkt);
}

static void send_calibration_packet(void)
{
    const calibration_t *c = calibration_get();
    aero_header_t h;
    transport_fill_header(&h);
    aero_calibration_payload_t p = {.timestamp_ms = now_ms(), .quality = c->quality, .sample_count = c->sample_count};
    for (int i = 0; i < 3; i++) {
        p.gyro_offset_ddps[i] = aero_clamp_i16((int32_t)(c->gyro_offset_dps[i] * 10.0f));
        p.accel_baseline_mg[i] = aero_clamp_i16((int32_t)(c->accel_baseline_g[i] * 1000.0f));
    }
    uint8_t pkt[AERO_PACKET_SIZE];
    aero_encode_calibration(pkt, &h, &p);
    transport_send_packet(pkt);
}

/* ------------------------------------------------------------------ RX from links */

static void on_ble_rx(const uint8_t *data, size_t len) { command_handle_bytes(data, len); }
static void on_serial_packet(const uint8_t *pkt32) { command_handle_bytes(pkt32, AERO_PACKET_SIZE); }
static void on_serial_line(const char *line) { command_handle_line(line); }

/* ------------------------------------------------------------------ tasks */

typedef struct {
    motion_sample_t m;
    uint32_t t_ms;
} queued_sample_t;

static void sensor_task(void *arg)
{
    (void)arg;
    esp_task_wdt_add(NULL);
    const TickType_t period = pdMS_TO_TICKS(1000 / AERO_SENSOR_RATE_HZ);
    TickType_t last_wake = xTaskGetTickCount();
    uint32_t last_t = now_ms();
    uint32_t decim = 0;
    uint32_t consecutive_errors = 0;
    for (;;) {
        vTaskDelayUntil(&last_wake, period);
        esp_task_wdt_reset();
        if (!s_sensor_ok) continue;

        mpu6050_sample_t raw;
        if (mpu6050_read(&raw) != ESP_OK) {
            if (++consecutive_errors == 50) {
                ESP_LOGE(TAG, "MPU6050 stopped responding");
                app_set_error(AERO_ERR_MPU_READ_FAILED);
                app_set_status(AERO_STATUS_SENSOR_OK, false);
                diagnostics_set_led_mode(LED_ERROR);
            }
            if (consecutive_errors > 2000) esp_restart(); /* ~10 s without a sensor: safe restart */
            continue;
        }
        if (consecutive_errors) {
            consecutive_errors = 0;
            app_set_status(AERO_STATUS_SENSOR_OK, true);
        }
        uint32_t t = now_ms();
        float dt = (t - last_t) / 1000.0f;
        if (dt <= 0 || dt > 0.05f) dt = 1.0f / AERO_SENSOR_RATE_HZ;
        last_t = t;

        float a[3], g[3];
        motion_remap(&raw, a, g);
        calibration_feed(a, g, t);

        queued_sample_t q;
        motion_update(&raw, dt, &q.m);
        q.t_ms = t;

        uint32_t every = AERO_SENSOR_RATE_HZ / (g_app.packet_rate_hz ? g_app.packet_rate_hz : 1);
        if (every == 0) every = 1;
        if (++decim >= every) {
            decim = 0;
            xQueueOverwrite(s_sample_queue, &q); /* depth-1 mailbox: newest sample wins */
        }
    }
}

static void tx_task(void *arg)
{
    (void)arg;
    queued_sample_t q;
    for (;;) {
        if (xQueueReceive(s_sample_queue, &q, pdMS_TO_TICKS(100)) != pdTRUE) continue;
        aero_header_t h;
        transport_fill_header(&h);
        aero_motion_payload_t p = {
            .timestamp_ms = q.t_ms,
            .pitch_cdeg = q.m.pitch_cdeg,
            .roll_cdeg = q.m.roll_cdeg,
            .battery_pct = g_app.battery_pct,
        };
        memcpy(p.accel_mg, q.m.accel_mg, sizeof(p.accel_mg));
        memcpy(p.gyro_ddps, q.m.gyro_ddps, sizeof(p.gyro_ddps));
        uint8_t pkt[AERO_PACKET_SIZE];
        aero_encode_motion(pkt, &h, &p);
        transport_send_packet(pkt);
    }
}

static void house_task(void *arg)
{
    (void)arg;
    esp_task_wdt_add(NULL);
    uint32_t last_info = 0, last_batt = 0;
    led_mode_t led = LED_BOOTING;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(10));
        esp_task_wdt_reset();
        uint32_t t = now_ms();

        serial_transport_poll();
        diagnostics_tick(t, aero_ble_connected());
        diagnostics_factory_test_tick(t);

        if (calibration_take_event()) {
            send_calibration_packet();
            transport_send_info();
        }

        /* LED mode from state */
        led_mode_t want;
        if (g_app.error_code == AERO_ERR_MPU_NOT_FOUND || g_app.error_code == AERO_ERR_MPU_READ_FAILED ||
            g_app.error_code == AERO_ERR_MPU_WHOAMI_MISMATCH || g_app.error_code == AERO_ERR_BLE_INIT_FAILED)
            want = LED_ERROR;
        else if (g_app.calibration_state == AERO_CAL_WAITING_STILL || g_app.calibration_state == AERO_CAL_SAMPLING)
            want = LED_CALIBRATING;
        else
            want = LED_READY;
        if (want != led) {
            led = want;
            diagnostics_set_led_mode(led);
        }

        if (t - last_batt >= 5000) {
            last_batt = t;
            uint16_t mv;
            uint8_t pct;
            if (battery_read(&mv, &pct)) {
                g_app.battery_mv = mv;
                g_app.battery_pct = pct;
                app_set_status(AERO_STATUS_LOW_BATTERY, pct < BOARD_BATTERY_LOW_PERCENT);
            } else {
                g_app.battery_pct = AERO_BATTERY_UNKNOWN;
                g_app.battery_mv = 0;
            }
            app_set_status(AERO_STATUS_CHARGING, battery_charging());
        }
        if (t - last_info >= AERO_INFO_INTERVAL_MS) {
            last_info = t;
            transport_send_info();
        }
    }
}

/* ------------------------------------------------------------------ boot */

void app_main(void)
{
    ESP_LOGI(TAG, "Aero controller fw %d.%d.%d build %d hw rev %d", AERO_FW_MAJOR, AERO_FW_MINOR, AERO_FW_PATCH,
             AERO_FW_BUILD, AERO_HW_REV);
    memset(&g_app, 0, sizeof(g_app));
    g_app.battery_pct = AERO_BATTERY_UNKNOWN;

    /* 1. NVS + config */
    if (config_store_init() != ESP_OK) app_set_error(AERO_ERR_NVS_FAILED);
    config_store_load(&g_config);
    g_config.boot_count++;
    config_store_save(&g_config);
    g_app.device_id = g_config.device_id;
    g_app.packet_rate_hz = g_config.packet_rate_hz;
    g_app.serial_stream = g_config.serial_stream;

    /* 2. Diagnostics (LED, button, reset reason) */
    diagnostics_init();
    diagnostics_set_led_mode(LED_BOOTING);

    /* 3. Watchdog */
    esp_task_wdt_config_t wdt = {.timeout_ms = AERO_WATCHDOG_TIMEOUT_MS, .idle_core_mask = 0, .trigger_panic = true};
    ESP_ERROR_CHECK(esp_task_wdt_init(&wdt));

    /* 4. Sensor */
    motion_init();
    esp_err_t err = mpu6050_init();
    if (err == ESP_OK) {
        s_sensor_ok = true;
        g_app.mpu_addr = mpu6050_status()->address;
        uint8_t flags = 0;
        mpu6050_health_check(&flags);
        g_app.sensor_flags = flags;
        app_set_status(AERO_STATUS_SENSOR_OK, (flags & 0x01) != 0);
        if (g_config.has_calibration)
            calibration_load_stored(g_config.gyro_offset_dps, g_config.accel_baseline_g, g_config.calibration_quality);
        calibration_begin();
    } else {
        app_set_error(err == ESP_ERR_INVALID_RESPONSE ? AERO_ERR_MPU_WHOAMI_MISMATCH : AERO_ERR_MPU_NOT_FOUND);
        diagnostics_set_led_mode(LED_ERROR);
        ESP_LOGE(TAG, "sensor init failed (%s); continuing so the app can read the error", esp_err_to_name(err));
    }

    /* 5. Battery */
    battery_init();

    /* 6. Links */
    serial_transport_init(on_serial_packet, on_serial_line);
    if (aero_ble_init(on_ble_rx) != ESP_OK) app_set_error(AERO_ERR_BLE_INIT_FAILED);

    /* 7. Tasks */
    s_sample_queue = xQueueCreate(1, sizeof(queued_sample_t));
    xTaskCreate(sensor_task, "sensor", 4096, NULL, 7, NULL);
    xTaskCreate(tx_task, "tx", 3072, NULL, 5, NULL);
    xTaskCreate(house_task, "house", 4096, NULL, 4, NULL);
    ESP_LOGI(TAG, "running: id=%u rate=%u Hz, type 'help' on this console", g_app.device_id, g_app.packet_rate_hz);
}
