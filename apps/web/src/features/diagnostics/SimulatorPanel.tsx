import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from 'react';
import type { ControllerId } from '@aero/motion-core';
import { FACTORY_TESTS, type FactoryTestName } from '@aero/protocol';
import { Button, Toggle } from '@/ui';
import { controllerManager } from '@/core/runtime';
import type { SimulatorTransport } from '@/core/transport/simulator';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Developer-mode controls for one simulated controller. Everything here drives the
 * SimulatedController *model*; the resulting packets flow through the normal pipeline.
 */
export function SimulatorPanel({ id, transport }: { id: ControllerId; transport: SimulatorTransport }) {
  const model = transport.model;
  const [, tick] = useState(0);
  const rerender = () => tick((n) => n + 1);
  const [hold, setHold] = useState(false);
  const [pitch, setPitch] = useState(model.targetPitch);
  const [roll, setRoll] = useState(model.targetRoll);
  const [yawRate, setYawRate] = useState(model.targetYawRate);
  const [dropPct, setDropPct] = useState(Math.round(transport.dropRate * 100));
  const [battery, setBattery] = useState<number>(model.battery ?? -1);
  const [noise, setNoise] = useState(Math.round(model.noiseAccel * 1000));
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applyPose = (p: number, r: number) => {
    const cp = clamp(p, -90, 90);
    const cr = clamp(r, -90, 90);
    model.targetPitch = cp;
    model.targetRoll = cr;
    setPitch(cp);
    setRoll(cr);
  };

  const applyYaw = (y: number) => {
    const cy = clamp(y, -300, 300);
    model.targetYawRate = cy;
    setYawRate(cy);
  };

  useEffect(() => {
    // keep sliders in sync if something else (scripts) moved the model
    const t = window.setInterval(() => {
      if (!dragging.current) {
        setPitch(model.targetPitch);
        setRoll(model.targetRoll);
      }
    }, 500);
    return () => clearInterval(t);
  }, [model]);

  const padFromEvent = (e: RPointerEvent<HTMLDivElement>) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1) * 2 - 1; // -1 left .. 1 right
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1) * 2 - 1; // -1 top .. 1 bottom
    // up on the pad = nose up (+pitch); right = roll right (+roll)
    applyPose(-ny * 90, nx * 90);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    padRef.current?.setPointerCapture(e.pointerId);
    padRef.current?.focus();
    padFromEvent(e);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (dragging.current) padFromEvent(e);
  };
  const onPointerUp = () => {
    dragging.current = false;
    if (!hold) applyPose(0, 0);
  };

  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 15 : 5;
    switch (e.code) {
      case 'ArrowUp':
        applyPose(pitch + step, roll);
        break;
      case 'ArrowDown':
        applyPose(pitch - step, roll);
        break;
      case 'ArrowLeft':
        applyPose(pitch, roll - step);
        break;
      case 'ArrowRight':
        applyPose(pitch, roll + step);
        break;
      case 'Space':
        model.strike(0.8);
        break;
      case 'KeyQ':
        applyYaw(yawRate + 60);
        break;
      case 'KeyE':
        applyYaw(yawRate - 60);
        break;
      case 'Digit0':
        applyPose(0, 0);
        applyYaw(0);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const knobX = ((roll + 90) / 180) * 100;
  const knobY = ((-pitch + 90) / 180) * 100;

  return (
    <div className="diag-card">
      <div className="diag-card__head">
        <span className="diag-card__title">Simulator · Controller {id}</span>
        <div className="row" style={{ gap: 8, fontSize: 13 }}>
          <span className="dim">Hold pose</span>
          <Toggle checked={hold} onChange={setHold} label="Hold pose on release" />
        </div>
      </div>
      <div className="sim-grid">
        <div>
          <div
            ref={padRef}
            className="sim-pad"
            tabIndex={0}
            role="application"
            aria-label="Pose pad: drag to tilt, arrow keys tilt, Space strikes"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKey}
          >
            <span className="sim-pad__label" style={{ top: 6, left: '50%', transform: 'translateX(-50%)' }}>
              nose up
            </span>
            <span className="sim-pad__label" style={{ bottom: 6, left: '50%', transform: 'translateX(-50%)' }}>
              nose down
            </span>
            <span className="sim-pad__label" style={{ left: 6, top: '50%', transform: 'translateY(-50%)' }}>
              L
            </span>
            <span className="sim-pad__label" style={{ right: 6, top: '50%', transform: 'translateY(-50%)' }}>
              R
            </span>
            <div className="sim-pad__knob" style={{ left: `${knobX}%`, top: `${knobY}%` }} />
          </div>
          <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>
            Drag to tilt. With the pad focused: arrows tilt, Q/E turn, Space strikes, 0 resets.
          </p>
        </div>
        <div>
          <div className="sim-row">
            <span>Pitch</span>
            <input className="slider" type="range" min={-90} max={90} value={Math.round(pitch)} onChange={(e) => applyPose(Number(e.target.value), roll)} />
            <span className="sim-row__v">{pitch.toFixed(0)}°</span>
          </div>
          <div className="sim-row">
            <span>Roll</span>
            <input className="slider" type="range" min={-90} max={90} value={Math.round(roll)} onChange={(e) => applyPose(pitch, Number(e.target.value))} />
            <span className="sim-row__v">{roll.toFixed(0)}°</span>
          </div>
          <div className="sim-row">
            <span>Yaw rate</span>
            <input className="slider" type="range" min={-300} max={300} value={Math.round(yawRate)} onChange={(e) => applyYaw(Number(e.target.value))} />
            <span className="sim-row__v">{yawRate.toFixed(0)}</span>
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <Button size="sm" variant="ghost" onClick={() => { applyPose(0, 0); applyYaw(0); }}>
              Reset pose
            </Button>
          </div>

          <div className="sim-group">
            <div className="sim-group__label">Strike</div>
            <div className="btn-wrap">
              <Button size="sm" onClick={() => model.strike(0.3)}>Soft</Button>
              <Button size="sm" onClick={() => model.strike(0.65)}>Medium</Button>
              <Button size="sm" onClick={() => model.strike(1)}>Hard</Button>
              <Button size="sm" variant="ghost" onClick={() => model.shake(0.8)}>Shake</Button>
            </div>
          </div>
          <div className="sim-group">
            <div className="sim-group__label">Swing</div>
            <div className="btn-wrap">
              {(['up', 'down', 'left', 'right', 'forward', 'back'] as const).map((d) => (
                <Button key={d} size="sm" onClick={() => model.swing(d, 0.75)}>
                  {d}
                </Button>
              ))}
            </div>
          </div>
          <div className="sim-group">
            <div className="sim-group__label">Device</div>
            <div className="btn-wrap">
              <Button size="sm" onClick={() => model.beginCalibration()}>Recalibrate</Button>
              <Button size="sm" onClick={() => transport.simulateDropout(1500)}>Dropout 1.5 s</Button>
              <Button size="sm" variant="ghost" onClick={() => void controllerManager.disconnect(id)}>Disconnect</Button>
            </div>
          </div>
          <div className="sim-row" style={{ marginTop: 12 }}>
            <span>Loss</span>
            <input
              className="slider"
              type="range"
              min={0}
              max={50}
              value={dropPct}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDropPct(v);
                transport.dropRate = v / 100;
              }}
            />
            <span className="sim-row__v">{dropPct}%</span>
          </div>
          <div className="sim-row">
            <span>Battery</span>
            <input
              className="slider"
              type="range"
              min={-1}
              max={100}
              value={battery}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBattery(v);
                model.battery = v < 0 ? null : v;
              }}
            />
            <span className="sim-row__v">{battery < 0 ? 'n/a' : `${battery}%`}</span>
          </div>
          <div className="sim-row">
            <span>Noise</span>
            <input
              className="slider"
              type="range"
              min={0}
              max={80}
              value={noise}
              onChange={(e) => {
                const v = Number(e.target.value);
                setNoise(v);
                model.noiseAccel = v / 1000;
                model.noiseGyro = v / 12;
              }}
            />
            <span className="sim-row__v">{(noise / 1000).toFixed(3)}g</span>
          </div>
          <div className="row" style={{ gap: 10, fontSize: 13, marginTop: 4 }}>
            <span className="dim">Hand tremor</span>
            <Toggle
              checked={model.handTremor}
              onChange={(v) => {
                model.handTremor = v;
                rerender();
              }}
              label="Hand tremor"
            />
          </div>
          <div className="row" style={{ gap: 10, fontSize: 13, marginTop: 10 }}>
            <span className="dim">Fail factory test</span>
            <select
              className="select"
              value={model.failFactoryTest ?? ''}
              onChange={(e) => {
                model.failFactoryTest = (e.target.value || null) as FactoryTestName | null;
                rerender();
              }}
            >
              <option value="">none</option>
              {FACTORY_TESTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
