/**
 * @file board_config.h
 * @brief ALL board-specific values for the AiroMote controller live here.
 *
 * The defaults below target a generic "ESP32-C6 Mini" module and are UNVERIFIED.
 * Before the first flash, open the schematic of your exact board and confirm every
 * value marked TODO. Nothing else in the firmware hard-codes a GPIO.
 */
#pragma once

#include "driver/gpio.h"

/* ---------------------------------------------------------------------------
 * Identity
 * ------------------------------------------------------------------------- */
#ifndef AERO_FW_MAJOR
#define AERO_FW_MAJOR 1
#endif
#ifndef AERO_FW_MINOR
#define AERO_FW_MINOR 0
#endif
#ifndef AERO_FW_PATCH
#define AERO_FW_PATCH 0
#endif
#ifndef AERO_FW_BUILD
#define AERO_FW_BUILD 1
#endif
#ifndef AERO_HW_REV
#define AERO_HW_REV 1
#endif

/* ---------------------------------------------------------------------------
 * I2C bus to the MPU6050
 * TODO(board): confirm SDA/SCL GPIOs and that 4.7k pull-ups exist on the board.
 * ------------------------------------------------------------------------- */
#define BOARD_I2C_PORT        (-1)          /* -1 = auto-select an I2C controller */
#define BOARD_I2C_SDA_GPIO       GPIO_NUM_4   /* verified: user wiring */
#define BOARD_I2C_SCL_GPIO       GPIO_NUM_5   /* verified: user wiring */
#define BOARD_I2C_FREQ_HZ     400000
#define BOARD_I2C_INTERNAL_PULLUPS 1        /* set 0 when the board has external pull-ups */

/* MPU6050 addresses: AD0 low -> 0x68 (primary), AD0 high -> 0x69 (fallback). */
#define BOARD_MPU_ADDR_PRIMARY   0x68
#define BOARD_MPU_ADDR_FALLBACK  0x69

/* ---------------------------------------------------------------------------
 * Axis remap: chip axes -> body frame (+X forward, +Y left, +Z up).
 * Each body axis is one chip axis with a sign. With the chip mounted flat, "X arrow"
 * pointing to the front of the controller and the chip face up, the identity mapping
 * below is correct. TODO(board): adjust after checking the sensor orientation on the PCB.
 * Usage: BODY_X(ax, ay, az) returns the body-frame X component from chip readings.
 * ------------------------------------------------------------------------- */
#define BODY_X(x, y, z) ( (x))
#define BODY_Y(x, y, z) ( (y))
#define BODY_Z(x, y, z) ( (z))

/* ---------------------------------------------------------------------------
 * Status LED (plain GPIO, active high). Many C6 dev boards route GPIO8 to a WS2812
 * RGB LED instead — with those you will only see the LED flicker. TODO(board).
 * ------------------------------------------------------------------------- */
#define BOARD_HAS_STATUS_LED     1
#define BOARD_STATUS_LED_GPIO    GPIO_NUM_8   /* UNVERIFIED */
#define BOARD_STATUS_LED_ACTIVE_HIGH 1

/* ---------------------------------------------------------------------------
 * User button (active low with internal pull-up). Long press 5 s = factory reset.
 * GPIO9 is the BOOT button on most C6 modules. TODO(board).
 * ------------------------------------------------------------------------- */
#define BOARD_HAS_BUTTON         1
#define BOARD_BUTTON_GPIO        GPIO_NUM_9   /* UNVERIFIED */
#define BOARD_BUTTON_ACTIVE_LOW  1

/* ---------------------------------------------------------------------------
 * Battery sense. Set BOARD_HAS_BATTERY_SENSE to 1 only if the board exposes the
 * battery through a resistor divider on an ADC pin. When 0 the firmware reports
 * battery = unknown (255) and the app hides the battery indicator.
 * Divider ratio = (R_top + R_bottom) / R_bottom, e.g. 2.0 for two equal resistors.
 * TODO(board): confirm pin, divider, and that the pin is on ADC1 (ADC2 is unusable with BLE).
 * ------------------------------------------------------------------------- */
#define BOARD_HAS_BATTERY_SENSE  0
#define BOARD_BATTERY_ADC_GPIO   GPIO_NUM_0   /* UNVERIFIED — ADC1_CH0 on ESP32-C6 */
#define BOARD_BATTERY_ADC_CHANNEL ADC_CHANNEL_0
#define BOARD_BATTERY_DIVIDER    2.0f
#define BOARD_BATTERY_FULL_MV    4200
#define BOARD_BATTERY_EMPTY_MV   3300
#define BOARD_BATTERY_LOW_PERCENT 15
/* Optional charger status input (active low "CHRG" pin of a TP4056 etc.). */
#define BOARD_HAS_CHARGE_STATUS  0
#define BOARD_CHARGE_STATUS_GPIO GPIO_NUM_1   /* UNVERIFIED */

/* ---------------------------------------------------------------------------
 * Timing (see README "Rates")
 * ------------------------------------------------------------------------- */
#define AERO_SENSOR_RATE_HZ        200   /* MPU6050 sample rate */
#define AERO_DEFAULT_PACKET_RATE_HZ 100  /* motion packets per second (configurable 25..200) */
#define AERO_INFO_INTERVAL_MS      1000
#define AERO_WATCHDOG_TIMEOUT_MS   3000
