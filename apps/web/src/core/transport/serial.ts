import { BaseTransport, TransportUnavailableError, type TransportKind } from './types';

/**
 * Web Serial transport — the controller plugged in over USB (native USB-CDC on ESP32-C6).
 * Same 32-byte packet stream as BLE; the PacketStreamDecoder handles arbitrary chunking.
 * Mainly a development / factory-test path, also a fallback where BLE is unavailable.
 */
export class SerialTransport extends BaseTransport {
  readonly kind: TransportKind = 'serial';
  readonly canReconnect = true;
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoop: Promise<void> | null = null;
  private closing = false;

  constructor(
    port?: SerialPort,
    private readonly baudRate = 115200,
  ) {
    super();
    this.info = { kind: 'serial' };
    if (port) this.port = port;
  }

  async connect(): Promise<void> {
    if (!('serial' in navigator)) throw new TransportUnavailableError('serial', 'Web Serial is not supported here.');
    this.setState('connecting');
    try {
      if (!this.port) {
        this.port = await navigator.serial.requestPort({
          // Espressif USB VID; harmless if the board uses a different bridge — user can still pick it.
          filters: [{ usbVendorId: 0x303a }],
        });
      }
      await this.port.open({ baudRate: this.baudRate, bufferSize: 4096 });
      const info = this.port.getInfo();
      this.info = {
        kind: 'serial',
        name: `USB ${info.usbVendorId?.toString(16) ?? ''}:${info.usbProductId?.toString(16) ?? ''}`.trim(),
        id: `${info.usbVendorId}-${info.usbProductId}`,
      };
      this.closing = false;
      this.writer = this.port.writable!.getWriter();
      this.readLoop = this.pump();
      this.port.addEventListener('disconnect', this.handleDisconnect);
      this.setState('connected');
    } catch (e) {
      this.setState('error', (e as Error).message);
      throw e;
    }
  }

  private handleDisconnect = (): void => {
    void this.disconnect();
  };

  private async pump(): Promise<void> {
    while (this.port?.readable && !this.closing) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.emitData(value, performance.now());
        }
      } catch (e) {
        if (!this.closing) this.setState('error', (e as Error).message);
        break;
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    try {
      this.port?.removeEventListener('disconnect', this.handleDisconnect);
      await this.reader?.cancel().catch(() => undefined);
      await this.readLoop?.catch(() => undefined);
      this.writer?.releaseLock();
      this.writer = null;
      await this.port?.close().catch(() => undefined);
    } finally {
      this.setState('disconnected');
    }
  }

  async forget(): Promise<void> {
    await this.disconnect();
    const p = this.port as (SerialPort & { forget?: () => Promise<void> }) | null;
    await p?.forget?.().catch(() => undefined);
    this.port = null;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Not connected');
    await this.writer.write(bytes);
  }
}
