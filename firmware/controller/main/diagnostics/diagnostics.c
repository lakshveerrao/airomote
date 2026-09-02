/**
 * @file diagnostics.c
 */
#include "diagnostics/diagnostics.h"

#include <string.h>

#include "app_state.h"
#include "calibration/calibration.h"
#include "communication/ble_transport.h"
#include "communication/protocol.h"
#include "communication/transport.h"
#include "config/board_config.h"
#include "config/config_store.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_system.h"
#include "power/battery.h"
#include "sensor/mpu6050.h"

static const char *TAG = "diag";

static led_mode_t s_mode = LED_BOOTING;
static uint32_t s_identify_until;
static bool s_button_pressed;
static uint32_t s_button_down_since;
static bool s_button_handled;

/* factory test */
static bool s_ft_running;
static int s_ft_step;
static uint32_t s_ft_step_started;
static uint8_t s_ft_results[AERO_FT_COUNT];
static bool s_ft_button_seen;
static uint32_t s_ft_led_flip;
static bool s_ft_led_state;

static void led_write(bool on)
{
#if BOARD_HAS_STATUS_LED
    gpio_set_level(BOARD_STATUS_LED_GPIO, BOARD_STATUS_LED_ACTIVE_HIGH ? on : !on);
#else
    (void)on;
#endif
}

void diagnostics_init(void)
{
#if BOARD_HAS_STATUS_LED
    gpio_config_t led = {
        .pin_bit_mask = 1ULL << BOARD_STATUS_LED_GPIO,
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&led);
    led_write(true);
#endif
#if BOARD_HAS_BUTTON
    gpio_config_t btn = {
        .pin_bit_mask = 1ULL << BOARD_BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = BOARD_BUTTON_ACTIVE_LOW ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = BOARD_BUTTON_ACTIVE_LOW ? GPIO_PULLDOWN_DISABLE : GPIO_PULLDOWN_ENABLE,
    };
    gpio_config(&btn);
#endif
    esp_reset_reason_t r = esp_reset_reason();
    const char *why = "power-on";
    switch (r) {
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:
        app_set_error(AERO_ERR_WATCHDOG_RESET);
        why = "watchdog";
        break;
    case ESP_RST_BROWNOUT:
        app_set_error(AERO_ERR_BROWNOUT_RESET);
        why = "brownout";
        break;
    case ESP_RST_PANIC:
        why = "panic";
        break;
    case ESP_RST_SW:
        why = "software";
        break;
    default:
        break;
    }
    ESP_LOGI(TAG, "reset reason: %s (%d)", why, r);
}

void diagnostics_set_led_mode(led_mode_t mode) { s_mode = mode; }

void diagnostics_identify(void)
{
    s_identify_until = 0xFFFFFFFFu; /* armed; real deadline set on next tick */
}

bool diagnostics_button_pressed(void) { return s_button_pressed; }

static void tick_led(uint32_t now, bool connected)
{
    if (s_identify_until == 0xFFFFFFFFu) s_identify_until = now + 1500;
    if (now < s_identify_until) {
        led_write((now / 60) % 2 == 0);
        return;
    }
    if (s_ft_running) {
        led_write(s_ft_led_state);
        return;
    }
    uint32_t t;
    switch (s_mode) {
    case LED_BOOTING:
        led_write((now / 50) % 2 == 0);
        break;
    case LED_CALIBRATING:
        led_write((now / 500) % 2 == 0);
        break;
    case LED_READY:
        if (connected) led_write(true);
        else {
            t = now % 2000;
            led_write(t < 80);
        }
        break;
    case LED_ERROR:
        t = now % 1500;
        led_write(t < 100 || (t > 250 && t < 350));
        break;
    }
}

static void tick_button(uint32_t now)
{
#if BOARD_HAS_BUTTON
    int lvl = gpio_get_level(BOARD_BUTTON_GPIO);
    bool pressed = BOARD_BUTTON_ACTIVE_LOW ? (lvl == 0) : (lvl != 0);
    if (pressed && !s_button_pressed) {
        s_button_down_since = now;
        s_button_handled = false;
        if (s_ft_running) s_ft_button_seen = true;
    }
    s_button_pressed = pressed;
    app_set_status(AERO_STATUS_BUTTON_PRESSED, pressed);
    if (pressed && !s_button_handled && now - s_button_down_since >= 5000) {
        s_button_handled = true;
        ESP_LOGW(TAG, "button held 5 s: factory reset");
        transport_send_log(AERO_LOG_WARN, "factory reset");
        config_store_erase();
        esp_restart();
    }
#else
    (void)now;
#endif
}

void diagnostics_tick(uint32_t now_ms, bool host_connected)
{
    tick_button(now_ms);
    tick_led(now_ms, host_connected);
}

/* ------------------------------------------------------------------------- factory test */

static void ft_publish(void)
{
    aero_header_t h;
    transport_fill_header(&h);
    uint8_t pkt[AERO_PACKET_SIZE];
    aero_encode_factory_result(pkt, &h, s_ft_results);
    transport_send_packet(pkt);
}

void diagnostics_factory_test_start(void)
{
    memset(s_ft_results, AERO_FT_PENDING, sizeof(s_ft_results));
    s_ft_running = true;
    s_ft_step = 0;
    s_ft_step_started = 0;
    s_ft_button_seen = false;
    g_app.diagnostics_mode = true;
    app_set_status(AERO_STATUS_DIAGNOSTICS_MODE, true);
    ESP_LOGI(TAG, "factory test started");
    ft_publish();
}

bool diagnostics_factory_test_running(void) { return s_ft_running; }

static void ft_set(int idx, uint8_t result)
{
    s_ft_results[idx] = result;
    ESP_LOGI(TAG, "factory test %d -> %s", idx,
             result == AERO_FT_PASS ? "PASS" : result == AERO_FT_FAIL ? "FAIL" : "SKIPPED");
    ft_publish();
    s_ft_step++;
    s_ft_step_started = 0;
}

void diagnostics_factory_test_tick(uint32_t now)
{
    if (!s_ft_running) return;
    if (s_ft_step_started == 0) s_ft_step_started = now;
    uint32_t elapsed = now - s_ft_step_started;
    /* Pace the visible progress so a technician can follow it. */
    if (elapsed < 200) return;

    switch (s_ft_step) {
    case AERO_FT_BOOT:
        ft_set(AERO_FT_BOOT, AERO_FT_PASS);
        break;
    case AERO_FT_MPU_DETECTED: {
        const mpu6050_status_t *st = mpu6050_status();
        ft_set(AERO_FT_MPU_DETECTED, (st->found && st->whoami_ok) ? AERO_FT_PASS : AERO_FT_FAIL);
        break;
    }
    case AERO_FT_ACCELEROMETER:
    case AERO_FT_GYROSCOPE: {
        uint8_t flags = 0;
        if (mpu6050_status()->found) mpu6050_health_check(&flags);
        g_app.sensor_flags = flags;
        if (s_ft_step == AERO_FT_ACCELEROMETER) ft_set(AERO_FT_ACCELEROMETER, (flags & 0x02) ? AERO_FT_PASS : AERO_FT_FAIL);
        else ft_set(AERO_FT_GYROSCOPE, (flags & 0x04) ? AERO_FT_PASS : AERO_FT_FAIL);
        break;
    }
    case AERO_FT_CALIBRATION: {
        const calibration_t *c = calibration_get();
        if (c->state == AERO_CAL_READY) ft_set(AERO_FT_CALIBRATION, c->quality >= 30 ? AERO_FT_PASS : AERO_FT_FAIL);
        else if (c->state == AERO_CAL_FAILED || elapsed > 12000) ft_set(AERO_FT_CALIBRATION, AERO_FT_FAIL);
        else if (c->state == AERO_CAL_NONE) calibration_begin();
        break;
    }
    case AERO_FT_WIRELESS:
        ft_set(AERO_FT_WIRELESS, aero_ble_ready() ? AERO_FT_PASS : AERO_FT_FAIL);
        break;
    case AERO_FT_BATTERY: {
        if (!battery_available()) {
            ft_set(AERO_FT_BATTERY, AERO_FT_SKIPPED);
        } else {
            uint16_t mv = 0;
            uint8_t pct = 0;
            bool ok = battery_read(&mv, &pct) && mv > 2900 && mv < 4500;
            ft_set(AERO_FT_BATTERY, ok ? AERO_FT_PASS : AERO_FT_FAIL);
        }
        break;
    }
    case AERO_FT_BUTTON:
#if BOARD_HAS_BUTTON
        if (s_ft_button_seen) ft_set(AERO_FT_BUTTON, AERO_FT_PASS);
        else if (elapsed > 6000) ft_set(AERO_FT_BUTTON, AERO_FT_SKIPPED); /* nobody pressed it */
#else
        ft_set(AERO_FT_BUTTON, AERO_FT_SKIPPED);
#endif
        break;
    case AERO_FT_LED:
#if BOARD_HAS_STATUS_LED
        if (now - s_ft_led_flip > 150) {
            s_ft_led_state = !s_ft_led_state;
            s_ft_led_flip = now;
        }
        if (elapsed > 1500) ft_set(AERO_FT_LED, AERO_FT_PASS); /* pattern executed; technician confirms visually */
#else
        ft_set(AERO_FT_LED, AERO_FT_SKIPPED);
#endif
        break;
    case AERO_FT_NVS:
        ft_set(AERO_FT_NVS, config_store_selftest() ? AERO_FT_PASS : AERO_FT_FAIL);
        break;
    default:
        s_ft_running = false;
        ESP_LOGI(TAG, "factory test complete");
        ft_publish();
        break;
    }
}
