# Zarhart: build plan and handoff

Zarhart is a free, open-source, in-browser flight-training website for student pilots working toward the **FAA Private Pilot (PAR) knowledge test**. It combines:

1. **A browser flight simulator** that merges the best of three desktop sims:
   - **X-Plane 12:** physics-based flight model, real cockpit procedures, instruments, and radio navigation.
   - **Microsoft Flight Simulator 2024:** a visual world for VFR pilotage, plus a C172 with a G1000-style glass cockpit.
   - **FlightGear:** completely free and open source (MIT here). It runs in a browser, with no install and no account.
2. **Written-exam prep:** a study guide, flashcards, quizzes, a timed 60-question practice exam, and a Quizlet export, all built on the question bank in `assets/data/questions.json`.
3. **A "path to the written test" roadmap** that links the free sources the owner chose (see *Resources* below).

**The name:** Zarhart combines **Zara Rutherford** (in 2022, at 19, the youngest woman to fly solo around the world, in a Shark ultralight; the trip ran 18 Aug 2021 to 20 Jan 2022) and **Amelia Earhart** (first woman to fly solo across the Atlantic, 20–21 May 1932, in a Lockheed Vega 5B; disappeared 2 Jul 1937 near Howland Island in a Lockheed Electra 10E while the USCGC *Itasca* waited for her). World names nod to both: Lake Itasca, Atchison (Earhart's hometown), Electra Field and Range, Harbour Grace, Rutherford, P-19, and R-1932.

The site is published with **GitHub Pages** from this repo (`ramalliss/zarhart`, served from branch `main`, folder `/`). It is a static site with no build step. Three.js loads from jsDelivr through an import map.

---

## Status

| Piece | State |
|---|---|
| `assets/js/sim/fdm.js`: flight dynamics (C172N class) | **Done and tested.** See the test results below. |
| `assets/js/sim/world-data.js`: terrain, airports, navaids, airspace, VFR minimums | **Done.** Used by the FDM and the tests. |
| `tools/test-fdm.mjs`: headless checks (`npm test`) | **Done** |
| `assets/data/questions.json`: 126-card bank (57 from a Sporty's practice test + 69 extra) | **Done.** Built earlier in the original session. |
| 3D renderer, airplane model, cockpit | To do |
| Instrument panel (six-pack + G1000-style PFD/MFD) | To do |
| Moving map / sectional view, radios, ATIS, ATC text | To do |
| Checklists, lessons, scoring, failures, weather UI | To do |
| Landing page, exam prep pages, roadmap page | To do |
| README screenshots, Pages deploy, smoke test | To do |

### FDM test results (`npm test`, standard day, 2,300-lb class weight)
```
Takeoff ground roll       614 ft      (book ~720)        liftoff 56 KIAS
Climb at Vy               890 fpm     (book ~770; could trim prop eta a little)
Full throttle @3,000 ft   121 KTAS    (book ~122)        2,574 rpm
68% throttle level        99 KIAS @ 2,158 rpm, 8.2 gph
Stall flaps up / 30       48 / 40 KIAS (book 47 / 41)    warning at 54 KIAS
Engine-out glide 68 KIAS  -733 fpm, 10:1 (book ~9:1)
45° / 60° level turn      1.40 G / 1.94 G (theory 1.41 / 2.00)
```

---

## File layout (target)

```
index.html                  landing page
sim/index.html              simulator shell (canvas + HUD + drawers)
prep/index.html             exam prep (guide, flashcards, quiz, practice exam, Quizlet export)
path/index.html             roadmap to the written test (or a section of index.html)
assets/css/site.css         shared tokens, nav, footer, buttons
assets/css/sim.css          simulator HUD
assets/js/sim/fdm.js        ✅ flight model (pure, Node-testable)
assets/js/sim/world-data.js ✅ world definition (pure, Node-testable)
assets/js/sim/main.js       bootstrap + main loop (requestAnimationFrame, fixed-step FDM)
assets/js/sim/world3d.js    terrain mesh + procedural ground texture, water, roads, towns, trees, airports, lights, sky, clouds
assets/js/sim/plane3d.js    low-poly C172 (high wing, struts, fixed gear, spinning prop disc) + cockpit frame
assets/js/sim/input.js      keyboard, mouse yoke, Gamepad API, touch stick + throttle
assets/js/sim/panel.js      canvas instruments: six-pack + G1000-style PFD; interactive knobs
assets/js/sim/map.js        moving map with sectional symbology (also full-screen VFR map)
assets/js/sim/nav.js        VOR/DME/CDI/OBS, GPS direct-to and flight plan
assets/js/sim/weather.js    wind/gust/turbulence, clouds, visibility, METAR + ATIS text, time of day
assets/js/sim/radio.js      COM/NAV tuning, ATIS (speechSynthesis optional), simple tower/CTAF text ATC, PCL clicks, transponder
assets/js/sim/checklists.js C172 checklists that tick themselves from sim state
assets/js/sim/lessons.js    exam-linked lessons with objectives, scoring and debriefs
assets/js/sim/audio.js      WebAudio engine/wind/stall horn/touchdown
assets/js/prep/prep.js      exam-prep app
assets/data/questions.json  ✅ question bank
tools/test-fdm.mjs          ✅ headless FDM tests
```

Import map, used in `sim/index.html`:
```html
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
```
Use `three/addons/objects/Sky.js` for a physically based sky.

---

## Flight model notes (`fdm.js`)

- World frame: x = east, y = up, z = south (**north is −z**). Airplane local frame follows three.js: forward = −z, up = +y, right = +x. Aero body frame: x forward, y right, z down. The `toAero` and `toLocal` helpers convert between the frames.
- `new Aircraft(env)`, where `env = { ground(x,z) -> {h,type}, wind(x,y,z,t) -> {x,y,z} (air velocity), weather: { qnhInHg, tempC, dewC, isaDev } }`.
- `reset({ x, z, hdg, onGround, altFt, kias, flaps, engineRunning, rolling, pitch })` and `step(dt)` (internally runs at 240 Hz). Read `a.derived` for instrument values: ias, tas, gs, altInd, vsi, hi, compass, aiPitch, aiBank, tc, ball, g, aoa, stallWarn, rpm, fuel, oilT, suction, volts, densAlt, pressAlt, agl, wb (weight and balance), and so on.
- Controls go in `a.ctl`: elevator, aileron, rudder (−1..1, + = pull / right roll / right yaw), throttle 0..1, trim −1..1, brake/brakeL/brakeR 0..1. Also `a.flapsSet` (0/10/20/30), `a.parkingBrake`, `a.eng.{mixture, mags ('off'|'right'|'left'|'both'|'start'), carbHeat, selector}`, `a.elec.{master, avionics, lights{beacon,strobe,nav,landing,taxi}, pitotHeat}`, `a.xpdr`, `a.inst.{kollsman, obs, hdgBug, aiOffset, hiDrift}` (set `hiDrift = 0` and align with the compass to "set the HI"), and `a.load` (front, rear, fuelGal, bagA, bagB lb).
- Modelled: lift curve with stall and post-stall, flaps, **ground effect** (McCormick), induced and parasite drag, **P-factor, torque, slipstream** (needs right rudder in a climb), adverse yaw, dihedral, spin autorotation, **CG effects** (stability and a stall-speed penalty at forward CG), density-altitude engine lapse, **mixture** (best power drops with altitude), **carb ice** (−7 to 21 °C with a small temperature/dewpoint spread; fix it with carb heat), magnetos and start sequence, fuel tanks and selector with starvation, electrical system (alternator, battery drain), **vacuum gyros** that spin down after a failure, **pitot or static blockage** (trapped pressures, so the ASI acts like an altimeter, and so on), **altimeter temperature error** ("high to low, look out below"), **heading-indicator precession**, **compass turning and acceleration errors** (UNOS/ANDS), turn coordinator and ball, G-load, three-wheel gear with brakes and nose steering, crash detection (wingtips, prop strike, tail, hard landing over 1,100 fpm), and touchdown events with fpm, KIAS, bank and pitch.
- Events go to `a.events` (`touchdown`, `liftoff`, `crash`, `warn`, `info`); the UI drains and clears this array each frame.
- `a.failures = { engine, vacuum, pitot, static, alternator }`.

## World (`world-data.js`)

About 60 × 60 km, deterministic (seeded simplex). Exports `heightAt`, `groundAt`, `airspaceAt`, `vfrMinimums`, `nearestAirport`, `AIRPORTS`, `NAVAIDS`, `AIRSPACE`, `LAKE`, `RIVER`, `HIGHWAY`, `RAILROAD`, `TOWNS`, `OBSTACLES`, `DAM`, `LAUNCH`, `POWER_PLANT`, `WATER`, and `VARIATION` (0°: the agonic line runs through the valley).

- **KZAR Zarhart Field** (towered, Class D, ATIS 127.85, TWR 118.3, GND 121.9). Runway 09/27 is 1,500 × 30 m with lights and a 2-bar VASI on both ends. Runway 18/36 is 1,100 × 23 m and crosses 09/27 at x = 350, so **runway/runway hold position signs** "18-36" go on 09/27. Taxiway A runs north of 09/27 with connectors A1/A3/A6. Hold-short lines and signs, a tower, a **rotating beacon** (white/green), a windsock, hangars and parked planes are defined.
- **KAME Earhart Municipal** (nontowered, CTAF 122.8, **pilot-controlled lighting**: 7/5/3 clicks within 5 s, lights on for 15 min). Runway 18/36 has a VASI on 36. A **segmented circle** shows right traffic for 18 and left for 36, so the pattern sits west of the runway.
- **Z19 Electra Field:** grass runway 04/22, 760 m, for soft-field lessons.
- VORs: **ZRH 113.90** at (2600, −3400) and **AME 116.40** at (17600, 12600).
- Landmarks for pilotage: Lake Itasca with its dam, the Electra River, Highway 32, a railroad, the towns of Rutherford / Atchison / Itasca Village / Harbour Grace, radio masts (330 m AGL, red lights), the Itasca power plant stack, the Rutherford Launch Complex (rocket on a pad, on a plateau), and the Electra Range mountains to the north (−z).
- Airspace: KZAR Class D (r ≈ 4.2 NM, SFC to field + 2,500 rounded); Class E from 700 AGL around KAME and Z19; Class E from 1,200 AGL elsewhere; P-19 (Launch Complex, SFC–5,000); R-1932 (SFC–12,000); Electra MOA (8,000–17,999).

---

## Simulator: features to build

**Rendering (MSFS-style visuals)**
- Terrain mesh about 400×400 over the 60 km square, heights from `heightAt`. Add a **procedural ground texture** (2048² canvas): farm-field patches, forests, rock and snow by height and slope, with the river, highway, railroad, towns and lake drawn as vectors. That makes pilotage landmarks visible, and the same canvas can be reused for the map. Multiply in a tiling detail texture up close. Compute height colours on a coarser grid; don't call `heightAt` 4M times.
- Water plane for the lake, instanced trees in forest areas, instanced buildings in towns, the dam, power plant, masts with flashing red lights, and a rocket and launch tower.
- Airports: asphalt runways with markings as separate planes (threshold bars, runway numbers drawn with canvas text, centerline dashes, aiming point, touchdown zone). Taxiways with yellow centerlines and **hold-short markings (two solid + two dashed)**. **Signs**: red mandatory (`9-27`), black/yellow location, yellow direction/destination. Runway edge lights (white), threshold green, end red, taxiway blue; the **2-bar VASI** colour is computed per bar from the eye angle (near bar ~2.5°, far bar ~3.0°: red over white = on path). Beacon alternating white/green at night. A **light gun** sprite on the KZAR tower for the NORDO lesson.
- Sky from `Sky.js`, with the sun set by time of day (day, dusk, night). Fog colour matches the horizon. **Clouds**: billboard puffs at the METAR base and coverage (FEW/SCT/BKN/OVC), denser fog inside clouds (IMC).
- Cameras: cockpit (left seat, mouse-look, glareshield, window posts, wing roots overhead because it's a high wing, prop disc), chase, orbit, and a tower view from the nearest tower. Optional low/high graphics setting.

**Instruments (X-Plane-style procedures)**
- **Six-pack** canvas: ASI with white/green/yellow arcs and red line (Vs0 41, Vfe 85, Vs1 47, Vno 127, Vne 158); AI with an adjustable miniature airplane (exam Q31); altimeter with **Kollsman window** (exam Q4/Q50); turn coordinator with ball; HI with a drift-set knob; VSI. Also a compass, tach (red line 2,700), fuel L/R, oil T/P, suction, ammeter, flaps and trim indicators, a clock/timer, NAV1 CDI with OBS and TO/FROM, a DME readout, and a transponder.
- **G1000-style glass**: PFD (sky/earth attitude, speed tape with trend and V-speed bugs, altitude tape with baro box, VSI, HSI with VOR/GPS CDI, wind vector, OAT/TAS/GS) and MFD (moving map, engine strip). Glass needs electrical power (master + avionics); steam gauges don't.
- Toggle the panel with `I` (six-pack → glass → hidden). Knobs can be clicked or scrolled.

**Systems and controls**
- An HTML switch panel: master, avionics, beacon, strobe, nav, landing, taxi lights, pitot heat, carb heat, fuel selector, mixture, magneto key (OFF/R/L/BOTH/START), parking brake, primer (cosmetic).
- Keys: ↑/W nose down, ↓/S nose up, ←/A and →/D roll, Q/E rudder, R/F throttle, `[` `]` flaps, T/G trim nose up/down, B brakes (with rudder for differential), Shift+B parking brake, C camera, P pause, M map, K checklist, I panel, H help, O set HI to compass, Space push-to-talk (PCL clicks). **Gamepad API** for joysticks. **Touch**: virtual stick and throttle slider.
- Audio: engine drone pitched by RPM, wind, a stall horn while `derived.stallWarn` is true, touchdown thump, and radio click.

**Navigation and radio**
- VOR radial and CDI (full scale ±10°, TO/FROM), DME slant range, and GPS direct-to/flight plan with a magenta line. COM presets for ATIS, TWR, GND and CTAF. ATIS text built from current weather (absent sky/visibility means ceiling ≥ 5,000 and visibility ≥ 5). Simple tower text ATC for taxi, takeoff, landing and the pattern. A transponder where **7700** triggers an emergency response and 7600/7500 are explained.

**Weather**
- Wind (FROM direction and speed, with gusts), log-profile shear near the ground, turbulence, cloud base and coverage, visibility, temperature/dewpoint, and altimeter setting. Generate a **METAR** string (for example `KZAR 161753Z 27012G18KT 10SM SCT045 18/09 A3002`). Show density altitude and wind components for the active runway.

**VFR minimums monitor**
- An HUD chip that uses `airspaceAt` + `vfrMinimums` + cloud geometry to show the current class, what's required, and whether you're legal (cloud clearance and visibility). Warn when entering P-19, R-1932 or the MOA, or Class D without a radio call.

**Checklists** (C172 style, auto-tick from sim state): Before start, Engine start, Run-up (mag check: R and L drop ≤ 125 rpm, ≤ 50 rpm difference, carb heat check), Before takeoff, Takeoff, Climb, Cruise, Descent, Before landing, After landing, Shutdown.

**Lessons**: each has a spawn, weather, time, failures, live objectives, a debrief score, and links to exam questions by card id in `questions.json`.
1. Pattern work at KZAR (Vy 74, pattern altitude field + 1,000): t16
2. Fly the VASI, short final 27 (red over white): t23, t52, t54
3. Steep turns, 45°, ±100 ft (G meter): t34, t58
4. Power-off stall and recovery (critical AoA is constant): t42, t9, e34
5. Soft-field takeoff at Z19 grass (ground effect): t21, t35, t55
6. VOR tracking, ZRH 090 radial outbound: e55, e60
7. Cross-country KZAR → KAME by pilotage (lake/dam, masts, Atchison): t57, e62, e56, e57
8. Night: pilot-controlled lighting at KAME, 7 clicks on 122.8, beacon: t33, e49
9. Engine failure, glide at 68 KIAS, squawk 7700: t59, e54
10. Carb ice in humid cruise, apply carb heat: e41
11. Crosswind landing (e.g. 220@15G20 on 27)
12. Wake turbulence: a heavy jet lands ahead; its vortices sink and drift: t25, t36, t51, t53
13. NORDO arrival with light gun signals at KZAR: e47, e48
14. Free flight (choose airport, runway, weather, time, load)

**Weight and balance screen**: edit `a.load`, show the CG envelope chart (C172N: forward 35.0 in to 1,950 lb, then linear to 38.5 in at 2,300 lb; aft 47.3 in). The flight model already responds to the result (forward CG → higher stall speed; aft → less stable). Links: t27, t48.

---

## Exam prep (`prep/`)
- Load `assets/data/questions.json` (topics with "know cold" facts, and cards with `id`, `src` test|extra, `res` miss|ok, `topic`, `q`, `c` where the **first choice is correct** and the quiz shuffles them, `why`, `ref`, `fig`, `note`, `card:false` = guide only).
- **Privacy:** the original session's practice-test score (24/60) is personal. **Don't show the score on the public site.** Label the test-derived deck "Sporty's practice test review", not "your misses".
- Modes: study guide by topic; flashcards (known/learning tracked in localStorage); quiz; a **timed practice exam** (60 random questions, 2 h 30 min, 70% to pass, with a results breakdown by ACS area like a real test report); Quizlet export (tab-separated, with a copy button).
- Map topics to the ACS: ops → PA.III.A/B; regs → PA.I.A/B/E; aero → PA.I.F, PA.VII; wake → PA.III.B/PA.IV; perf → PA.I.F; inst → PA.I.G; wx → PA.I.C; nav → PA.I.D, PA.VI; adm → PA.I.H, PA.V, PA.IX.
- Link every topic to its **PHAK chapter** (FAA-H-8083-25C: 2 ADM, 4–5 principles and aerodynamics, 6 controls, 7 systems, 8 instruments, 10 W&B, 11 performance, 12 weather theory, 13 weather services, 14 airport ops, 15 airspace, 16 navigation, 17 aeromedical) and to the matching **sim lesson**.
- Grow the bank with ~40 more questions written from the PHAK (public domain), covering weather services (TAF, AIRMET/SIGMET, PIREP), airspace (TFR, MTR, Class B/C dimensions), private-pilot privileges (pro-rata cost sharing), night equipment and lighting, VOR CDI interpretation, performance charts, and aeromedical topics. Don't copy commercial question banks verbatim.

## Landing page and roadmap
- Hero: the ZARHART wordmark over a live, gently banking G1000-style attitude display (canvas) that reacts to the mouse or device tilt. CTAs: **Launch simulator** and **Start exam prep**.
- A "Named for two record-setters" section (facts above).
- "Three sims, one cockpit": what Zarhart takes from X-Plane 12, MSFS 2024 and FlightGear, plus Zarhart-only features (exam-linked lessons, VFR minimums monitor, failures that teach, pilot-controlled lighting).
- **Path to the written test** (an ordered sequence, so numbering is OK):
  1. Ground-school lessons: [FLY8MA free ground school](https://fly8ma.com/private-pilot-ground-school/). Free, but no written-test endorsement.
  2. Study handbook: [FAA Pilot's Handbook of Aeronautical Knowledge](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak). Free PDF.
  3. Practice exams (start here): [Sporty's free practice tests](https://courses.sportys.com/training/portal/course/PRIVATE/testprep). Free, unlimited timed 60-question tests.
  4. More practice questions: [King Schools free FAA test](https://www.kingschools.com/free-faa-exam/). Free.
  5. Get an endorsement from a CFI or a ground-school course (the free FLY8MA tier doesn't include one).
  6. Get your FAA Tracking Number (FTN): [FAA IACRA](https://iacra.faa.gov/). Free.
  7. Book the official written exam: [FAA testing portal (PSI)](https://faa.psiexams.com/). $175 plus applicable tax.
- Footer: MIT license, "Study aid only. Not FAA-approved training and not for real-world navigation."

## Visual direction
Avionics at night, a deliberate single dark theme. Bezel black-blue background (`#070B10`), panels `#0E151D` / `#142030`, lines `#22303F`, text `#E8EEF5`, muted `#8FA0B3`. Signature accents come from glass cockpits: **GPS magenta** `#E64BD0`, **selected-value cyan** `#3FD8F2`, **VOR green** `#5BE38A`, amber `#FFB020` for cautions, red `#FF4D4D` for warnings, and attitude sky `#2F7FD0` over earth `#8A5A2B`. Type: **Saira Condensed** (display), **Barlow** (body), **IBM Plex Mono** (data). Airport-sign styling (yellow/black, red/white) works for tabs and labels. Keep it fast and readable on phones (16 px side gutters, no horizontal scroll).

## Publishing
1. `git push -u origin main` to `https://github.com/ramalliss/zarhart`.
2. In GitHub: Settings → Pages → Build and deployment → Source **Deploy from a branch**, Branch **main** / **(root)**. Add an empty `.nojekyll` (already present).
3. The site goes live at `https://ramalliss.github.io/zarhart/`. Use **relative** URLs everywhere so it works under `/zarhart/`.
