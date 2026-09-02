# Music Engine (`packages/music-engine`)

Low-latency Web Audio for the instruments. Pure TypeScript; the AudioContext factory is
injectable, so everything is unit-tested under vitest with a fake context.

## AudioEngine

- One `AudioContext({ latencyHint: 'interactive' })` per app, created/resumed by `unlock()`
  from the **Start** click (browser autoplay rules). `ensureRunning()` resumes silently if the
  context was suspended (tab switch).
- Graph: instrument voices → master gain → soft limiter (`DynamicsCompressor`, −6 dB knee) →
  destination. `setVolume` / `setMuted` follow Settings → Sound.
- `velocityToGain(v) = 0.15 + 0.85·v^1.6` — perceptual curve so soft hits stay audible and hard
  hits do not clip.
- `VoicePool` enforces polyphony per instrument and steals the oldest voice with a 12 ms fade,
  so fast rolls never glitch. Every hit creates fresh nodes; playing nodes are never mutated.

## DrumKit (synthesised — no samples, no licences, works offline)

| Drum | Synthesis |
|---|---|
| kick | sine pitch-drop 150 → 45 Hz + click transient |
| snare | 180 Hz triangle body + band-passed noise; velocity opens the filter |
| hihat | six square oscillators at metallic ratios through a 7 kHz high-pass, very short; `choke()` |
| tom1 / tom2 / floor | pitched sine/triangle with pitch drop at 220 / 160 / 110 Hz |
| crash | long filtered noise + shimmer, 1.5–2.5 s |
| ride | noise + 3 kHz ping |

`play(drum, velocity, when?)`: velocity drives gain, brightness and decay. Latency = one audio
quantum (~3 ms at 48 kHz) plus output latency.

## Guitar (Karplus-Strong)

- Standard tuning E2 A2 D3 G3 B3 E4; voicings `C x32010 · G 320003 · Am x02210 · F 133211 ·
  Em 022000 · D xx0232`.
- `renderPluck(freq, seconds, brightness)` renders each string once into an `AudioBuffer`
  (cached per MIDI note) so a strum is just six buffer sources — no per-note DSP at play time.
- `strum(chord, 'down' | 'up', velocity)`: strings staggered 12–22 ms apart (down = low → high,
  up = high → low; faster with higher velocity). Velocity → gain and brightness. `mute()`
  damps ringing strings in ~40 ms (the shake gesture).

## How the activities use it

- **Drums**: `SELECT_ZONE` (per stick role) chooses the target drum; `STRIKE` plays it with the
  gesture intensity as velocity; `PUNCH` (forward swing) plays the kick. Both sticks are
  independent; simultaneous hits both sound.
- **Guitar**: `SELECT_ZONE` on the fret role sets the chord; `STRUM_DOWN` / `STRUM_UP` on the
  strum role strum it with intensity as velocity; `MUTE` damps.

Tests (`music.test.ts`): velocity curve monotonic/bounded, voicings → exact frequencies, strum
order & stagger by direction/velocity, polyphony limit, pluck decays and has the right
fundamental.
