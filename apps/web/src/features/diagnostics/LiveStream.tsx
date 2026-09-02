import { useEffect, useRef } from 'react';
import type { ControllerId, ControllerMotionState } from '@aero/motion-core';
import { motionEngine } from '@/core/runtime';

const COLORS = ['#ff7a7a', '#7ad67a', '#7ab8ff'];

/**
 * Canvas oscilloscope for one vector signal of one controller. Subscribes to the motion
 * engine directly (no React state), keeps a 4 s ring buffer, redraws on rAF.
 */
export function LiveStream({
  id,
  pick,
  range,
  label,
  seconds = 4,
}: {
  id: ControllerId;
  pick: (s: ControllerMotionState) => [number, number, number];
  /** ± full-scale value. */
  range: number;
  label: string;
  seconds?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    const buf: Array<{ t: number; v: [number, number, number] }> = [];
    const off = motionEngine.on('state', (s) => {
      if (s.controllerId !== id) return;
      buf.push({ t: s.hostTime, v: pickRef.current(s) });
      const cutoff = s.hostTime - seconds * 1000;
      while (buf.length && buf[0].t < cutoff) buf.shift();
    });
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      for (let i = 1; i < 4; i++) {
        ctx.moveTo((w * i) / 4, 0);
        ctx.lineTo((w * i) / 4, h);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`+${range}`, 4, 10);
      ctx.fillText(`-${range}`, 4, h - 3);
      ctx.fillText(label, w - ctx.measureText(label).width - 6, 10);
      if (buf.length < 2) return;
      const tEnd = performance.now();
      const tStart = tEnd - seconds * 1000;
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = COLORS[k];
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let i = 0; i < buf.length; i++) {
          const x = ((buf[i].t - tStart) / (seconds * 1000)) * w;
          const y = h / 2 - (Math.max(-range, Math.min(range, buf[i].v[k])) / range) * (h / 2 - 2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [id, range, label, seconds]);

  return <canvas ref={canvas} className="scope" aria-label={`${label} oscilloscope`} />;
}
