/**
 * @file serial_transport.c
 */
#include "communication/serial_transport.h"

#include <ctype.h>
#include <string.h>

#include "app_state.h"
#include "communication/protocol.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_log.h"

static const char *TAG = "serial";

static serial_packet_cb_t s_on_packet;
static serial_line_cb_t s_on_line;
static uint8_t s_buf[AERO_PACKET_SIZE * 2];
static size_t s_len;
static char s_line[96];
static size_t s_line_len;
static bool s_installed;

esp_err_t serial_transport_init(serial_packet_cb_t on_packet, serial_line_cb_t on_line)
{
    s_on_packet = on_packet;
    s_on_line = on_line;
    usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    cfg.rx_buffer_size = 1024;
    cfg.tx_buffer_size = 4096;
    esp_err_t err = usb_serial_jtag_driver_install(&cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "usb_serial_jtag driver: %s (console still works via ROM path)", esp_err_to_name(err));
        return err;
    }
    usb_serial_jtag_vfs_use_driver();
    s_installed = true;
    serial_transport_set_stream(g_app.serial_stream);
    return ESP_OK;
}

void serial_transport_set_stream(bool on)
{
    g_app.serial_stream = on;
    esp_log_level_set("*", on ? ESP_LOG_ERROR : ESP_LOG_INFO);
    if (!on) ESP_LOGI(TAG, "binary stream off");
}

bool serial_transport_streaming(void) { return g_app.serial_stream; }

void serial_transport_send(const uint8_t *pkt32)
{
    if (!s_installed || !g_app.serial_stream) return;
    usb_serial_jtag_write_bytes(pkt32, AERO_PACKET_SIZE, 0);
}

static void handle_byte(uint8_t b)
{
    /* Binary packet path: once a magic byte is seen, collect 32 bytes and validate. */
    if (s_len > 0 || b == AERO_PROTOCOL_MAGIC) {
        s_buf[s_len++] = b;
        if (s_len == AERO_PACKET_SIZE) {
            uint8_t cmd, args[21];
            if (aero_decode_command(s_buf, &cmd, args)) {
                if (s_on_packet) s_on_packet(s_buf);
                s_len = 0;
                return;
            }
            /* Not a valid packet: drop the first byte and re-scan the rest as text/bytes. */
            uint8_t rest[AERO_PACKET_SIZE - 1];
            memcpy(rest, s_buf + 1, sizeof(rest));
            s_len = 0;
            for (size_t i = 0; i < sizeof(rest); i++) handle_byte(rest[i]);
        }
        return;
    }
    /* Text console path */
    if (b == '\r' || b == '\n') {
        if (s_line_len > 0) {
            s_line[s_line_len] = 0;
            if (s_on_line) s_on_line(s_line);
            s_line_len = 0;
        }
        return;
    }
    if (isprint(b) && s_line_len < sizeof(s_line) - 1) s_line[s_line_len++] = (char)b;
}

void serial_transport_poll(void)
{
    if (!s_installed) return;
    uint8_t chunk[64];
    int n;
    while ((n = usb_serial_jtag_read_bytes(chunk, sizeof(chunk), 0)) > 0) {
        for (int i = 0; i < n; i++) handle_byte(chunk[i]);
    }
}
