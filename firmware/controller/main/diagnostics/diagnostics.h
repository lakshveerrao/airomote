/**
 * @file diagnostics.h
 * @brief Boot-reason mapping, status LED patterns, button handling and the factory self-test.
 *
 * LED patterns (BOARD_STATUS_LED_GPIO):
 *   booting      fast blink (10 Hz)
 *   calibrating  slow blink (1 Hz)
 *   ready        heartbeat (short pulse every 2 s); solid while a host is connected
 *   error        double blink every 1.5 s
 *   identify     rapid blink for 1.5 s (overrides everything)
 * Button: short press is reported in the status flags; holding 5 s performs a factory reset.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    LED_BOOTING,
    LED_CALIBRATING,
    LED_READY,
    LED_ERROR,
} led_mode_t;

/** Configure LED/button GPIOs and translate the reset reason into an error code. */
void diagnostics_init(void);

void diagnostics_set_led_mode(led_mode_t mode);

/** Drive LED pattern + button state machine. Call every ~10 ms with the current uptime. */
void diagnostics_tick(uint32_t now_ms, bool host_connected);

/** Rapid blink for 1.5 s so a user can tell which physical controller this is. */
void diagnostics_identify(void);

bool diagnostics_button_pressed(void);

/** Start the factory self-test; results stream out as FACTORY_RESULT packets while it runs. */
void diagnostics_factory_test_start(void);

/** Advance the factory test (non-blocking). Call from the housekeeping loop. */
void diagnostics_factory_test_tick(uint32_t now_ms);

bool diagnostics_factory_test_running(void);
