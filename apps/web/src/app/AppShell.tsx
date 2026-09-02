import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon, StatusDot } from '@/ui';
import { useControllerSlots } from '@/store/controllers';
import { useSettings } from '@/store/settings';
import type { ControllerId } from '@aero/motion-core';
import './shell.css';

function ControllerPill({ id }: { id: ControllerId }) {
  const slot = useControllerSlots()[id];
  const name = useSettings((s) => s.controllerNames[id]);
  const connected = slot.transportState === 'connected';
  const busy = slot.transportState === 'connecting' || slot.transportState === 'reconnecting' || slot.calibration === 'hold-still' || slot.calibration === 'calibrating';
  const state = slot.transportState === 'error' ? 'error' : busy ? 'busy' : connected ? 'on' : 'off';
  const label = !connected
    ? slot.transportState === 'connecting'
      ? 'Connecting'
      : slot.transportState === 'reconnecting'
        ? 'Reconnecting'
        : 'Not connected'
    : slot.calibration === 'hold-still'
      ? 'Hold still'
      : slot.calibration === 'calibrating'
        ? 'Calibrating'
        : 'Connected';
  return (
    <NavLink to="/settings" className={`pill ${connected ? 'pill--on' : ''}`} title={`${name}: ${label}`}>
      <StatusDot state={state} />
      <span className="pill__name">{name}</span>
      <span className="pill__state">{label}</span>
      {connected && slot.battery != null && <span className="battery">{slot.battery}%</span>}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const inSettings = pathname.startsWith('/settings');
  return (
    <div className="shell">
      <header className="shell__nav">
        <NavLink to="/" className="shell__logo" aria-label="AiroMote home">
          <span className="shell__logo-mark" />
          <span>AiroMote</span>
        </NavLink>
        <nav className="shell__links" aria-label="Main">
          <NavLink to="/games" className={({ isActive }) => `shell__link ${isActive ? 'shell__link--on' : ''}`}>
            <Icon.Games size={18} /> Games
          </NavLink>
          <NavLink to="/music" className={({ isActive }) => `shell__link ${isActive ? 'shell__link--on' : ''}`}>
            <Icon.Music size={18} /> Music
          </NavLink>
          <NavLink to="/workout" className={({ isActive }) => `shell__link ${isActive ? 'shell__link--on' : ''}`}>
            <Icon.Workout size={18} /> Workout
          </NavLink>
        </nav>
        <div className="shell__status">
          <ControllerPill id={1} />
          <ControllerPill id={2} />
          <NavLink to="/settings" className={`shell__settings ${inSettings ? 'shell__settings--on' : ''}`} aria-label="Settings">
            <Icon.Settings size={20} />
          </NavLink>
        </div>
      </header>
      <main className="screen screen--scroll">{children}</main>
    </div>
  );
}
