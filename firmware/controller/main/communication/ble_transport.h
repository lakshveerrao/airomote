/**
 * @file ble_transport.h
 * @brief NimBLE peripheral: one service, TX (notify) + RX (write) characteristics.
 *
 * Device name: "Aero-<id>-<last 4 hex of MAC>". Service/characteristic UUIDs match
 * packages/protocol/src/constants.ts. Outgoing packets go through a queue drained by a
 * dedicated task so the sensor path never blocks on the radio. Up to two motion packets are
 * coalesced into one notification when the negotiated MTU allows (≥ 64 + 3).
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef void (*ble_rx_handler_t)(const uint8_t *data, size_t len);

/** Start the host stack, register GATT, begin advertising. Fills g_app.mac. */
esp_err_t ble_transport_init(ble_rx_handler_t rx_handler);

/** Non-blocking enqueue of one 32-byte packet. Returns false if the queue is full / no subscriber. */
bool ble_transport_send(const uint8_t *pkt32);

bool ble_transport_connected(void);
bool ble_transport_subscribed(void);
bool ble_transport_ready(void);

/** Re-apply the device name after the device id changed (takes effect on next advertising start). */
void ble_transport_refresh_name(void);

/** Statistics for diagnostics. */
void ble_transport_stats(uint32_t *sent, uint32_t *dropped, uint16_t *mtu);
