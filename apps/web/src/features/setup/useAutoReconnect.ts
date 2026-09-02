import { useEffect } from 'react';
import type { ControllerId } from '@aero/motion-core';
import { controllerManager } from '@/core/runtime';
import { BluetoothTransport } from '@/core/transport/bluetooth';
import { useSettings } from '@/store/settings';

/**
 * On app start, silently re-attach previously permitted Bluetooth controllers
 * (Chrome's `navigator.bluetooth.getDevices()`); no picker, no user gesture required.
 * Failures are ignored — the user can always connect manually.
 */
export function useAutoReconnect(): void {
  useEffect(() => {
    const remembered = useSettings.getState().rememberedDevices;
    let cancelled = false;
    (async () => {
      for (const id of [1, 2] as ControllerId[]) {
        const d = remembered[id];
        if (!d || d.kind !== 'bluetooth' || !d.id) continue;
        if (controllerManager.slots[id].transportState !== 'disconnected') continue;
        try {
          const t = await BluetoothTransport.fromPermitted(d.id);
          if (!t || cancelled) continue;
          await controllerManager.attach(id, t);
        } catch {
          /* silent: device off / out of range / API unsupported */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
