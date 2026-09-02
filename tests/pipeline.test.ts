// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionEngine } from '@aero/motion-core';
import { ActionMapper, type ActionEvent } from '@aero/activity-engine';
import { PacketType } from '@aero/protocol';
import { ControllerManager } from '../apps/web/src/core/ControllerManager';
import { SimulatorTransport } from '../apps/web/src/core/transport/simulator';
import { motionKartDefinition } from '../apps/web/src/activities/motion-kart/definition';
import { drumsDefinition } from '../apps/web/src/activities/drums/definition';

/**
 * End-to-end: SimulatorTransport (real encoded bytes) → ControllerManager (stream decoder,
 * sequence tracking, INFO/CALIBRATION bookkeeping) → MotionEngine → ActionMapper.
 * Exercises the exact path hardware uses; only the byte source differs.
 */
describe('controller pipeline', { timeout: 30000 }, () => {
  let engine: MotionEngine;
  let manager: ControllerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 0.001, Date.now() + t));
    engine = new MotionEngine();
    manager = new ControllerManager(engine);
  });
  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const settle = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  /** attach() awaits a setTimeout inside SimulatorTransport.connect — drive fake timers while it resolves. */
  const attach = async (id: 1 | 2, t: SimulatorTransport) => {
    const p = manager.attach(id, t);
    await settle(400);
    await p;
  };

  it('connects one simulated controller, calibrates automatically and streams motion', async () => {
    const t1 = new SimulatorTransport(1);
    await attach(1, t1);
    expect(manager.slots[1].transportState).toBe('connected');
    await settle(3500);
    expect(manager.slots[1].calibration).toBe('ready');
    expect(manager.slots[1].streaming).toBe(true);
    expect(manager.slots[1].info?.firmwareVersion).toBe('1.0.0');
    expect(manager.slots[1].lastCalibration?.quality).toBeGreaterThan(0);
    expect(manager.slots[1].packetRateHz).toBeGreaterThan(60);
    expect(engine.connectedIds()).toEqual([1]);
    expect(engine.getState(2).connected).toBe(false);
  });

  it('two controllers stream independently and roles map to the right slot', async () => {
    await attach(1, new SimulatorTransport(1));
    await attach(2, new SimulatorTransport(2));
    await settle(3500);
    expect(engine.connectedIds()).toEqual([1, 2]);
    const actions: ActionEvent[] = [];
    const mapper = new ActionMapper(drumsDefinition.presets[0], { stick1: 1, stick2: 2 }, (e) => actions.push(e));
    const offS = engine.on('state', (s) => mapper.onState(s));
    const offG = engine.on('gesture', (g) => mapper.onGesture(g));
    manager.getSimulator(2)!.model.strike(0.9);
    await settle(700);
    offS();
    offG();
    const strikes = actions.filter((a) => a.action === 'STRIKE');
    expect(strikes.length).toBe(1);
    expect(strikes[0].controllerId).toBe(2);
    expect(strikes[0].role).toBe('stick2');
    expect(actions.filter((a) => a.action === 'SELECT_ZONE' && a.controllerId === 1).length).toBeGreaterThan(0);
  });

  it('tilting the driver controller produces steering; a dropout releases it and reconnect resumes', async () => {
    const t1 = new SimulatorTransport(1);
    await attach(1, t1);
    await settle(3500);
    const actions: ActionEvent[] = [];
    const mapper = new ActionMapper(motionKartDefinition.presets[0], { driver: 1, copilot: null }, (e) => actions.push(e));
    engine.on('state', (s) => mapper.onState(s));
    engine.on('gesture', (g) => mapper.onGesture(g));
    engine.on('connection', (id, c) => {
      if (!c) mapper.releaseAll(id, performance.now());
    });
    t1.model.targetRoll = 30;
    await settle(800);
    const steer = actions.filter((a) => a.action === 'CONTINUOUS_X');
    expect(steer.length).toBeGreaterThan(0);
    expect(steer.at(-1)!.value).toBeGreaterThan(0.6);

    t1.simulateDropout(3500);
    await settle(100);
    expect(manager.slots[1].transportState).toBe('reconnecting');
    await settle(2600); // > staleMs (2 s) without packets → engine marks the controller gone
    expect(engine.getState(1).connected).toBe(false);
    expect(actions.some((a) => a.action === 'CONTINUOUS_X' && a.phase === 'end')).toBe(true);
    // back online
    await settle(1500);
    expect(manager.slots[1].transportState).toBe('connected');
    expect(engine.getState(1).connected).toBe(true);
    expect(manager.getSimulator(1)).toBe(t1);
  });

  it('drops lost packets gracefully and keeps loss statistics', async () => {
    const t1 = new SimulatorTransport(1);
    t1.dropRate = 0.2;
    await attach(1, t1);
    await settle(3000);
    const stats = engine.getSequenceStats(1);
    expect(stats.dropped).toBeGreaterThan(10);
    expect(stats.lossRatio).toBeGreaterThan(0.1);
    expect(stats.lossRatio).toBeLessThan(0.35);
    expect(engine.getState(1).connected).toBe(true);
  });

  it('commands reach the device: recalibrate restarts the calibration sequence', async () => {
    const t1 = new SimulatorTransport(1);
    await attach(1, t1);
    await settle(3500);
    expect(manager.slots[1].calibration).toBe('ready');
    await manager.recalibrate(1);
    await settle(300);
    expect(['hold-still', 'calibrating']).toContain(manager.slots[1].calibration);
    await settle(3500);
    expect(manager.slots[1].calibration).toBe('ready');
  });

  it('swap moves the transport to the other slot', async () => {
    await attach(1, new SimulatorTransport(1));
    await settle(1000);
    manager.swap();
    await settle(1000);
    expect(manager.slots[2].transportState).toBe('connected');
    expect(manager.slots[1].transportState).toBe('disconnected');
    expect(engine.connectedIds()).toEqual([2]);
  });

  it('factory test results arrive progressively and complete', async () => {
    const t1 = new SimulatorTransport(1);
    await attach(1, t1);
    await settle(500);
    const seen: number[] = [];
    manager.onPacket((_, p) => {
      if (p.type === PacketType.FACTORY_RESULT) seen.push(Object.values(p.results).filter((r) => r !== 0).length);
    });
    await manager.runFactoryTest(1);
    await settle(3000);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(manager.slots[1].factory?.complete).toBe(true);
    expect(manager.slots[1].factory?.overallPass).toBe(true);
    t1.model.failFactoryTest = 'gyroscope';
    await manager.runFactoryTest(1);
    await settle(3000);
    expect(manager.slots[1].factory?.overallPass).toBe(false);
  });
});
