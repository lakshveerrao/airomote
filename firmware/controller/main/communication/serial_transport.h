/**
 * @file serial_transport.h
 * @brief USB Serial/JTAG port: text console + optional binary packet stream.
 *
 * Normal mode: ESP_LOG output plus a tiny line console (`help` lists commands).
 * Stream mode (`stream on` or CMD_SET/serial flag): the same 32-byte packets that go out
 * over BLE are also written to the port; logs are reduced to errors. Incoming 32-byte
 * COMMAND packets (magic 0xA5) are accepted in both modes, as are text commands.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef void (*serial_packet_cb_t)(const uint8_t *pkt32);
typedef void (*serial_line_cb_t)(const char *line);

esp_err_t serial_transport_init(serial_packet_cb_t on_packet, serial_line_cb_t on_line);

/** Write a packet when streaming is enabled (non-blocking, drops on a full buffer). */
void serial_transport_send(const uint8_t *pkt32);

/** Read pending bytes and dispatch packets / lines. Call every few ms. */
void serial_transport_poll(void);

void serial_transport_set_stream(bool on);
bool serial_transport_streaming(void);
