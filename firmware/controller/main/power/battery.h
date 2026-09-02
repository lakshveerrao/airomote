/**
 * @file battery.h
 * @brief Battery voltage via ADC (when BOARD_HAS_BATTERY_SENSE) → percent + low flag.
 * When the board has no sense line the module reports "unknown" (255 / 0 mV).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

esp_err_t battery_init(void);

/** Sample the battery (averaged). Returns false when unavailable. */
bool battery_read(uint16_t *millivolts, uint8_t *percent);

bool battery_available(void);

/** True when a charger-status input reports charging (always false if not wired). */
bool battery_charging(void);
