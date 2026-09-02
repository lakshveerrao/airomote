import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FACTORY_TESTS, FactoryTestResult, type FactoryTestName } from '@aero/protocol';
import type { ControllerId } from '@aero/motion-core';
import { BackLink, Button, Icon, StatusDot } from '@/ui';
import { controllerManager, motionEngine } from '@/core/runtime';
import { transportSupport } from '@/core/transport/types';
import { useControllerSlots } from '@/store/controllers';
import './diagnostics.css';

const SLOT: ControllerId = 1;

const LABELS: Record<FactoryTestName, { label: string; hint: string }> = {
  boot: { label: 'ESP32 boot', hint: 'Firmware started and reported its version' },
  mpuDetected: { label: 'MPU6050 detected', hint: 'Sensor answers on I²C (0x68 or 0x69)' },
  accelerometer: { label: 'Accelerometer', hint: 'Reads gravity; responds when tilted' },
  gyroscope: { label: 'Gyroscope', hint: 'Responds when the controller is turned' },
  calibration: { label: 'Calibration', hint: 'Automatic calibration completed' },
  wireless: { label: 'Wireless link', hint: 'Steady stream of at least 50 packets/s' },
  battery: { label: 'Battery', hint: 'Voltage reading in range (skipped if no sense pin)' },
  button: { label: 'Button', hint: 'Skipped when the board has no button' },
  led: { label: 'Status LED', hint: 'Skipped when the board has no LED' },
  nvs: { label: 'Storage', hint: 'Settings can be saved and read back' },
};

type HostResult = 'pending' | 'running' | 'pass' | 'fail' | 'skipped';
type Stage = 'connect' | 'ready' | 'running' | 'done';

function resultClass(r: HostResult) {
  return `factory-test__result result--${r}`;
}
function resultText(r: HostResult) {
  return r === 'pass' ? 'PASS' : r === 'fail' ? 'FAIL' : r === 'skipped' ? 'SKIPPED' : r === 'running' ? 'TESTING' : 'PENDING';
}
function fromDevice(r: FactoryTestResult | undefined): HostResult {
  switch (r) {
    case FactoryTestResult.PASS:
      return 'pass';
    case FactoryTestResult.FAIL:
      return 'fail';
    case FactoryTestResult.SKIPPED:
      return 'skipped';
    default:
      return 'pending';
  }
}

export default function FactoryTestPage() {
  const slot = useControllerSlots()[SLOT];
  const connected = slot.transportState === 'connected';
  const support = transportSupport();
  const [stage, setStage] = useState<Stage>('connect');
  const [host, setHost] = useState<Partial<Record<FactoryTestName, HostResult>>>({});
  const [prompt, setPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    if (!connected && stage !== 'connect') {
      setStage('connect');
      setHost({});
      setPrompt(null);
    } else if (connected && stage === 'connect') setStage('ready');
  }, [connected, stage]);

  const connect = async (kind: 'bluetooth' | 'serial' | 'simulator') => {
    setBusy(true);
    try {
      await controllerManager.connect(SLOT, kind);
    } catch {
      /* slot shows error */
    } finally {
      setBusy(false);
    }
  };

  // Merge device-reported results with host-side verification (host wins when it ran).
  const merged = useMemo(() => {
    const out = {} as Record<FactoryTestName, HostResult>;
    for (const t of FACTORY_TESTS) out[t] = host[t] ?? fromDevice(slot.factory?.results[t]);
    return out;
  }, [host, slot.factory]);

  const wait = (ms: number) =>
    new Promise<void>((r) => {
      setTimeout(r, ms);
    });

  const waitFor = async (pred: () => boolean, timeoutMs: number): Promise<boolean> => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      if (cancel.current) return false;
      if (pred()) return true;
      await wait(80);
    }
    return false;
  };

  const runTests = useCallback(async () => {
    cancel.current = false;
    setStage('running');
    setFinishedAt(null);
    setHost({});
    const set = (t: FactoryTestName, r: HostResult) => setHost((h) => ({ ...h, [t]: r }));

    // 1. Ask the device to run its self-tests (results arrive as FACTORY_RESULT packets).
    try {
      await controllerManager.runFactoryTest(SLOT);
    } catch {
      /* continue with host checks */
    }

    // boot: info packet with firmware version
    set('boot', 'running');
    const gotInfo = await waitFor(() => controllerManager.slots[SLOT].info !== null, 4000);
    set('boot', gotInfo ? 'pass' : 'fail');
    const info = controllerManager.slots[SLOT].info;

    // mpu detected: from device info / sensor flags
    set('mpuDetected', 'running');
    await waitFor(() => controllerManager.slots[SLOT].factory?.results.mpuDetected !== FactoryTestResult.PENDING && controllerManager.slots[SLOT].factory !== null, 3000);
    const dev = controllerManager.slots[SLOT].factory?.results;
    set('mpuDetected', dev?.mpuDetected === FactoryTestResult.PASS || (info ? info.mpuAddress !== 0 && (info.sensorFlags & 1) !== 0 : false) ? 'pass' : 'fail');

    // wireless: ≥ 50 Hz over 2 s
    set('wireless', 'running');
    let minRate = Infinity;
    for (let i = 0; i < 4; i++) {
      await wait(500);
      minRate = Math.min(minRate, controllerManager.slots[SLOT].packetRateHz);
    }
    set('wireless', minRate >= 50 ? 'pass' : 'fail');

    // calibration reaches ready
    set('calibration', 'running');
    const cal = await waitFor(() => controllerManager.slots[SLOT].calibration === 'ready', 12000);
    set('calibration', cal ? 'pass' : 'fail');

    // accelerometer: gravity magnitude ≈ 1 g at rest and tilt response
    set('accelerometer', 'running');
    const g0 = motionEngine.getState(SLOT);
    const mag = Math.hypot(g0.accelRaw.x, g0.accelRaw.y, g0.accelRaw.z);
    const pitch0 = g0.orientation.pitch;
    const roll0 = g0.orientation.roll;
    setPrompt('Tilt the controller — turn it on its side or point it up.');
    const tilted = await waitFor(() => {
      const s = motionEngine.getState(SLOT);
      return Math.abs(s.orientation.pitch - pitch0) > 30 || Math.abs(s.orientation.roll - roll0) > 30;
    }, 10000);
    set('accelerometer', tilted && mag > 0.7 && mag < 1.3 ? 'pass' : 'fail');

    // gyroscope: angular speed > 100 dps (tilting usually does it; keep the prompt up)
    set('gyroscope', 'running');
    setPrompt('Now twist the controller quickly.');
    const spun = await waitFor(() => motionEngine.getState(SLOT).angularSpeed > 100, 10000);
    set('gyroscope', spun ? 'pass' : 'fail');
    setPrompt(null);

    // battery / button / led / nvs: device-reported
    for (const t of ['battery', 'button', 'led', 'nvs'] as FactoryTestName[]) {
      set(t, 'running');
      await waitFor(() => (controllerManager.slots[SLOT].factory?.results[t] ?? FactoryTestResult.PENDING) !== FactoryTestResult.PENDING, 2500);
      const r = controllerManager.slots[SLOT].factory?.results[t];
      if (r === undefined || r === FactoryTestResult.PENDING) set(t, t === 'battery' && controllerManager.slots[SLOT].battery != null ? 'pass' : 'skipped');
      else set(t, fromDevice(r));
    }
    setFinishedAt(Date.now());
    setStage('done');
  }, []);

  const failed = FACTORY_TESTS.filter((t) => merged[t] === 'fail');
  const passed = stage === 'done' && failed.length === 0;
  const info = slot.info;

  const report = useMemo(() => {
    const lines = [
      `AiroMote controller factory test`,
      `Date:      ${new Date(finishedAt ?? Date.now()).toISOString()}`,
      `Unique id: ${info?.uniqueId ?? 'unknown'}`,
      `Device id: ${info?.deviceId ?? slot.id}`,
      `Firmware:  ${info ? `${info.firmwareVersion} build ${info.firmwareBuild}` : 'unknown'}   HW rev ${info?.hardwareRevision ?? '?'}`,
      `Transport: ${slot.transportKind ?? '—'} ${slot.transportName ?? ''}`,
      `Result:    ${stage === 'done' ? (passed ? 'PASSED' : 'FAILED') : 'incomplete'}`,
      '',
      ...FACTORY_TESTS.map((t) => `${LABELS[t].label.padEnd(18)} ${resultText(merged[t])}`),
    ];
    return lines.join('\n');
  }, [finishedAt, info, slot, stage, passed, merged]);

  const nextController = async () => {
    cancel.current = true;
    await controllerManager.disconnect(SLOT);
    setHost({});
    setPrompt(null);
    setStage('connect');
    setFinishedAt(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="page factory">
      <BackLink to="/settings" label="Settings" />
      <div className="page-head" style={{ marginTop: 14 }}>
        <div>
          <div className="eyebrow">Production</div>
          <h1>Factory test</h1>
        </div>
      </div>

      {stage === 'done' && (
        <div className={`verdict ${passed ? 'verdict--pass' : 'verdict--fail'}`}>
          <h1>{passed ? 'CONTROLLER PASSED' : 'CONTROLLER FAILED'}</h1>
          {!passed && <div className="verdict__list">Failed: {failed.map((t) => LABELS[t].label).join(', ')}</div>}
          <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 20 }}>
            <Button variant="primary" size="lg" onClick={nextController}>
              Test next controller
            </Button>
            <Button size="lg" onClick={runTests}>
              <Icon.Restart size={18} /> Run again
            </Button>
          </div>
        </div>
      )}

      <div className={`factory-step ${stage !== 'connect' ? 'factory-step--noprint' : ''}`}>
        <div className="factory-step__num">Step 1</div>
        <h2>Connect the controller</h2>
        <p className="dim">Power the controller on. Its LED blinks while it waits for a connection.</p>
        <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          {!connected ? (
            <>
              <Button variant="primary" size="lg" disabled={!support.bluetooth.supported || busy} title={support.bluetooth.reason} onClick={() => connect('bluetooth')}>
                <Icon.Bluetooth size={18} /> Bluetooth
              </Button>
              <Button size="lg" disabled={!support.serial.supported || busy} title={support.serial.reason} onClick={() => connect('serial')}>
                <Icon.Usb size={18} /> USB
              </Button>
              <Button size="lg" variant="ghost" disabled={busy} onClick={() => connect('simulator')}>
                Simulated (demo)
              </Button>
              {slot.transportState === 'connecting' && <span className="dim">Connecting…</span>}
              {slot.error && <span style={{ color: 'var(--danger)' }}>{slot.error}</span>}
            </>
          ) : (
            <>
              <span className="row" style={{ gap: 8 }}>
                <StatusDot state={slot.streaming ? 'on' : 'busy'} />
                <strong>Connected</strong>
                <span className="dim">
                  via {slot.transportKind}
                  {slot.transportName ? ` · ${slot.transportName}` : ''}
                </span>
              </span>
              <Button variant="ghost" onClick={nextController}>
                Disconnect
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="factory-step">
        <div className="factory-step__num">Step 2</div>
        <h2>Identity</h2>
        <dl className="kv" style={{ fontSize: 15, marginTop: 10 }}>
          <dt>Firmware</dt>
          <dd style={{ fontSize: 15 }}>{info ? `${info.firmwareVersion} (build ${info.firmwareBuild}) · HW rev ${info.hardwareRevision}` : connected ? 'waiting for device info…' : '—'}</dd>
          <dt>Unique id</dt>
          <dd style={{ fontSize: 15 }}>{info?.uniqueId ?? '—'}</dd>
          <dt>Controller id</dt>
          <dd style={{ fontSize: 15 }}>{info ? (info.deviceId ? `Controller ${info.deviceId}` : 'unassigned') : '—'}</dd>
          <dt>Battery</dt>
          <dd style={{ fontSize: 15 }}>{slot.battery != null ? `${slot.battery}%` : 'n/a'}{info?.batteryMillivolts ? ` · ${info.batteryMillivolts} mV` : ''}</dd>
        </dl>
        <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button size="sm" disabled={!connected} onClick={() => void controllerManager.setDeviceId(SLOT, 1)}>
            Set as Controller 1
          </Button>
          <Button size="sm" disabled={!connected} onClick={() => void controllerManager.setDeviceId(SLOT, 2)}>
            Set as Controller 2
          </Button>
          <Button size="sm" variant="ghost" disabled={!connected} onClick={() => void controllerManager.identify(SLOT)}>
            Identify (blink LED)
          </Button>
        </div>
      </div>

      <div className="factory-step">
        <div className="factory-step__num">Step 3</div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2>Run tests</h2>
          <Button variant="primary" size="lg" disabled={!connected || stage === 'running'} onClick={runTests}>
            {stage === 'running' ? 'Testing…' : stage === 'done' ? 'Run again' : 'Run tests'}
          </Button>
        </div>
        {prompt && (
          <div className="prompt-banner">
            <Icon.Wave size={22} /> {prompt}
          </div>
        )}
        <div className="factory-tests">
          {FACTORY_TESTS.map((t) => (
            <div key={t} className="factory-test">
              <div>
                {LABELS[t].label}
                <div className="factory-test__hint">{LABELS[t].hint}</div>
              </div>
              <span className={resultClass(merged[t])}>{resultText(merged[t])}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="factory-step">
        <div className="factory-step__num">Report</div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Summary</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" onClick={copy}>
              {copied ? 'Copied' : 'Copy report'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
        <pre className="report">{report}</pre>
      </div>
    </div>
  );
}
