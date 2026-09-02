/**
 * Transport abstraction. A transport moves bytes between the browser and ONE controller.
 * It knows nothing about packets, motion or activities. The ControllerManager owns
 * decoding and routing. Swapping BLE for Serial/HID/WebSocket never touches activity code.
 */
export type TransportKind = 'bluetooth' | 'serial' | 'hid' | 'simulator';

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface TransportInfo {
  kind: TransportKind;
  /** Human-friendly device name if the transport knows one. */
  name?: string;
  /** Stable id the browser exposes (BluetoothDevice.id, serial port info…). */
  id?: string;
}

export interface ControllerTransport {
  readonly kind: TransportKind;
  readonly state: TransportState;
  readonly info: TransportInfo;
  /**
   * Opens the connection. For browser APIs that need a user gesture (Web Bluetooth, Web Serial)
   * this must be called from a click handler. Resolves once bytes can flow.
   */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Host → device bytes (commands). */
  send(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array, receivedAt: number) => void): () => void;
  onStateChange(cb: (state: TransportState, error?: string) => void): () => void;
  /** Whether the transport can reconnect the same device without a new picker dialog. */
  readonly canReconnect: boolean;
}

export class TransportUnavailableError extends Error {
  constructor(
    public readonly kind: TransportKind,
    message: string,
  ) {
    super(message);
    this.name = 'TransportUnavailableError';
  }
}

/** Shared listener bookkeeping for transport implementations. */
export abstract class BaseTransport implements ControllerTransport {
  abstract readonly kind: TransportKind;
  abstract readonly canReconnect: boolean;
  state: TransportState = 'disconnected';
  info: TransportInfo = { kind: 'simulator' };
  private dataListeners = new Set<(b: Uint8Array, t: number) => void>();
  private stateListeners = new Set<(s: TransportState, e?: string) => void>();

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(bytes: Uint8Array): Promise<void>;

  onData(cb: (bytes: Uint8Array, receivedAt: number) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onStateChange(cb: (state: TransportState, error?: string) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  protected emitData(bytes: Uint8Array, receivedAt = performance.now()): void {
    for (const l of this.dataListeners) l(bytes, receivedAt);
  }

  protected setState(state: TransportState, error?: string): void {
    if (this.state === state && !error) return;
    this.state = state;
    for (const l of this.stateListeners) l(state, error);
  }
}

export function transportSupport(): Record<TransportKind, { supported: boolean; reason?: string }> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const secure = typeof window !== 'undefined' ? window.isSecureContext : true;
  return {
    bluetooth: nav && 'bluetooth' in nav && secure
      ? { supported: true }
      : { supported: false, reason: secure ? 'Web Bluetooth is not available in this browser. Use Chrome or Edge.' : 'Web Bluetooth needs HTTPS or localhost.' },
    serial: nav && 'serial' in nav && secure
      ? { supported: true }
      : { supported: false, reason: 'Web Serial is not available in this browser. Use Chrome or Edge on desktop.' },
    hid: nav && 'hid' in nav && secure
      ? { supported: true, reason: 'WebHID is available but the current firmware streams over BLE/serial.' }
      : { supported: false, reason: 'WebHID is not available in this browser.' },
    simulator: { supported: true },
  };
}
