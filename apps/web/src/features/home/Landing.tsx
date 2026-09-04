/**
 * AiroMote product website — the marketing + entry experience at "/".
 *
 * It sits in front of the working app (setup, connection, calibration, activities) and links
 * into it; it never reimplements that logic. The real prototype photograph is the hero visual.
 * Structure follows the product narrative: hero → what do you want to do → how it works →
 * one vs two → experiences (real) → why AiroMote → platform → possibilities → builders →
 * story → pilot.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ControllerId } from '@aero/motion-core';
import type { ActivityDefinition } from '@aero/activity-engine';
import { availableActivities, categoryMeta } from '@/activities';
import { useControllerSlots } from '@/store/controllers';
import './landing.css';

const HERO_IMG = '/product/airomote-hero.jpg';

/* Reveal-on-scroll: adds .in when a section enters the viewport (respects reduced motion). */
function useReveal() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (reduce) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Dots({ n }: { n: 1 | 2 }) {
  return (
    <span className="dots" aria-label={`${n} AiroMote${n > 1 ? 's' : ''}`}>
      <i /> {n === 2 && <i />}
    </span>
  );
}

function useConnectedCount(): number {
  const slots = useControllerSlots();
  return ([1, 2] as ControllerId[]).filter((id) => slots[id].transportState === 'connected').length;
}

function TopNav() {
  const connected = useConnectedCount();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const links = (
    <>
      <a href="#experiences" onClick={() => setOpen(false)}>Experiences</a>
      <a href="#how" onClick={() => setOpen(false)}>How It Works</a>
      <Link to="/setup" onClick={() => setOpen(false)}>Setup</Link>
      <a href="#builders" onClick={() => setOpen(false)}>Developers</a>
      <a href="#story" onClick={() => setOpen(false)}>Story</a>
    </>
  );
  return (
    <header className={`lnav ${scrolled ? 'lnav--solid' : ''}`}>
      <div className="lnav__in">
        <Link to="/" className="lnav__brand" aria-label="AiroMote home">
          <span className="lnav__mark" />
          AiroMote
        </Link>
        <nav className="lnav__links" aria-label="Main">{links}</nav>
        <div className="lnav__right">
          {connected > 0 && (
            <Link to="/settings" className="lnav__conn" title="Manage controllers">
              {connected === 2 ? <Dots n={2} /> : <Dots n={1} />}
              <span>{connected === 2 ? '2 connected' : 'Connected'}</span>
            </Link>
          )}
          <Link to="/setup" className="btn-brand btn-brand--sm lnav__cta">Join Pilot</Link>
          <button className="lnav__burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span /><span /><span />
          </button>
        </div>
      </div>
      {open && <nav className="lnav__drawer" aria-label="Mobile">{links}<Link to="/setup" className="btn-brand" onClick={() => setOpen(false)}>Join Pilot</Link></nav>}
    </header>
  );
}

function Hero() {
  const connected = useConnectedCount();
  return (
    <section className="hero">
      <div className="hero__copy" data-reveal>
        <span className="eyebrow">One controller. Endless motion.</span>
        <h1 className="hero__title">
          <span>Move.</span>
          <span>Play.</span>
          <span>Create.</span>
        </h1>
        <p className="hero__sub">
          A universal motion controller for games, music and workouts. Move it. Swing it. Punch
          with it. Strum with it. AiroMote turns motion into input.
        </p>
        <div className="hero__cta">
          <Link to="/setup" className="btn-brand btn-brand--lg">
            {connected > 0 ? 'Open AiroMote' : 'Connect AiroMote'}
          </Link>
          <a href="#experiences" className="btn-line btn-brand--lg">See what it can do →</a>
        </div>
        <p className="hero__proof">Built on ESP32. Motion-powered. Made to move.</p>
        <a href="#story" className="hero__story">Built by Laksh, age 8 →</a>
      </div>
      <div className="hero__media" data-reveal>
        <div className="hero__photo">
          <img src={HERO_IMG} alt="Laksh holding the green AiroMote motion controller" fetchPriority="high" />
          <span className="hero__scale">Actual size — fits in your hand</span>
        </div>
      </div>
    </section>
  );
}

const DO = [
  { key: 'PLAY', title: 'Play', blurb: 'Games and motion experiences', to: '/games', accent: 'var(--games)' },
  { key: 'MUSIC', title: 'Make music', blurb: 'Guitar, drums and motion instruments', to: '/music', accent: 'var(--music)' },
  { key: 'WORK', title: 'Work out', blurb: 'Track movement and reps', to: '/workout', accent: 'var(--workout)' },
];

function WhatDoYouWant() {
  return (
    <section className="band" id="do">
      <div className="wrap">
        <h2 className="section-h" data-reveal>What do you want to do?</h2>
        <div className="do-grid">
          {DO.map((d, i) => (
            <Link key={d.key} to={d.to} className="do-card" data-reveal style={{ '--c': d.accent, transitionDelay: `${i * 70}ms` } as React.CSSProperties}>
              <span className="do-card__k">{d.key}</span>
              <span className="do-card__t">{d.title}</span>
              <span className="do-card__b">{d.blurb}</span>
              <span className="do-card__go">Start →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: '1', t: 'Connect', b: 'Pair AiroMote in one tap.' },
  { n: '2', t: 'Calibrate', b: 'Hold still for two seconds.' },
  { n: '3', t: 'Choose 1 or 2', b: 'One hand or two.' },
  { n: '4', t: 'Play', b: 'Your movement is the controller.' },
];

function HowItWorks() {
  return (
    <section className="band band--alt" id="how">
      <div className="wrap">
        <h2 className="section-h" data-reveal>From motion to action in seconds.</h2>
        <p className="section-sub" data-reveal>Connect. Calibrate. Choose an experience. Move.</p>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s.n} className="step" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
              <span className="step__n">{s.n}</span>
              <div className="step__t">{s.t}</div>
              <div className="step__b">{s.b}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OneVsTwo() {
  return (
    <section className="band" id="onetwo">
      <div className="wrap">
        <h2 className="section-h" data-reveal>One AiroMote or two?</h2>
        <div className="ot-grid">
          <div className="ot-card" data-reveal>
            <Dots n={1} />
            <h3>One AiroMote</h3>
            <p className="ot-lead">Fastest way to start.</p>
            <ul>
              <li>Steering</li><li>Swinging</li><li>Guitar</li><li>Workouts</li><li>Movement games</li>
            </ul>
            <Link to="/setup" className="btn-line">Use 1 AiroMote</Link>
          </div>
          <div className="ot-card ot-card--two" data-reveal style={{ transitionDelay: '80ms' }}>
            <Dots n={2} />
            <h3>Two AiroMotes</h3>
            <p className="ot-lead">Unlock two-hand and full-body control.</p>
            <ul>
              <li>Boxing</li><li>Drums</li><li>Dual-hand instruments</li><li>Advanced motion games</li>
            </ul>
            <Link to="/setup" className="btn-brand">Use 2 AiroMotes</Link>
          </div>
        </div>
        <p className="ot-foot" data-reveal>One AiroMote opens motion. Two unlock another dimension of input.</p>
      </div>
    </section>
  );
}

function movementLine(def: ActivityDefinition): string {
  switch (def.id) {
    case 'motion-kart': return 'Tilt to steer, lean to accelerate, shake to boost.';
    case 'guitar': return 'Tilt to shape a chord, swing the other hand to strum.';
    case 'drums': return 'Aim with a tilt, strike down to hit. Two sticks, full kit.';
    case 'squats': return 'Hold it to your chest — full-depth reps only.';
    case 'pushups': return 'Strap it to your arm — real range, real count.';
    default: return def.tagline;
  }
}

function ExperienceLibrary() {
  const cats: Array<'games' | 'music' | 'workout'> = ['games', 'music', 'workout'];
  const catWord = { games: 'Game', music: 'Music', workout: 'Workout' } as const;
  const items = availableActivities.filter((d) => d.status === 'available');
  return (
    <section className="band band--alt" id="experiences">
      <div className="wrap">
        <span className="eyebrow eyebrow--brand" data-reveal>Available now</span>
        <h2 className="section-h" data-reveal>Choose an experience.</h2>
        <div className="exp-grid">
          {cats.flatMap((cat) =>
            items
              .filter((d) => d.category === cat)
              .map((d, i) => {
                const two = d.controllers.max >= 2;
                return (
                  <div key={d.id} className="exp-card" data-reveal style={{ '--c': categoryMeta[cat].accent, transitionDelay: `${i * 50}ms` } as React.CSSProperties}>
                    <div className="exp-card__top">
                      <span className="exp-card__cat">{catWord[cat]}</span>
                      <span className="exp-card__ctrl" title={two ? '1 or 2 AiroMotes' : '1 AiroMote'}>
                        <Dots n={two ? 2 : 1} />
                        {two ? '1–2' : '1'}
                      </span>
                    </div>
                    <div className="exp-card__name">{d.name}</div>
                    <div className="exp-card__move">{movementLine(d)}</div>
                    <Link to={`${categoryMeta[cat].path}/${d.id}`} className="btn-brand btn-brand--sm exp-card__start">Start</Link>
                  </div>
                );
              }),
          )}
        </div>
      </div>
    </section>
  );
}

const COMPARE = [
  {
    k: 'Game controllers',
    strength: 'Precise buttons, sticks and triggers for traditional play.',
    limit: 'Usually built around gaming and a fixed set of controls.',
    diff: 'Motion itself becomes input — the same device moves between games, music and workouts.',
  },
  {
    k: 'Keyboard + mouse',
    strength: 'Excellent for precise desktop input.',
    limit: 'Interaction is keys, buttons and a pointer.',
    diff: 'Swing, tilt, rotate, punch, move — the command becomes embodied, not button-based.',
  },
  {
    k: 'Computer vision',
    strength: 'Tracks the body without a handheld device.',
    limit: 'Needs camera position, light, line of sight and compute.',
    diff: 'The sensor travels with you and reads motion without a camera seeing you.',
  },
  {
    k: 'Locked motion devices',
    strength: 'Great motion inside their own ecosystem.',
    limit: 'Tied to one console, app or use case.',
    diff: 'One small controller made to support many software experiences. Hardware stays; the experience changes.',
  },
];

function WhyAiroMote() {
  return (
    <section className="band" id="why">
      <div className="wrap">
        <h2 className="section-h section-h--tight" data-reveal>One controller.<br />Not one use.</h2>
        <p className="section-sub" data-reveal>
          Most input devices are designed around a specific device, activity or interface.
          AiroMote is designed around movement itself.
        </p>
        <div className="cmp-grid">
          {COMPARE.map((c, i) => (
            <div key={c.k} className="cmp-card" data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
              <div className="cmp-card__k">{c.k}</div>
              <div className="cmp-row"><span>Strength</span><p>{c.strength}</p></div>
              <div className="cmp-row"><span>Limit</span><p>{c.limit}</p></div>
              <div className="cmp-row cmp-row--diff"><span>AiroMote</span><p>{c.diff}</p></div>
            </div>
          ))}
        </div>
        <div className="contrast" data-reveal>
          <p>Traditional controllers map <em>buttons</em>.</p>
          <p className="contrast--brand">AiroMote maps <em>movement</em>.</p>
          <span className="contrast__foot">Buttons are one kind of input. Movement is another.</span>
        </div>
      </div>
    </section>
  );
}

const ORBIT = ['Game', 'Music', 'Fitness', 'Sport', 'Accessibility', 'Robotics', 'Education', 'Creative', 'Custom'];

function Platform() {
  return (
    <section className="band band--alt" id="platform">
      <div className="wrap">
        <h2 className="section-h" data-reveal>One small piece of hardware.<br />Many software experiences.</h2>
        <p className="section-sub" data-reveal>The controller stays the same. What it can become keeps growing.</p>
        <div className="orbit" data-reveal aria-hidden>
          <div className="orbit__ring orbit__ring--a" />
          <div className="orbit__ring orbit__ring--b" />
          <div className="orbit__core">AiroMote</div>
          {ORBIT.map((label, i) => {
            const a = (i / ORBIT.length) * Math.PI * 2;
            const rx = 46, ry = 40;
            const x = 50 + Math.cos(a) * rx;
            const y = 50 + Math.sin(a) * ry;
            return (
              <span key={label} className="orbit__node" style={{ left: `${x}%`, top: `${y}%` }}>{label}</span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const POSSIBLE: Array<{ k: string; items: string[] }> = [
  { k: 'Sport', items: ['Cricket batting', 'Golf swing', 'Tennis', 'Racquet sports'] },
  { k: 'Creative', items: ['Air instruments', 'Gesture-controlled sound', 'Live performance'] },
  { k: 'Accessibility', items: ['Alternative control', 'Adapted interfaces', 'Custom mappings'] },
  { k: 'Robotics', items: ['Robot control', 'Teleoperation', 'Physical interfaces'] },
  { k: 'Education', items: ['Motion-based learning', 'Interactive experiments', 'STEM activities'] },
  { k: 'Tools', items: ['Presentation control', 'Spatial shortcuts', 'Custom computer input'] },
];

function Possibilities() {
  return (
    <section className="band" id="possible">
      <div className="wrap">
        <h2 className="section-h section-h--tight" data-reveal>If you can move it,<br />you can build with it.</h2>
        <p className="section-sub" data-reveal>
          AiroMote is not locked to a single game or activity. Motion can be mapped to entirely
          different digital experiences.
        </p>
        <div className="poss-tag" data-reveal>Possible with AiroMote — buildable directions, not shipped features</div>
        <div className="poss-grid">
          {POSSIBLE.map((p, i) => (
            <div key={p.k} className="poss-card" data-reveal style={{ transitionDelay: `${i * 50}ms` }}>
              <div className="poss-card__k">{p.k}</div>
              <ul>{p.items.map((it) => <li key={it}>{it}</li>)}</ul>
            </div>
          ))}
        </div>
        <div className="sdh" data-reveal>
          <h3>Hardware once. New experiences through software.</h3>
          <p>The controller stays the same. New mappings and experiences keep expanding what it does.</p>
        </div>
      </div>
    </section>
  );
}

function Builders() {
  return (
    <section className="band band--alt" id="builders">
      <div className="wrap builders">
        <div data-reveal>
          <h2 className="section-h section-h--left">Don't wait for us to invent the next use.</h2>
          <p className="section-sub section-sub--left">
            Map AiroMote movement to your own games, instruments, tools and experiments. The
            motion stream is open; the mappings are yours.
          </p>
          <div className="builders__cta">
            <Link to="/settings/developer" className="btn-line">Open Developer mode →</Link>
            <span className="tag-soon">SDK access coming soon</span>
          </div>
        </div>
        <div className="builders__spec" data-reveal>
          <div className="spec-row"><span>Motion</span><b>6-axis IMU, 100 Hz</b></div>
          <div className="spec-row"><span>Link</span><b>Bluetooth LE</b></div>
          <div className="spec-row"><span>Brain</span><b>ESP32-C6</b></div>
          <div className="spec-row"><span>Inputs</span><b>Tilt · rotate · swing · punch</b></div>
          <div className="spec-row"><span>Modes</span><b>1 or 2 controllers</b></div>
        </div>
      </div>
    </section>
  );
}

function Story() {
  return (
    <section className="band" id="story">
      <div className="wrap story">
        <div className="story__media" data-reveal>
          <img src={HERO_IMG} alt="The AiroMote prototype held in hand" loading="lazy" />
        </div>
        <div className="story__copy" data-reveal>
          <span className="eyebrow eyebrow--brand">The story</span>
          <h2 className="section-h section-h--left">Built by Laksh, age 8.</h2>
          <p>
            AiroMote is a real, working prototype — 3D-printed shell, an ESP32 brain and a motion
            sensor inside. It started as one question: what if your movement could be the
            controller? Today it plays games, instruments and workouts from the same small device.
          </p>
          <p className="story__note">This is a prototype under active development. What works today is real; what's possible is where it's going.</p>
        </div>
      </div>
    </section>
  );
}

function Pilot() {
  return (
    <section className="band band--pilot" id="pilot">
      <div className="wrap pilot">
        <h2 data-reveal>Your movement is the controller.</h2>
        <p data-reveal>Connect an AiroMote and start moving, or join the pilot to follow along.</p>
        <div className="pilot__cta" data-reveal>
          <Link to="/setup" className="btn-brand btn-brand--lg">Connect AiroMote</Link>
          <a href="mailto:venky24aug@gmail.com?subject=AiroMote%20Pilot" className="btn-line btn-brand--lg">Join the pilot →</a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lfoot">
      <div className="wrap lfoot__in">
        <div className="lfoot__brand"><span className="lnav__mark" /> AiroMote</div>
        <nav className="lfoot__links">
          <a href="#experiences">Experiences</a>
          <a href="#how">How it works</a>
          <Link to="/setup">Setup</Link>
          <a href="#builders">Developers</a>
          <a href="#story">Story</a>
        </nav>
        <div className="lfoot__note">Motion-powered · Made to move</div>
      </div>
    </footer>
  );
}

export default function Landing() {
  useReveal();
  const scrollerRef = useRef<HTMLDivElement>(null);
  return (
    <div className="landing" ref={scrollerRef}>
      <TopNav />
      <Hero />
      <WhatDoYouWant />
      <HowItWorks />
      <OneVsTwo />
      <ExperienceLibrary />
      <WhyAiroMote />
      <Platform />
      <Possibilities />
      <Builders />
      <Story />
      <Pilot />
      <Footer />
    </div>
  );
}
