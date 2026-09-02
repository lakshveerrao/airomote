import { BLE_NAME_PREFIX, BLE_RX_CHAR_UUID, BLE_SERVICE_UUID, BLE_TX_CHAR_UUID } from '@aero/protocol';
import { BaseTransport, TransportUnavailableError, type TransportKind } from './types';

/**
 * Web Bluetooth transport. One instance per physical controller.
 * - Notifications on TX carry 1..N 32-byte packets.
 * - Writes to RX carry 32-byte command packets (write-without-response for latency).
 * - Automatic reconnect with back-off after an unexpected disconnect (the BluetoothDevice
 *   object stays valid for the page lifetime; with `getDevices()` permission it survives reloads).
 */
export class BluetoothTransport extends BaseTransport {
  readonly kind: TransportKind = 'bluetooth';
  private device: BluetoothDevice | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private wantConnected = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;

  constructor(device?: BluetoothDevice) {
    super();
    this.info = { kind: 'bluetooth' };
    if (device) this.adopt(device);
  }

  get canReconnect(): boolean {
    return this.device !== null;
  }

  /** Try to re-acquire a previously permitted device without a picker (Chrome: needs the flag or default in recent versions). */
  static async fromPermitted(deviceId: string): Promise<BluetoothTransport | null> {
    const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
    if (!bt?.getDevices) return null;
    try {
      const devices = await bt.getDevices();
      const d = devices.find((x) => x.id === deviceId);
      return d ? new BluetoothTransport(d) : null;
    } catch {
      return null;
    }
  }

  private adopt(device: BluetoothDevice): void {
    this.device = device;
    this.info = { kind: 'bluetooth', name: device.name ?? 'Aero controller', id: device.id };
    device.addEventListener('gattserverdisconnected', this.handleDisconnected);
  }

  async connect(): Promise<void> {
    if (!('bluetooth' in navigator)) throw new TransportUnavailableError('bluetooth', 'Web Bluetooth is not supported here.');
    this.wantConnected = true;
    this.setState('connecting');
    try {
      if (!this.device) {
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [BLE_SERVICE_UUID] }, { namePrefix: BLE_NAME_PREFIX }],
          optionalServices: [BLE_SERVICE_UUID],
        });
        this.adopt(device);
      }
      await this.openGatt();
      this.reconnectAttempt = 0;
      this.setState('connected');
    } catch (e) {
      this.setState('error', (e as Error).message);
      this.wantConnected = false;
      throw e;
    }
  }

  private async openGatt(): Promise<void> {
    const server = await this.device!.gatt!.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    this.tx = await service.getCharacteristic(BLE_TX_CHAR_UUID);
    this.rx = await service.getCharacteristic(BLE_RX_CHAR_UUID);
    this.tx.addEventListener('characteristicvaluechanged', this.handleNotification);
    await this.tx.startNotifications();
  }

  private handleNotification = (ev: Event): void => {
    const c = ev.target as BluetoothRemoteGATTCharacteristic;
    const v = c.value;
    if (!v) return;
    this.emitData(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), performance.now());
  };

  private handleDisconnected = (): void => {
    this.tx?.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.tx = null;
    this.rx = null;
    if (!this.wantConnected) {
      this.setState('disconnected');
      return;
    }
    this.setState('reconnecting');
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.wantConnected || !this.device) return;
      try {
        await this.openGatt();
        this.reconnectAttempt = 0;
        this.setState('connected');
      } catch (e) {
        if (this.reconnectAttempt > 8) {
          this.wantConnected = false;
          this.setState('error', `Lost connection: ${(e as Error).message}`);
        } else this.scheduleReconnect();
      }
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.tx?.removeEventListener('characteristicvaluechanged', this.handleNotification);
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } finally {
      this.tx = null;
      this.rx = null;
      this.setState('disconnected');
    }
  }

  /** Drop the permission-level pairing so the picker is shown again next time. */
  async forget(): Promise<void> {
    await this.disconnect();
    const d = this.device as (BluetoothDevice & { forget?: () => Promise<void> }) | null;
    if (d) {
      d.removeEventListener('gattserverdisconnected', this.handleDisconnected);
      try {
        await d.forget?.();
      } catch {
        /* not supported everywhere */
      }
    }
    this.device = null;
    this.info = { kind: 'bluetooth' };
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.rx) throw new Error('Not connected');
    const rx = this.rx as BluetoothRemoteGATTCharacteristic & {
      writeValueWithoutResponse?: (v: BufferSource) => Promise<void>;
    };
    const buf = bytes.slice().buffer as ArrayBuffer;
    if (rx.writeValueWithoutResponse) await rx.writeValueWithoutResponse(buf);
    else await rx.writeValue(buf);
  }
}
