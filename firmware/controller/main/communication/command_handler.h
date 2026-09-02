/**
 * @file command_handler.h
 * @brief Executes host commands (from BLE RX, USB packets, or the text console).
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

/** Handle a validated command id with its 21 argument bytes. */
void command_execute(uint8_t cmd, const uint8_t args[21]);

/** Parse raw bytes that may contain 1..N 32-byte COMMAND packets (BLE write / serial). */
void command_handle_bytes(const uint8_t *data, size_t len);

/** Text console line ("help", "info", "cal", "id 2", "name X", "rate 100", "factory", "reset", "reboot", "stream on"). */
void command_handle_line(const char *line);
