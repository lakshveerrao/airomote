/**
 * @file mpu6050.c
 */
#include "sensor/mpu6050.h"

#include <math.h>
#include <string.h>

#include "config/board_config.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "mpu6050";

/* Registers */
#define REG_SMPLRT_DIV   0x19
#define REG_CONFIG       0x1A
#define REG_GYRO_CONFIG  0x1B
#define REG_ACCEL_CONFIG 0x1C
#define REG_INT_PIN_CFG  0x37
#define REG_ACCEL_XOUT_H 0x3B
#define REG_PWR_MGMT_1   0x6B
#define REG_PWR_MGMT_2   0x6C
#define REG_WHO_AM_I     0x75

#define ACCEL_LSB_PER_G   4096.0f  /* ±8 g */
#define GYRO_LSB_PER_DPS  16.4f    /* ±2000 dps */

static i2c_master_bus_handle_t s_bus;
static i2c_master_dev_handle_t s_dev;
static mpu6050_status_t s_status;

static esp_err_t write_reg(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(s_dev, buf, sizeof(buf), 50);
}

static esp_err_t read_regs(uint8_t reg, uint8_t *out, size_t len)
{
    return i2c_master_transmit_receive(s_dev, &reg, 1, out, len, 50);
}

static esp_err_t attach(uint8_t addr)
{
    i2c_device_config_t dev = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = addr,
        .scl_speed_hz = BOARD_I2C_FREQ_HZ,
    };
    return i2c_master_bus_add_device(s_bus, &dev, &s_dev);
}

esp_err_t mpu6050_init(void)
{
    memset(&s_status, 0, sizeof(s_status));
    i2c_master_bus_config_t bus = {
        .i2c_port = BOARD_I2C_PORT,
        .sda_io_num = BOARD_I2C_SDA_GPIO,
        .scl_io_num = BOARD_I2C_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = BOARD_I2C_INTERNAL_PULLUPS,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus, &s_bus), TAG, "i2c bus");

    const uint8_t candidates[2] = {BOARD_MPU_ADDR_PRIMARY, BOARD_MPU_ADDR_FALLBACK};
    for (int i = 0; i < 2; i++) {
        if (i2c_master_probe(s_bus, candidates[i], 20) == ESP_OK) {
            s_status.address = candidates[i];
            s_status.found = true;
            break;
        }
    }
    if (!s_status.found) {
        ESP_LOGE(TAG, "no MPU6050 at 0x%02X or 0x%02X (check SDA/SCL in board_config.h)",
                 BOARD_MPU_ADDR_PRIMARY, BOARD_MPU_ADDR_FALLBACK);
        return ESP_ERR_NOT_FOUND;
    }
    ESP_RETURN_ON_ERROR(attach(s_status.address), TAG, "add device");

    uint8_t who = 0;
    ESP_RETURN_ON_ERROR(read_regs(REG_WHO_AM_I, &who, 1), TAG, "who_am_i");
    s_status.who_am_i = who;
    if (who == 0x68) {
        s_status.whoami_ok = true;
    } else if (who == 0x70 || who == 0x72 || who == 0x69) {
        s_status.whoami_ok = true;
        s_status.clone_warning = true;
        ESP_LOGW(TAG, "WHO_AM_I=0x%02X: MPU6500/clone detected, continuing", who);
    } else {
        ESP_LOGE(TAG, "WHO_AM_I=0x%02X unexpected", who);
        return ESP_ERR_INVALID_RESPONSE;
    }

    /* Reset, wake with gyro X as clock source, configure ranges and rate. */
    ESP_RETURN_ON_ERROR(write_reg(REG_PWR_MGMT_1, 0x80), TAG, "reset");
    vTaskDelay(pdMS_TO_TICKS(100));
    ESP_RETURN_ON_ERROR(write_reg(REG_PWR_MGMT_1, 0x01), TAG, "wake");
    vTaskDelay(pdMS_TO_TICKS(10));
    ESP_RETURN_ON_ERROR(write_reg(REG_PWR_MGMT_2, 0x00), TAG, "pwr2");
    ESP_RETURN_ON_ERROR(write_reg(REG_CONFIG, 0x02), TAG, "dlpf");          /* DLPF_CFG=2 → 98 Hz, 1 kHz base */
    ESP_RETURN_ON_ERROR(write_reg(REG_SMPLRT_DIV, (1000 / AERO_SENSOR_RATE_HZ) - 1), TAG, "smplrt");
    ESP_RETURN_ON_ERROR(write_reg(REG_GYRO_CONFIG, 0x18), TAG, "gyro fs");  /* ±2000 dps */
    ESP_RETURN_ON_ERROR(write_reg(REG_ACCEL_CONFIG, 0x10), TAG, "accel fs"); /* ±8 g */
    ESP_RETURN_ON_ERROR(write_reg(REG_INT_PIN_CFG, 0x00), TAG, "int cfg");
    vTaskDelay(pdMS_TO_TICKS(30));
    ESP_LOGI(TAG, "ready at 0x%02X (WHO_AM_I 0x%02X), %d Hz", s_status.address, who, AERO_SENSOR_RATE_HZ);
    return ESP_OK;
}

esp_err_t mpu6050_read(mpu6050_sample_t *out)
{
    uint8_t raw[14];
    esp_err_t err = read_regs(REG_ACCEL_XOUT_H, raw, sizeof(raw));
    if (err != ESP_OK) {
        s_status.read_errors++;
        return err;
    }
    int16_t ax = (int16_t)((raw[0] << 8) | raw[1]);
    int16_t ay = (int16_t)((raw[2] << 8) | raw[3]);
    int16_t az = (int16_t)((raw[4] << 8) | raw[5]);
    int16_t t = (int16_t)((raw[6] << 8) | raw[7]);
    int16_t gx = (int16_t)((raw[8] << 8) | raw[9]);
    int16_t gy = (int16_t)((raw[10] << 8) | raw[11]);
    int16_t gz = (int16_t)((raw[12] << 8) | raw[13]);
    out->accel_g[0] = ax / ACCEL_LSB_PER_G;
    out->accel_g[1] = ay / ACCEL_LSB_PER_G;
    out->accel_g[2] = az / ACCEL_LSB_PER_G;
    out->gyro_dps[0] = gx / GYRO_LSB_PER_DPS;
    out->gyro_dps[1] = gy / GYRO_LSB_PER_DPS;
    out->gyro_dps[2] = gz / GYRO_LSB_PER_DPS;
    out->temp_c = t / 340.0f + 36.53f;
    return ESP_OK;
}

esp_err_t mpu6050_health_check(uint8_t *sensor_flags)
{
    uint8_t flags = 0;
    uint8_t who = 0;
    if (read_regs(REG_WHO_AM_I, &who, 1) == ESP_OK && who == s_status.who_am_i) flags |= 1u << 0;

    float acc_mag = 0, gyro_max = 0;
    int ok = 0;
    for (int i = 0; i < 10; i++) {
        mpu6050_sample_t s;
        if (mpu6050_read(&s) != ESP_OK) continue;
        ok++;
        acc_mag += sqrtf(s.accel_g[0] * s.accel_g[0] + s.accel_g[1] * s.accel_g[1] + s.accel_g[2] * s.accel_g[2]);
        for (int a = 0; a < 3; a++) {
            float g = fabsf(s.gyro_dps[a]);
            if (g > gyro_max) gyro_max = g;
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
    if (ok > 0) {
        acc_mag /= ok;
        if (acc_mag > 0.5f && acc_mag < 1.5f) flags |= 1u << 1;
        if (gyro_max < 1900.0f) flags |= 1u << 2;
    }
    *sensor_flags = flags;
    return (flags == 0x07) ? ESP_OK : ESP_FAIL;
}

const mpu6050_status_t *mpu6050_status(void)
{
    return &s_status;
}
