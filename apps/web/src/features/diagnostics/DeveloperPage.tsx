import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ControllerId, GestureEvent, MotionConfig } from '@aero/motion-core';
import type { ActionEvent } from '@aero/activity-engine';
import { PROTOCOL_VERSION, StatusFlag, DeviceErrorCode } from '@aero/protocol';
import { BackLink, Button, Segmented, Spinner, StatusDot } from '@/ui';
import { actionBus, controllerManager, motionEngine } from '@/core/runtime';
import { transportSupport } from '@/core/transport/types';
import type { SimulatorTransport } from '@/core/transport/simulator';
import type { LogEntry } from '@/core/ControllerManager';
import { useControllerSlots, useMotionState } from '@/store/controllers';
import { useSettings } from '@/store/settings';
import { LiveStream } from './LiveStream';
import { SimulatorPanel } from './SimulatorPanel';
import './diagnostics.css';

const ControllerScene = lazy(() => import('@/features/setup/ControllerScene').then((m) => ({ default: m.ControllerScene })));

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const COLORS: Record<ControllerId, string> = { 1: '#6ea8ff', 2: '#ff9a6a' };
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function Vec({ label, v, d = 3 }: { label: string; v: { x: number; y: number; z: number }; d?: number }) {
  return (
    <>
      <span className="vec__label">{label}</span>
      <span className="vec__v vec__v--x">{f(v.x, d)}</span>
      <span className="vec__v vec__v--y">{f(v.y, d)}</span>
      <span className="vec__v vec__v--z">{f(v.z, d)}</span>
    </>
  );
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="diag-card">
      <div className="diag-card__head">
        <span className="diag-card__title">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function ControllerColumn({ id }: { id: ControllerId }) {
  const slot = useControllerSlots()[id];
  const name = useSettings((s) => s.controllerNames[id]);
  const state = useMotionState(id, 20);
  const support = transportSupport();
  const [busy, setBusy] = useState(false);
  const connected = slot.transportState === 'connected';
  const transport = controllerManager.getTransport(id);
  const sim = controllerManager.getSimulator(id);
  const seq = motionEngine.getSequenceStats(id);
  const proc = motionEngine.getProcessor(id);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.warn(e);
    } finally {
      setBusy(false);
    }
  };

  const info = slot.info;
  const cal = slot.lastCalibration;
  const stateLabel =
    slot.transportState === 'connected' ? (slot.streaming ? 'connected · streaming' : 'connected · no data') : slot.transportState;

  return (
    <div>
      <div className="diag-controller-head">
        <span className="swatch" style={{ background: COLORS[id] }} />
        <h2>{name}</h2>
        <span className="dim" style={{ fontSize: 13 }}>
          slot {id}
        </span>
        <span className="row" style={{ marginLeft: 'auto', gap: 8, fontSize: 13 }}>
          <StatusDot state={slot.transportState === 'error' ? 'error' : connected ? (slot.streaming ? 'on' : 'busy') : slot.transportState === 'disconnected' ? 'off' : 'busy'} />
          <span className="mono dim">{stateLabel}</span>
        </span>
      </div>

      <Card title="Connection">
        <dl className="kv">
          <dt>Transport</dt>
          <dd>{slot.transportKind ?? '—'}</dd>
          <dt>Device</dt>
          <dd title={slot.transportId ?? ''}>{slot.transportName ?? '—'}{slot.transportId ? ` · ${slot.transportId}` : ''}</dd>
          <dt>State</dt>
          <dd>{slot.transportState}</dd>
          {slot.error && (
            <>
              <dt>Error</dt>
              <dd style={{ color: 'var(--danger)', whiteSpace: 'normal' }}>{slot.error}</dd>
            </>
          )}
        </dl>
        <div className="btn-wrap" style={{ marginTop: 12 }}>
          {!connected ? (
            <>
              <Button size="sm" disabled={!support.bluetooth.supported || busy} title={support.bluetooth.reason} onClick={() => run(() => controllerManager.connect(id, 'bluetooth'))}>
                Bluetooth
              </Button>
              <Button size="sm" disabled={!support.serial.supported || busy} title={support.serial.reason} onClick={() => run(() => controllerManager.connect(id, 'serial'))}>
                USB serial
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => controllerManager.connect(id, 'simulator'))}>
                Connect simulated controller
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => run(() => controllerManager.recalibrate(id))}>Recalibrate</Button>
              <Button size="sm" onClick={() => run(() => controllerManager.identify(id))}>Identify</Button>
              <Button size="sm" onClick={() => run(() => controllerManager.sendCommand(id, 8))}>Get info</Button>
              <Button size="sm" onClick={() => controllerManager.setNeutral(id)}>Set neutral</Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => controllerManager.reboot(id))}>Reboot</Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (window.confirm(`Factory-reset ${name}? Calibration and device settings on the controller will be erased.`)) void run(() => controllerManager.factoryReset(id));
                }}
              >
                Factory reset
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => controllerManager.disconnect(id))}>Disconnect</Button>
              {transport && transport.kind !== 'simulator' && (
                <Button size="sm" variant="ghost" onClick={() => run(() => controllerManager.forget(id))}>Forget</Button>
              )}
            </>
          )}
        </div>
      </Card>

      {sim && <SimulatorPanel id={id} transport={sim as SimulatorTransport} />}

      <Card title="Device">
        <dl className="kv">
          <dt>Firmware</dt>
          <dd>{info ? `${info.firmwareVersion} (build ${info.firmwareBuild})` : '—'}</dd>
          <dt>Hardware rev</dt>
          <dd>{info ? info.hardwareRevision : '—'}</dd>
          <dt>Protocol</dt>
          <dd>{info ? `${info.protocolVersion} (host ${PROTOCOL_VERSION})` : `host ${PROTOCOL_VERSION}`}</dd>
          <dt>Unique id</dt>
          <dd>{info?.uniqueId ?? '—'}</dd>
          <dt>Device id</dt>
          <dd>{info ? info.deviceId : '—'}</dd>
          <dt>MPU6050</dt>
          <dd>{info ? (info.mpuAddress ? `0x${info.mpuAddress.toString(16)}` : 'not found') : '—'}</dd>
          <dt>Sensor flags</dt>
          <dd>{info ? `0b${info.sensorFlags.toString(2).padStart(3, '0')} (whoami/accel/gyro)` : '—'}</dd>
          <dt>Error code</dt>
          <dd style={info && info.errorCode ? { color: 'var(--danger)' } : undefined}>{info ? `${info.errorCode} ${DeviceErrorCode[info.errorCode] ?? ''}` : '—'}</dd>
          <dt>Uptime</dt>
          <dd>{info ? `${(info.uptimeMs / 1000).toFixed(0)} s` : '—'}</dd>
          <dt>Battery</dt>
          <dd>{slot.battery != null ? `${slot.battery}%` : 'n/a'}{info?.batteryMillivolts ? ` · ${info.batteryMillivolts} mV` : ''}</dd>
          <dt>Status bits</dt>
          <dd>{info ? `0x${info.status.toString(16).padStart(2, '0')}` : '—'}</dd>
        </dl>
        {info && (
          <div className="flags">
            {Object.entries(StatusFlag)
              .filter(([k]) => Number.isNaN(Number(k)))
              .map(([k, bit]) => (
                <span key={k} className={`flag ${(info.status & (bit as number)) !== 0 ? (k === 'ERROR' || k === 'LOW_BATTERY' ? 'flag--err' : 'flag--on') : ''}`}>
                  {k.toLowerCase().replace('_', ' ')}
                </span>
              ))}
          </div>
        )}
      </Card>

      <Card title="Calibration">
        <dl className="kv">
          <dt>Phase</dt>
          <dd>{slot.calibration}</dd>
          <dt>Quality</dt>
          <dd>{cal ? `${cal.quality}/100 · ${cal.sampleCount} samples` : '—'}</dd>
        </dl>
        <div className="vec" style={{ marginTop: 8 }}>
          <span className="vec__label" />
          <span className="vec__v dim">x</span>
          <span className="vec__v dim">y</span>
          <span className="vec__v dim">z</span>
          <Vec label="Gyro offset" v={cal?.gyroOffset ?? { x: NaN, y: NaN, z: NaN }} d={2} />
          <Vec label="Accel base" v={cal?.accelBaseline ?? { x: NaN, y: NaN, z: NaN }} d={3} />
          <Vec label="Host bias" v={proc.gyroBias} d={2} />
        </div>
        <div className="flags">
          <span className={`flag ${state.calibrated ? 'flag--on' : ''}`}>calibrated</span>
          <span className={`flag ${state.calibrating ? 'flag--warn' : ''}`}>calibrating</span>
          <span className={`flag ${proc.hasNeutral ? 'flag--on' : ''}`}>neutral set</span>
        </div>
      </Card>

      <Card title="Link">
        <dl className="kv kv--3">
          <dt>Rate</dt>
          <dt>Latency</dt>
          <dt>Loss</dt>
          <dd>{slot.packetRateHz} Hz</dd>
          <dd>{f(slot.latencyMs, 1)} ms</dd>
          <dd>{f(slot.lossRatio * 100, 2)}%</dd>
          <dt>Dropped</dt>
          <dt>Duplicates</dt>
          <dt>Out of order</dt>
          <dd>{seq.dropped}</dd>
          <dd>{seq.duplicates}</dd>
          <dd>{seq.outOfOrder}</dd>
          <dt>Received</dt>
          <dt>CRC errors</dt>
          <dt>Seq stats</dt>
          <dd>{seq.received}</dd>
          <dd>{slot.crcErrors}</dd>
          <dd>{state.packetRateHz} Hz (engine)</dd>
        </dl>
        <div className="meter" style={{ marginTop: 10 }}>
          <div className="meter__fill" style={{ width: `${Math.min(100, slot.packetRateHz)}%`, background: slot.packetRateHz > 50 ? 'var(--ok)' : 'var(--warning)' }} />
        </div>
      </Card>

      <Card title="Live motion" right={<span className="mono dim" style={{ fontSize: 11 }}>t={state.timestamp} ms</span>}>
        <div className="vec">
          <span className="vec__label" />
          <span className="vec__v dim">x</span>
          <span className="vec__v dim">y</span>
          <span className="vec__v dim">z</span>
          <Vec label="Accel raw g" v={state.accelRaw} />
          <Vec label="Accel g" v={state.accel} />
          <Vec label="Linear g" v={state.linearAccel} />
          <Vec label="Gyro raw °/s" v={state.gyroRaw} d={1} />
          <Vec label="Gyro °/s" v={state.gyro} d={1} />
          <Vec label="Vel hint" v={state.velocityHint} />
        </div>
        <div className="vec" style={{ marginTop: 10 }}>
          <span className="vec__label" />
          <span className="vec__v dim">pitch</span>
          <span className="vec__v dim">roll</span>
          <span className="vec__v dim">yaw</span>
          <span className="vec__label">Orientation °</span>
          <span className="vec__v">{f(state.orientation.pitch, 1)}</span>
          <span className="vec__v">{f(state.orientation.roll, 1)}</span>
          <span className="vec__v">{f(state.orientation.yaw, 1)}</span>
          <span className="vec__label">Relative °</span>
          <span className="vec__v">{f(state.relative.pitch, 1)}</span>
          <span className="vec__v">{f(state.relative.roll, 1)}</span>
          <span className="vec__v">{f(state.relative.yaw, 1)}</span>
        </div>
        <dl className="kv kv--3" style={{ marginTop: 10 }}>
          <dt>Angular speed</dt>
          <dt>Magnitude</dt>
          <dt>Jerk</dt>
          <dd>{f(state.angularSpeed, 1)} °/s</dd>
          <dd>{f(state.motionMagnitude, 3)} g</dd>
          <dd>{f(state.jerk, 1)} g/s</dd>
          <dt>Confidence</dt>
          <dt>Direction</dt>
          <dt>dt</dt>
          <dd>{f(state.confidence, 2)}</dd>
          <dd>{state.movementDirection ?? '—'}</dd>
          <dd>{f(state.dt * 1000, 1)} ms</dd>
        </dl>
        <div className="flags">
          <span className={`flag ${state.connected ? 'flag--on' : ''}`}>connected</span>
          <span className={`flag ${state.isStationary ? 'flag--on' : ''}`}>stationary</span>
          <span className={`flag ${state.isSuddenMotion ? 'flag--warn' : ''}`}>sudden motion</span>
          <span className={`flag ${proc.strike.state !== 'READY' ? 'flag--warn' : ''}`}>strike: {proc.strike.state.toLowerCase()}</span>
        </div>
        <div className="scope-legend" style={{ marginTop: 12 }}>
          <span style={{ color: '#ff7a7a' }}>■ x</span>
          <span style={{ color: '#7ad67a' }}>■ y</span>
          <span style={{ color: '#7ab8ff' }}>■ z</span>
        </div>
        <LiveStream id={id} label="accel (g)" range={2} pick={(s) => [s.accelRaw.x, s.accelRaw.y, s.accelRaw.z]} />
        <div style={{ height: 8 }} />
        <LiveStream id={id} label="gyro (°/s)" range={500} pick={(s) => [s.gyroRaw.x, s.gyroRaw.y, s.gyroRaw.z]} />
      </Card>
    </div>
  );
}

type Row = { t: number; kind: 'gesture' | 'action' | 'log' | 'warn' | 'error'; id: ControllerId | null; msg: string };
type Filter = 'all' | 'gesture' | 'action' | 'log';

function EventsConsole() {
  const [rows, setRows] = useState<Row[]>(() =>
    controllerManager.log.slice(-100).map((e) => ({ t: e.t, kind: e.level === 'info' ? 'log' : e.level, id: e.controllerId, msg: e.message })),
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const pending = useRef<Row[]>([]);

  useEffect(() => {
    const push = (r: Row) => {
      if (pausedRef.current) return;
      pending.current.push(r);
    };
    const offG = motionEngine.on('gesture', (g: GestureEvent) => {
      if (g.phase === 'peak' && (g.gesture === 'tilt' || g.gesture === 'rotate')) return; // continuous, too noisy
      push({ t: Date.now(), kind: 'gesture', id: g.controllerId, msg: `${g.gesture} ${g.phase}${g.direction ? ` ${g.direction}` : ''} i=${g.intensity.toFixed(2)} peak=${g.peak.toFixed(0)}` });
    });
    const offA = actionBus.onAny((a: ActionEvent) => {
      if (a.phase === 'update') return;
      push({ t: Date.now(), kind: 'action', id: a.controllerId, msg: `${a.action} ${a.phase} v=${a.value.toFixed(2)} ${a.role ?? ''} [${a.source}]${a.meta?.zone ? ` zone=${a.meta.zone}` : ''}` });
    });
    const offL = controllerManager.onLog((e: LogEntry) => push({ t: e.t, kind: e.level === 'info' ? 'log' : e.level, id: e.controllerId, msg: e.message }));
    const timer = window.setInterval(() => {
      if (!pending.current.length) return;
      const add = pending.current;
      pending.current = [];
      setRows((r) => [...r, ...add].slice(-200));
    }, 120);
    return () => {
      offG();
      offA();
      offL();
      clearInterval(timer);
    };
  }, []);

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el && !paused) el.scrollTop = el.scrollHeight;
  }, [rows, paused]);

  const visible = rows.filter((r) => filter === 'all' || (filter === 'log' ? r.kind === 'log' || r.kind === 'warn' || r.kind === 'error' : r.kind === filter));
  const fmt = (t: number) => {
    const d = new Date(t);
    return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0').slice(0, 2)}`;
  };

  return (
    <Card
      title="Events"
      right={
        <div className="row" style={{ gap: 8 }}>
          <div className="chips">
            {(['all', 'gesture', 'action', 'log'] as Filter[]).map((k) => (
              <button key={k} className={`chip ${filter === k ? 'chip--on' : ''}`} onClick={() => setFilter(k)}>
                {k}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRows([])}>
            Clear
          </Button>
        </div>
      }
    >
      <div className="console" ref={box}>
        {visible.length === 0 && <div className="faint">No events yet. Connect a controller or use the simulator.</div>}
        {visible.map((r, i) => (
          <div key={i} className="console__line">
            <span className="console__t">{fmt(r.t)}</span>
            <span className="console__id">{r.id ? `C${r.id}` : '—'}</span>
            <span className={`console__kind console__kind--${r.kind}`}>{r.kind}</span>
            <span className="console__msg" title={r.msg}>
              {r.msg}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MotionConfigPanel() {
  const [cfg, setCfg] = useState<MotionConfig>(motionEngine.getConfig());
  const sensitivity = useSettings((s) => s.sensitivity);
  const setSensitivity = useSettings((s) => s.setSensitivity);
  useEffect(() => {
    const t = window.setInterval(() => setCfg(motionEngine.getConfig()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card
      title="Motion engine config"
      right={
        <Segmented
          value={sensitivity}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ]}
          onChange={(v) => {
            setSensitivity(v);
            motionEngine.setSensitivity(v);
            setCfg(motionEngine.getConfig());
          }}
          ariaLabel="Sensitivity"
        />
      }
    >
      <div className="config-grid">
        {Object.entries(cfg).map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <span>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function DeveloperPage() {
  const slots = useControllerSlots();
  const ids = useMemo(() => ([1, 2] as ControllerId[]).filter((id) => slots[id].transportState === 'connected'), [slots]);
  return (
    <div className="page diag">
      <BackLink to="/settings" label="Settings" />
      <div className="page-head" style={{ marginTop: 14 }}>
        <div>
          <div className="eyebrow">Developer mode</div>
          <h1>Diagnostics</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => (window.location.href = '/settings/factory')}>
            Factory test
          </Button>
        </div>
      </div>

      <Card title="3D mirror">
        <Boundary fallback={<div className="empty">3D preview unavailable.</div>}>
          <Suspense
            fallback={
              <div style={{ height: 260, display: 'grid', placeItems: 'center' }}>
                <Spinner />
              </div>
            }
          >
            <ControllerScene ids={ids.length ? ids : [1, 2]} height={260} />
          </Suspense>
        </Boundary>
      </Card>

      <div className="diag__cols">
        <ControllerColumn id={1} />
        <ControllerColumn id={2} />
      </div>

      <EventsConsole />
      <MotionConfigPanel />
    </div>
  );
}
