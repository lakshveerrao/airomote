/**
 * @file battery.c
 */
#include "power/battery.h"

#include "config/board_config.h"
#include "esp_log.h"

#if BOARD_HAS_BATTERY_SENSE
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_oneshot.h"
#endif
#if BOARD_HAS_CHARGE_STATUS
#include "driver/gpio.h"
#endif

static const char *TAG = "battery";
static bool s_available;

#if BOARD_HAS_BATTERY_SENSE
static adc_oneshot_unit_handle_t s_adc;
static adc_cali_handle_t s_cali;
static bool s_cali_ok;
#endif

esp_err_t battery_init(void)
{
#if BOARD_HAS_CHARGE_STATUS
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << BOARD_CHARGE_STATUS_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&io);
#endif
#if BOARD_HAS_BATTERY_SENSE
    adc_oneshot_unit_init_cfg_t unit = {.unit_id = ADC_UNIT_1, .ulp_mode = ADC_ULP_MODE_DISABLE};
    ESP_RETURN_ON_ERROR(adc_oneshot_new_unit(&unit, &s_adc), TAG, "adc unit");
    adc_oneshot_chan_cfg_t ch = {.atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT};
    ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(s_adc, BOARD_BATTERY_ADC_CHANNEL, &ch), TAG, "adc chan");
    adc_cali_curve_fitting_config_t cal = {
        .unit_id = ADC_UNIT_1,
        .chan = BOARD_BATTERY_ADC_CHANNEL,
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    s_cali_ok = adc_cali_create_scheme_curve_fitting(&cal, &s_cali) == ESP_OK;
    if (!s_cali_ok) ESP_LOGW(TAG, "ADC calibration unavailable, using nominal scale");
    s_available = true;
    ESP_LOGI(TAG, "battery sense on GPIO%d, divider %.2f", BOARD_BATTERY_ADC_GPIO, (double)BOARD_BATTERY_DIVIDER);
#else
    s_available = false;
    ESP_LOGI(TAG, "no battery sense on this board (BOARD_HAS_BATTERY_SENSE=0)");
#endif
    return ESP_OK;
}

bool battery_available(void) { return s_available; }

static uint8_t mv_to_percent(uint16_t mv)
{
    /* Piecewise LiPo discharge curve (open-circuit approximation). */
    static const uint16_t v[] = {3300, 3500, 3600, 3700, 3750, 3800, 3900, 4000, 4100, 4200};
    static const uint8_t p[] = {0, 5, 12, 25, 40, 55, 70, 82, 93, 100};
    if (mv <= v[0]) return 0;
    if (mv >= v[9]) return 100;
    for (int i = 1; i < 10; i++) {
        if (mv <= v[i]) {
            float f = (float)(mv - v[i - 1]) / (float)(v[i] - v[i - 1]);
            return (uint8_t)(p[i - 1] + f * (p[i] - p[i - 1]) + 0.5f);
        }
    }
    return 100;
}

bool battery_read(uint16_t *millivolts, uint8_t *percent)
{
#if BOARD_HAS_BATTERY_SENSE
    int sum = 0, n = 0;
    for (int i = 0; i < 8; i++) {
        int raw;
        if (adc_oneshot_read(s_adc, BOARD_BATTERY_ADC_CHANNEL, &raw) != ESP_OK) continue;
        int mv;
        if (s_cali_ok && adc_cali_raw_to_voltage(s_cali, raw, &mv) == ESP_OK) sum += mv;
        else sum += raw * 3300 / 4095;
        n++;
    }
    if (n == 0) return false;
    float pin_mv = (float)sum / n;
    uint16_t bat = (uint16_t)(pin_mv * BOARD_BATTERY_DIVIDER);
    *millivolts = bat;
    *percent = mv_to_percent(bat);
    return true;
#else
    (void)millivolts;
    (void)percent;
    return false;
#endif
}

bool battery_charging(void)
{
#if BOARD_HAS_CHARGE_STATUS
    return gpio_get_level(BOARD_CHARGE_STATUS_GPIO) == 0;
#else
    return false;
#endif
}
