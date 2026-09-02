/**
 * @file command_handler.c
 */
#include "communication/command_handler.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app_state.h"
#include "calibration/calibration.h"
#include "communication/ble_transport.h"
#include "communication/protocol.h"
#include "communication/serial_transport.h"
#include "communication/transport.h"
#include "config/config_store.h"
#include "diagnostics/diagnostics.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "cmd";

static void set_device_id(uint8_t id)
{
    if (id != 1 && id != 2) {
        ESP_LOGW(TAG, "invalid device id %u", id);
        return;
    }
    g_app.device_id = id;
    g_config.device_id = id;
    config_store_save(&g_config);
    aero_ble_refresh_name();
    ESP_LOGI(TAG, "device id -> %u", id);
    transport_send_info();
}

static void set_rate(uint8_t hz)
{
    if (hz < 25) hz = 25;
    if (hz > 200) hz = 200;
    g_app.packet_rate_hz = hz;
    g_config.packet_rate_hz = hz;
    config_store_save(&g_config);
    ESP_LOGI(TAG, "packet rate -> %u Hz", hz);
}

static void reboot_later(void)
{
    ESP_LOGW(TAG, "rebooting");
    vTaskDelay(pdMS_TO_TICKS(150));
    esp_restart();
}

void command_execute(uint8_t cmd, const uint8_t args[21])
{
    switch (cmd) {
    case AERO_CMD_RECALIBRATE:
        calibration_begin();
        break;
    case AERO_CMD_SET_DEVICE_ID:
        set_device_id(args[0]);
        break;
    case AERO_CMD_SET_RATE_HZ:
        set_rate(args[0]);
        break;
    case AERO_CMD_FACTORY_TEST:
        diagnostics_factory_test_start();
        break;
    case AERO_CMD_RESET_FACTORY:
        config_store_erase();
        transport_send_log(AERO_LOG_WARN, "factory reset");
        reboot_later();
        break;
    case AERO_CMD_REBOOT:
        reboot_later();
        break;
    case AERO_CMD_IDENTIFY:
        diagnostics_identify();
        break;
    case AERO_CMD_GET_INFO:
        transport_send_info();
        break;
    case AERO_CMD_SET_NAME: {
        char name[AERO_NAME_MAX + 1] = {0};
        size_t n = 0;
        while (n < AERO_NAME_MAX && n < 21 && args[n] != 0) {
            name[n] = (char)args[n];
            n++;
        }
        if (n > 0) {
            memset(g_config.name, 0, sizeof(g_config.name));
            memcpy(g_config.name, name, n < sizeof(g_config.name) - 1 ? n : sizeof(g_config.name) - 1);
            config_store_save(&g_config);
            ESP_LOGI(TAG, "name -> '%s'", g_config.name);
        }
        break;
    }
    case AERO_CMD_ENTER_DIAGNOSTICS:
        g_app.diagnostics_mode = true;
        app_set_status(AERO_STATUS_DIAGNOSTICS_MODE, true);
        break;
    case AERO_CMD_EXIT_DIAGNOSTICS:
        g_app.diagnostics_mode = false;
        app_set_status(AERO_STATUS_DIAGNOSTICS_MODE, false);
        break;
    default:
        ESP_LOGW(TAG, "unknown command %u", cmd);
        break;
    }
}

void command_handle_bytes(const uint8_t *data, size_t len)
{
    for (size_t off = 0; off + AERO_PACKET_SIZE <= len; off += AERO_PACKET_SIZE) {
        uint8_t cmd, args[21];
        if (aero_decode_command(data + off, &cmd, args)) command_execute(cmd, args);
        else ESP_LOGW(TAG, "bad command packet");
    }
}

static void print_help(void)
{
    printf("AiroMote controller console\n"
           "  help            this list\n"
           "  info            identity, status, calibration, battery\n"
           "  cal             start calibration (hold still)\n"
           "  id 1|2          set controller slot\n"
           "  name <text>     set user name (<=20 chars)\n"
           "  rate <hz>       motion packet rate 25..200\n"
           "  stream on|off   binary packet stream on this port\n"
           "  factory         run factory self-test\n"
           "  identify        blink LED\n"
           "  reset           factory reset (erase config) and reboot\n"
           "  reboot          restart\n");
}

void command_handle_line(const char *line)
{
    uint8_t args[21] = {0};
    if (!strcmp(line, "help") || !strcmp(line, "?")) {
        print_help();
    } else if (!strcmp(line, "info")) {
        const calibration_t *c = calibration_get();
        uint32_t sent, dropped;
        uint16_t mtu;
        aero_ble_stats(&sent, &dropped, &mtu);
        printf("id=%u name='%s' fw=%d.%d.%d build %d hw=%d\n", g_app.device_id, g_config.name, AERO_FW_MAJOR,
               AERO_FW_MINOR, AERO_FW_PATCH, AERO_FW_BUILD, AERO_HW_REV);
        printf("mac=%02X:%02X:%02X:%02X:%02X:%02X status=0x%02X err=%u mpu=0x%02X sensor=0x%02X\n", g_app.mac[0],
               g_app.mac[1], g_app.mac[2], g_app.mac[3], g_app.mac[4], g_app.mac[5], g_app.status, g_app.error_code,
               g_app.mpu_addr, g_app.sensor_flags);
        printf("cal state=%u q=%u gyro_off=(%.2f %.2f %.2f) n=%u\n", c->state, c->quality, c->gyro_offset_dps[0],
               c->gyro_offset_dps[1], c->gyro_offset_dps[2], c->sample_count);
        printf("battery=%u%% %umV  rate=%uHz  ble: conn=%d sub=%d mtu=%u sent=%lu dropped=%lu\n", g_app.battery_pct,
               g_app.battery_mv, g_app.packet_rate_hz, aero_ble_connected(), aero_ble_subscribed(), mtu,
               (unsigned long)sent, (unsigned long)dropped);
    } else if (!strcmp(line, "cal")) {
        command_execute(AERO_CMD_RECALIBRATE, args);
    } else if (!strncmp(line, "id ", 3)) {
        args[0] = (uint8_t)atoi(line + 3);
        command_execute(AERO_CMD_SET_DEVICE_ID, args);
    } else if (!strncmp(line, "name ", 5)) {
        strncpy((char *)args, line + 5, 20);
        command_execute(AERO_CMD_SET_NAME, args);
    } else if (!strncmp(line, "rate ", 5)) {
        int v = atoi(line + 5);
        args[0] = (uint8_t)(v > 255 ? 255 : (v < 0 ? 0 : v));
        command_execute(AERO_CMD_SET_RATE_HZ, args);
    } else if (!strcmp(line, "stream on")) {
        serial_transport_set_stream(true);
        g_config.serial_stream = true;
        config_store_save(&g_config);
    } else if (!strcmp(line, "stream off")) {
        serial_transport_set_stream(false);
        g_config.serial_stream = false;
        config_store_save(&g_config);
    } else if (!strcmp(line, "factory")) {
        command_execute(AERO_CMD_FACTORY_TEST, args);
    } else if (!strcmp(line, "identify")) {
        command_execute(AERO_CMD_IDENTIFY, args);
    } else if (!strcmp(line, "reset")) {
        command_execute(AERO_CMD_RESET_FACTORY, args);
    } else if (!strcmp(line, "reboot")) {
        command_execute(AERO_CMD_REBOOT, args);
    } else {
        printf("unknown: '%s' (type help)\n", line);
    }
}
