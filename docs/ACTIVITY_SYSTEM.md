# Activity System (`packages/activity-engine` + `apps/web/src/activities`)

## Universal actions

`ActionEvent { action, phase: start|update|end|trigger, value, intensity, controllerId, role, source, timestamp, confidence, meta }`

Held/continuous actions (`TILT_LEFT`, `ACCELERATE`, `CONTINUOUS_X` …) emit `start` → `update`* →
`end`. Triggers (`STRIKE`, `STRUM_DOWN`, `BOOST`, `SHAKE` …) emit a single `trigger` with intensity.
`SELECT_ZONE` emits an `update` when the zone changes with `meta.zone`. Full list: `ACTION_TYPES`.

Sources: `motion` (via mapper), `simulator` (identical to motion — the simulator is a transport),
`keyboard`, `gamepad`, `ui`. Activities do not care which.

## Mapping rules → presets

A preset is a list of rules, each bound to a **role**:

| kind | From | To |
|---|---|---|
| `tiltAxis` | relative roll/pitch/yaw with deadzone, max angle, curve, invert | continuous −1..1 |
| `rateAxis` | angular rate (pitchRate/rollRate/yawRate) | continuous −1..1 |
| `accelAxis` | linear acceleration axis (g) | continuous −1..1 |
| `magnitude` | motion magnitude | 0..1 |
| `tiltZone` | TiltDetector direction | held action |
| `rotateZone` | RotateDetector direction | held action |
| `gesture` | strike/swing(direction)/shake/rotate/tilt peak, cooldown, min intensity | trigger |
| `zone` | ordered orientation zones with hysteresis | `SELECT_ZONE` update + `meta.zone` |

Sensitivity scales inputs (Low 0.7 / Normal 1 / High 1.4). Users pick presets by name in the
activity intro; JSON is never shown.

Examples in the codebase: `activities/motion-kart/definition.ts` (Motion Steering, Dual
Controller, Gesture Steering, Keyboard), `drums/definition.ts` (7 aim zones + strike + kick),
`guitar/definition.ts` (6 chord zones + strums + mute).

## Activity definition

```ts
{
  id, name, category: 'games'|'music'|'workout', tagline, description, status: 'available'|'coming-soon', accent,
  controllers: { min, max },
  roles: [{ id, label, description, required }],
  defaultRoleAssignment: { role: 1|2 },
  setupSteps: [{ title, body, illustration? }],
  presets: MappingPreset[], defaultPresetId,
  actions: ActionType[],           // what it consumes (docs + diagnostics filter)
  keyboardFallback?: { KeyCode: Action | { action, role, meta } },
  motionOverrides?: Partial<MotionConfig>,   // e.g. slower yaw decay for drums
}
```

`ActivityRegistry.register` validates presets/roles; `resolveRoles(def, preferred, connected)`
assigns required roles first, then optional ones, so a single connected controller always gets
the role that makes the activity playable.

## Runtime (web)

`useActivitySession(def)` builds an `ActivitySession`: `MotionEngine` → `ActionMapper` (persisted
preset/roles/sensitivity per activity) → `ActionBus` + `ActionState`; enables keyboard/gamepad
sources per settings; applies `motionOverrides`; releases held actions when a controller
disconnects. `ActivityChrome` + `useActivityFlow` provide the shared frame: intro (setup steps,
preset picker, controller gate) → running ⇄ paused → finished, with auto-pause when a required
controller drops and a re-centre action.

Activities read input either by subscribing (`useActions`) or by polling
`session.session.actions` (`ActionState.value/held/consume`) inside their render loop.

## Add a mapping

Add a rule to an existing preset or a new `MappingPreset` in the activity's definition. Example:
make a forward swing trigger a jump in Motion Kart:

```ts
{ kind: 'gesture', role: 'driver', gesture: 'swing', direction: 'forward', action: 'JUMP', cooldownMs: 800 }
```

Then handle `JUMP` in the activity. Nothing else changes.

## Add an activity

1. `definition.ts` as above (status `'available'`).
2. `<Name>.tsx` full-screen component: `const s = useActivitySession(def); const flow = useActivityFlow(def, s);` and render
   `<ActivityChrome def={def} session={s} flow={flow} intro={<PresetPicker def={def} session={s}/>}> <Canvas…/> </ActivityChrome>`.
3. Add to `availableActivities` and `activityComponents` in `activities/index.ts`.

Coming-soon entries are definitions with `status: 'coming-soon'` and no component
(`activities/coming-soon.ts`) — cards only, no wasted code.
