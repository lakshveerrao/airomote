import { PACKET_SIZE, PROTOCOL_MAGIC } from './constants';
import { decodePacket, type DecodeError } from './codec';
import type { DevicePacket } from './types';

export interface StreamStats {
  packets: number;
  bytes: number;
  crcErrors: number;
  resyncs: number;
  decodeErrors: number;
}

/**
 * Reassembles 32-byte packets out of an arbitrary byte stream (BLE notifications may carry
 * 1..N packets; serial may split packets anywhere). Resynchronises on the magic byte after
 * a CRC failure so one corrupted byte cannot poison the stream.
 */
export class PacketStreamDecoder {
  private buffer = new Uint8Array(PACKET_SIZE * 8);
  private length = 0;
  readonly stats: StreamStats = { packets: 0, bytes: 0, crcErrors: 0, resyncs: 0, decodeErrors: 0 };

  constructor(
    private readonly onPacket: (p: DevicePacket) => void,
    private readonly onError?: (e: DecodeError) => void,
  ) {}

  push(chunk: Uint8Array, receivedAt?: number): void {
    this.stats.bytes += chunk.length;
    if (this.length + chunk.length > this.buffer.length) {
      const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.length + chunk.length));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(chunk, this.length);
    this.length += chunk.length;
    this.drain(receivedAt);
  }

  reset(): void {
    this.length = 0;
  }

  private drain(receivedAt?: number): void {
    let offset = 0;
    while (this.length - offset >= 1) {
      if (this.buffer[offset] !== PROTOCOL_MAGIC) {
        offset++;
        this.stats.resyncs++;
        continue;
      }
      if (this.length - offset < PACKET_SIZE) break;
      const slice = this.buffer.slice(offset, offset + PACKET_SIZE);
      const result = decodePacket(slice, receivedAt);
      if (result.ok) {
        this.stats.packets++;
        this.onPacket(result.packet);
        offset += PACKET_SIZE;
      } else {
        if (result.reason === 'bad_crc') this.stats.crcErrors++;
        else this.stats.decodeErrors++;
        this.onError?.(result);
        offset += 1; // resync from next byte
        this.stats.resyncs++;
      }
    }
    if (offset > 0) {
      this.buffer.copyWithin(0, offset, this.length);
      this.length -= offset;
    }
  }
}
