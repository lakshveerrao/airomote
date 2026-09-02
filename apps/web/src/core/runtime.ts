import { MotionEngine } from '@aero/motion-core';
import { ActionBus, ActivityRegistry } from '@aero/activity-engine';
import { ControllerManager } from './ControllerManager';

/**
 * App-wide singletons. Motion data is high-rate and must not flow through React state;
 * components subscribe to these directly (see hooks in store/).
 */
export const motionEngine = new MotionEngine();
export const controllerManager = new ControllerManager(motionEngine);
export const actionBus = new ActionBus();
export const activityRegistry = new ActivityRegistry();

declare global {
  interface Window {
    __aero?: { motionEngine: MotionEngine; controllerManager: ControllerManager; actionBus: ActionBus };
  }
}
if (typeof window !== 'undefined') {
  window.__aero = { motionEngine, controllerManager, actionBus };
}
