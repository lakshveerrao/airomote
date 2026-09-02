/**
 * @file config_store.c
 */
#include "config/config_store.h"

#ifndef AERO_DEFAULT_SERIAL_STREAM
#define AERO_DEFAULT_SERIAL_STREAM 0
#endif
#ifndef AERO_DEFAULT_DEVICE_ID
#define AERO_DEFAULT_DEVICE_ID 1
#endif

#include <string.h>

#include "config/board_config.h"
#include "esp_check.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "config";
static const char *NS = "aero";

aero_config_t g_config;

static void set_defaults(aero_config_t *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    cfg->device_id = AERO_DEFAULT_DEVICE_ID; /* build flag; SET_DEVICE_ID / console `id` override and persist */
    strncpy(cfg->name, "AiroMote", AERO_NAME_MAX);
    cfg->packet_rate_hz = AERO_DEFAULT_PACKET_RATE_HZ;
    cfg->serial_stream = AERO_DEFAULT_SERIAL_STREAM != 0; /* build flag; console `stream on|off` overrides and persists */
    cfg->has_calibration = false;
    cfg->accel_baseline_g[2] = 1.0f;
}

esp_err_t config_store_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS partition needs erase (%s)", esp_err_to_name(err));
        ESP_RETURN_ON_ERROR(nvs_flash_erase(), TAG, "nvs erase");
        err = nvs_flash_init();
    }
    return err;
}

esp_err_t config_store_load(aero_config_t *cfg)
{
    set_defaults(cfg);
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READONLY, &h);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGI(TAG, "no stored config, using defaults");
        return ESP_OK;
    }
    if (err != ESP_OK) return err;

    uint8_t u8;
    if (nvs_get_u8(h, "dev_id", &u8) == ESP_OK && (u8 == 1 || u8 == 2)) cfg->device_id = u8;
    if (nvs_get_u8(h, "rate", &u8) == ESP_OK && u8 >= 25 && u8 <= 200) cfg->packet_rate_hz = u8;
    if (nvs_get_u8(h, "stream", &u8) == ESP_OK) cfg->serial_stream = u8 != 0;
    if (nvs_get_u8(h, "cal_q", &u8) == ESP_OK) cfg->calibration_quality = u8;
    size_t len = sizeof(cfg->name);
    if (nvs_get_str(h, "name", cfg->name, &len) != ESP_OK) strncpy(cfg->name, "AiroMote", AERO_NAME_MAX);
    len = sizeof(cfg->gyro_offset_dps);
    size_t len2 = sizeof(cfg->accel_baseline_g);
    if (nvs_get_blob(h, "gyro_off", cfg->gyro_offset_dps, &len) == ESP_OK &&
        nvs_get_blob(h, "acc_base", cfg->accel_baseline_g, &len2) == ESP_OK) {
        cfg->has_calibration = true;
    }
    uint32_t u32;
    if (nvs_get_u32(h, "boots", &u32) == ESP_OK) cfg->boot_count = u32;
    nvs_close(h);
    ESP_LOGI(TAG, "loaded: id=%u name='%s' rate=%u stream=%d cal=%d", cfg->device_id, cfg->name,
             cfg->packet_rate_hz, cfg->serial_stream, cfg->has_calibration);
    return ESP_OK;
}

esp_err_t config_store_save(const aero_config_t *cfg)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    nvs_set_u8(h, "dev_id", cfg->device_id);
    nvs_set_u8(h, "rate", cfg->packet_rate_hz);
    nvs_set_u8(h, "stream", cfg->serial_stream ? 1 : 0);
    nvs_set_u8(h, "cal_q", cfg->calibration_quality);
    nvs_set_str(h, "name", cfg->name);
    nvs_set_u32(h, "boots", cfg->boot_count);
    if (cfg->has_calibration) {
        nvs_set_blob(h, "gyro_off", cfg->gyro_offset_dps, sizeof(cfg->gyro_offset_dps));
        nvs_set_blob(h, "acc_base", cfg->accel_baseline_g, sizeof(cfg->accel_baseline_g));
    }
    err = nvs_commit(h);
    nvs_close(h);
    if (err != ESP_OK) ESP_LOGE(TAG, "save failed: %s", esp_err_to_name(err));
    return err;
}

esp_err_t config_store_erase(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_erase_all(h);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    ESP_LOGW(TAG, "config erased (%s)", esp_err_to_name(err));
    return err;
}

bool config_store_selftest(void)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    uint32_t magic = 0xA5A5C6C6u, back = 0;
    bool ok = nvs_set_u32(h, "selftest", magic) == ESP_OK && nvs_commit(h) == ESP_OK &&
              nvs_get_u32(h, "selftest", &back) == ESP_OK && back == magic;
    nvs_erase_key(h, "selftest");
    nvs_commit(h);
    nvs_close(h);
    return ok;
}
