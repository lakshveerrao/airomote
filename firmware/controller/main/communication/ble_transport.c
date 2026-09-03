/**
 * @file ble_transport.c
 */
#include "communication/ble_transport.h"

#include <stdio.h>
#include <string.h>

#include "app_state.h"
#include "communication/protocol.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "host/ble_hs.h"
void ble_store_config_init(void); /* nimble store/config (header not exported in this IDF) */
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/dis/ble_svc_dis.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "ble";

/* 7a3e0001-4d6f-7469-6f6e-416572304d43 etc. — NimBLE wants the 16 bytes little-endian. */
#define AERO_UUID128(short_id) \
    BLE_UUID128_INIT(0x43, 0x4d, 0x30, 0x72, 0x65, 0x41, 0x6e, 0x6f, 0x69, 0x74, 0x6f, 0x4d, (short_id), 0x00, 0x3e, 0x7a)

static const ble_uuid128_t s_svc_uuid = AERO_UUID128(0x01);
static const ble_uuid128_t s_tx_uuid = AERO_UUID128(0x02);
static const ble_uuid128_t s_rx_uuid = AERO_UUID128(0x03);

#define TX_QUEUE_DEPTH 48

static uint16_t s_tx_handle;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static bool s_subscribed;
static bool s_ready;
static uint8_t s_own_addr_type;
static uint16_t s_mtu = 23;
static QueueHandle_t s_tx_queue;
static ble_rx_handler_t s_rx_handler;
static uint32_t s_sent, s_dropped;
static char s_name[32];

static void start_advertising(void);

static int gatt_access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)attr_handle;
    (void)arg;
    switch (ctxt->op) {
    case BLE_GATT_ACCESS_OP_WRITE_CHR: {
        uint8_t buf[AERO_PACKET_SIZE * 4];
        uint16_t len = 0;
        int rc = ble_hs_mbuf_to_flat(ctxt->om, buf, sizeof(buf), &len);
        if (rc == 0 && s_rx_handler) s_rx_handler(buf, len);
        return 0;
    }
    case BLE_GATT_ACCESS_OP_READ_CHR:
        return 0; /* TX is notify-only; reads return empty */
    default:
        return BLE_ATT_ERR_UNLIKELY;
    }
}

static const struct ble_gatt_svc_def s_gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_svc_uuid.u,
        .characteristics =
            (struct ble_gatt_chr_def[]){
                {
                    .uuid = &s_tx_uuid.u,
                    .access_cb = gatt_access,
                    .flags = BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_READ,
                    .val_handle = &s_tx_handle,
                },
                {
                    .uuid = &s_rx_uuid.u,
                    .access_cb = gatt_access,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
                },
                {0},
            },
    },
    {0},
};

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_REPEAT_PAIRING: {
        /* Host forgot us (Windows "Remove device"): drop the stale bond and let it pair again. */
        struct ble_gap_conn_desc desc;
        if (ble_gap_conn_find(event->repeat_pairing.conn_handle, &desc) == 0)
            ble_store_util_delete_peer(&desc.peer_id_addr);
        return BLE_GAP_REPEAT_PAIRING_RETRY;
    }
    case BLE_GAP_EVENT_ENC_CHANGE:
        ESP_LOGI(TAG, "encryption %s", event->enc_change.status == 0 ? "on" : "failed");
        return 0;
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            s_mtu = 23;
            ESP_LOGI(TAG, "connected (handle %u)", s_conn_handle);
            struct ble_gap_upd_params params = {
                .itvl_min = 6,   /* 7.5 ms */
                .itvl_max = 12,  /* 15 ms */
                .latency = 0,
                .supervision_timeout = 400, /* 4 s */
                .min_ce_len = 0,
                .max_ce_len = 0,
            };
            ble_gap_update_params(s_conn_handle, &params);
        } else {
            start_advertising();
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnected (reason %d)", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        s_subscribed = false;
        xQueueReset(s_tx_queue);
        start_advertising();
        return 0;
    case BLE_GAP_EVENT_CONN_UPDATE:
        ESP_LOGI(TAG, "conn params updated (status %d)", event->conn_update.status);
        return 0;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        start_advertising();
        return 0;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_tx_handle) {
            s_subscribed = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "notifications %s", s_subscribed ? "enabled" : "disabled");
        }
        return 0;
    case BLE_GAP_EVENT_MTU:
        s_mtu = event->mtu.value;
        ESP_LOGI(TAG, "MTU %u", s_mtu);
        return 0;
    default:
        return 0;
    }
}

static void start_advertising(void)
{
    /* Name + appearance in the primary advertisement so passive scanners (Windows / Android
     * system Bluetooth lists) show the device; the 128-bit service UUID goes in the scan
     * response, which Chrome's active scan still sees for its service filter. */
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.name = (uint8_t *)s_name;
    fields.name_len = strlen(s_name);
    fields.name_is_complete = 1;
    fields.appearance = 0x03C4; /* HID: Gamepad — Windows/Android list it as a game controller */
    fields.appearance_is_present = 1;
    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) ESP_LOGE(TAG, "adv_set_fields rc=%d", rc);

    struct ble_hs_adv_fields rsp = {0};
    rsp.uuids128 = &s_svc_uuid;
    rsp.num_uuids128 = 1;
    rsp.uuids128_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&rsp);
    if (rc != 0) ESP_LOGE(TAG, "adv_rsp_set_fields rc=%d", rc);

    struct ble_gap_adv_params adv = {
        .conn_mode = BLE_GAP_CONN_MODE_UND,
        .disc_mode = BLE_GAP_DISC_MODE_GEN,
        .itvl_min = 0x20, /* 20 ms */
        .itvl_max = 0x40, /* 40 ms */
    };
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &adv, gap_event, NULL);
    if (rc != 0 && rc != BLE_HS_EALREADY) ESP_LOGE(TAG, "adv_start rc=%d", rc);
    else ESP_LOGI(TAG, "advertising as '%s'", s_name);
}

static void build_name(void)
{
    snprintf(s_name, sizeof(s_name), "AiroMote-%u-%02X%02X", g_app.device_id, g_app.mac[4], g_app.mac[5]);
    ble_svc_gap_device_name_set(s_name);
}

static void on_sync(void)
{
    int rc = ble_hs_util_ensure_addr(0);
    if (rc != 0) ESP_LOGE(TAG, "ensure_addr rc=%d", rc);
    rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) ESP_LOGE(TAG, "infer_auto rc=%d", rc);
    uint8_t addr[6] = {0};
    ble_hs_id_copy_addr(s_own_addr_type, addr, NULL);
    for (int i = 0; i < 6; i++) g_app.mac[i] = addr[5 - i]; /* big-endian for the unique id */
    build_name();
    s_ready = true;
    start_advertising();
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "host reset, reason %d", reason);
    s_subscribed = false;
    s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
}

static void host_task(void *param)
{
    (void)param;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static void tx_task(void *param)
{
    (void)param;
    uint8_t buf[AERO_PACKET_SIZE * 2];
    for (;;) {
        if (xQueueReceive(s_tx_queue, buf, pdMS_TO_TICKS(50)) != pdTRUE) continue;
        if (!s_subscribed || s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
            s_dropped++;
            continue;
        }
        size_t len = AERO_PACKET_SIZE;
        /* Coalesce a second motion packet when the MTU allows (ATT payload = MTU - 3). */
        if (buf[2] == AERO_PKT_MOTION && s_mtu >= AERO_PACKET_SIZE * 2 + 3 &&
            uxQueueMessagesWaiting(s_tx_queue) > 0) {
            uint8_t peek[AERO_PACKET_SIZE];
            if (xQueuePeek(s_tx_queue, peek, 0) == pdTRUE && peek[2] == AERO_PKT_MOTION) {
                xQueueReceive(s_tx_queue, buf + AERO_PACKET_SIZE, 0);
                len = AERO_PACKET_SIZE * 2;
            }
        }
        struct os_mbuf *om = ble_hs_mbuf_from_flat(buf, len);
        if (!om) {
            s_dropped++;
            vTaskDelay(pdMS_TO_TICKS(2));
            continue;
        }
        int rc = ble_gatts_notify_custom(s_conn_handle, s_tx_handle, om);
        if (rc == 0) s_sent += len / AERO_PACKET_SIZE;
        else {
            s_dropped++;
            vTaskDelay(pdMS_TO_TICKS(2));
        }
    }
}

esp_err_t aero_ble_init(ble_rx_handler_t rx_handler)
{
    s_rx_handler = rx_handler;
    s_tx_queue = xQueueCreate(TX_QUEUE_DEPTH, AERO_PACKET_SIZE);
    if (!s_tx_queue) return ESP_ERR_NO_MEM;

    esp_err_t err = nimble_port_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init failed: %s", esp_err_to_name(err));
        return err;
    }
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    /* Just-Works pairing so the OS Bluetooth settings can pair/bond the controller. */
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_NO_IO;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_mitm = 0;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.store_status_cb = ble_store_util_status_rr;

    ble_svc_gap_init();
    ble_svc_gap_device_appearance_set(0x03C4);
    ble_svc_gatt_init();
    /* Device Information Service: what the OS Bluetooth settings show after pairing. */
    ble_svc_dis_init();
    ble_svc_dis_manufacturer_name_set("AiroMote");
    ble_svc_dis_model_number_set("AiroMote Motion Controller");
    {
        static char fw[16];
        snprintf(fw, sizeof(fw), "%d.%d.%d", AERO_FW_MAJOR, AERO_FW_MINOR, AERO_FW_PATCH);
        ble_svc_dis_firmware_revision_set(fw);
        static char hw[8];
        snprintf(hw, sizeof(hw), "rev%d", AERO_HW_REV);
        ble_svc_dis_hardware_revision_set(hw);
    }
    int rc = ble_gatts_count_cfg(s_gatt_svcs);
    if (rc != 0) return ESP_FAIL;
    rc = ble_gatts_add_svcs(s_gatt_svcs);
    if (rc != 0) return ESP_FAIL;
    ble_att_set_preferred_mtu(128);
    snprintf(s_name, sizeof(s_name), "AiroMote-%u", g_app.device_id);
    ble_svc_gap_device_name_set(s_name);

    ble_store_config_init();
    nimble_port_freertos_init(host_task);
    xTaskCreate(tx_task, "ble_tx", 4096, NULL, 6, NULL);
    ESP_LOGI(TAG, "NimBLE started");
    return ESP_OK;
}

bool aero_ble_send(const uint8_t *pkt32)
{
    if (!s_tx_queue || !s_subscribed) return false;
    if (xQueueSend(s_tx_queue, pkt32, 0) != pdTRUE) {
        /* Queue full: drop the oldest motion sample rather than stalling the producer. */
        uint8_t scratch[AERO_PACKET_SIZE];
        xQueueReceive(s_tx_queue, scratch, 0);
        s_dropped++;
        return xQueueSend(s_tx_queue, pkt32, 0) == pdTRUE;
    }
    return true;
}

bool aero_ble_connected(void) { return s_conn_handle != BLE_HS_CONN_HANDLE_NONE; }
bool aero_ble_subscribed(void) { return s_subscribed; }
bool aero_ble_ready(void) { return s_ready; }

void aero_ble_refresh_name(void)
{
    if (!s_ready) return;
    build_name();
    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        ble_gap_adv_stop();
        start_advertising();
    }
}

void aero_ble_stats(uint32_t *sent, uint32_t *dropped, uint16_t *mtu)
{
    if (sent) *sent = s_sent;
    if (dropped) *dropped = s_dropped;
    if (mtu) *mtu = s_mtu;
}
