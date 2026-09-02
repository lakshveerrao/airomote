import { BaseTransport, TransportUnavailableError, type TransportKind } from './types';

/**
 * WebHID transport — prepared, not active. The V1 firmware streams over BLE (and USB-CDC
 * serial); a future firmware could expose the same 32-byte packets as HID input reports.
 * When that ships, fill in `connect()` with `navigator.hid.requestDevice({filters:[{vendorId}]})`
 * and forward `inputreport` events to `emitData`. Everything above this class is unchanged.
 */
export class HidTransport extends BaseTransport {
  readonly kind: TransportKind = 'hid';
  readonly canReconnect = false;

  constructor() {
    super();
    this.info = { kind: 'hid' };
  }

  async connect(): Promise<void> {
    if (!('hid' in navigator)) throw new TransportUnavailableError('hid', 'WebHID is not supported in this browser.');
    throw new TransportUnavailableError(
      'hid',
      'The current controller firmware does not expose a HID interface. Use Bluetooth or USB.',
    );
  }

  async disconnect(): Promise<void> {
    this.setState('disconnected');
  }

  async send(): Promise<void> {
    throw new Error('HID transport not active');
  }
}
