import { useEffect, useRef, useState } from 'react';
import type { ControllerId, ControllerMotionState, GestureEvent } from '@aero/motion-core';
import { controllerManager, motionEngine } from '@/core/runtime';
import type { ControllerSlotState } from '@/core/ControllerManager';

/** Throttled (≈60 Hz max) slot snapshot for UI: connection, calibration, battery… */
export function useControllerSlots(): Record<ControllerId, ControllerSlotState> {
  const [slots, setSlots] = useState(() => controllerManager.snapshot());
  useEffect(() => controllerManager.subscribe(setSlots), []);
  return slots;
}

export function useControllerSlot(id: ControllerId): ControllerSlotState {
  return useControllerSlots()[id];
}

/**
 * Motion state without React re-renders: returns a ref that always holds the latest state.
 * Read it inside useFrame / rAF loops.
 */
export function useMotionRef(id: ControllerId) {
  const ref = useRef<ControllerMotionState>(motionEngine.getState(id));
  useEffect(() => {
    ref.current = motionEngine.getState(id);
    return motionEngine.on('state', (s) => {
      if (s.controllerId === id) ref.current = s;
    });
  }, [id]);
  return ref;
}

/** Low-rate (default 15 Hz) React state for dashboards / diagnostics. */
export function useMotionState(id: ControllerId, hz = 15): ControllerMotionState {
  const [state, setState] = useState(() => motionEngine.getState(id));
  useEffect(() => {
    let latest = motionEngine.getState(id);
    const off = motionEngine.on('state', (s) => {
      if (s.controllerId === id) latest = s;
    });
    const timer = window.setInterval(() => setState(latest), 1000 / hz);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [id, hz]);
  return state;
}

export function useGestureEvents(cb: (g: GestureEvent) => void): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => motionEngine.on('gesture', (g) => cbRef.current(g)), []);
}

export type ConnectionSummary = {
  connected: ControllerId[];
  anyConnected: boolean;
  bothConnected: boolean;
  calibrating: boolean;
};

export function useConnectionSummary(): ConnectionSummary {
  const slots = useControllerSlots();
  const connected = ([1, 2] as ControllerId[]).filter((id) => slots[id].transportState === 'connected');
  return {
    connected,
    anyConnected: connected.length > 0,
    bothConnected: connected.length === 2,
    calibrating: connected.some((id) => slots[id].calibration === 'hold-still' || slots[id].calibration === 'calibrating'),
  };
}
