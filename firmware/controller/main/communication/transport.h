/**
 * @file transport.h
 * @brief Fan-out of outgoing packets to every active transport (BLE notify + optional USB
 * serial stream). Implemented in main.c; used by diagnostics/commands so they never depend
 * on a specific link.
 */
#pragma once

#include <stdint.h>

#include "communication/protocol.h"

/** Next sequence number (shared by all packet types, wraps at 65535). */
uint16_t transport_next_sequence(void);

/** Fill a header with the live device id / status / calibration state and a fresh sequence. */
void transport_fill_header(aero_header_t *h);

/** Queue a 32-byte packet on all active links. Never blocks. */
void transport_send_packet(const uint8_t pkt[AERO_PACKET_SIZE]);

/** Convenience: send an INFO packet now. */
void transport_send_info(void);

/** Convenience: send a LOG packet (message truncated to 20 bytes). */
void transport_send_log(uint8_t level, const char *msg);
