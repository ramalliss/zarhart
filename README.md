# Zarhart

**Learn to fly in your browser.** Zarhart is a free, open-source flight simulator and FAA Private Pilot (PAR) written-test prep site, named for **Zara Rutherford** (youngest woman to fly solo around the world, 2022) and **Amelia Earhart** (first woman to fly solo across the Atlantic, 1932).

Created by **Sophia Ramalli**, a student pilot who built it while studying for the FAA written test.

**Live site:** https://ramalliss.github.io/zarhart/

| | |
|---|---|
| **Fly** (`/sim/`) | A Cessna 172N-class flight model checked against book numbers, the Zarhart Valley (three airports, two VORs, Class D airspace, landmarks for pilotage), six-pack and G1000-style glass instruments, a sectional-style map, radios with ATIS and simple ATC, pilot-controlled lighting, light-gun signals, a VFR minimums monitor, checklists, failures, weather, weight & balance, and 13 lessons linked to written-test questions. |
| **Study** (`/prep/`) | 175 practice questions with explanations, a study guide by topic (ACS area, PHAK chapter, simulator lesson), flashcards, quizzes, a timed 60-question practice exam with a topic report, and Quizlet export. |
| **Path** (`/#path`) | The free route to the written test: FLY8MA ground school → FAA PHAK → Sporty's and King Schools practice tests → endorsement → FTN in IACRA → book with PSI. |

## What it borrows

- **X-Plane 12:** physics-based flight model, procedures and instruments, radio navigation.
- **Microsoft Flight Simulator 2024:** a visual world for VFR pilotage and a C172 with glass and steam cockpits.
- **FlightGear:** free and open source. It runs in a browser with no install.

## Controls

`↑/↓` pitch · `←/→` roll · `Q/E` rudder · `R/F` throttle · `[ ]` flaps · `T/G` trim · `B` brakes · `Shift+B` parking brake · `H` carb heat · `C` view · `I` panel · `M` map · `K` checklist · `Space` mic click · `P` pause. Gamepads, joysticks and touch work too. Auto-rudder is on by default; turn it off in Settings to practise coordination.

## Run locally

```bash
python tools/serve.py        # http://localhost:8765 (no-cache dev server)
node tools/test-fdm.mjs      # headless flight-model checks against C172 book numbers
```

To flight-test the lessons end to end, open `/sim/` on the dev server and run this in the browser console:

```js
const T = await import('/tools/test-pilot.js');
await T.runLesson('pattern'); // or vasi, steep, stall, softfield, vor, xc, night, enginefail, carbice, crosswind, wake, nordo
```

A scripted pilot flies the lesson through `window.__zarhart.step()` (physics, monitors and lesson checks, without rendering) and returns each objective's state, the debrief and any failure.

It's a static site with no build step. Three.js 0.160 loads from jsDelivr through an import map.

## Layout

```
index.html               landing page
sim/                     simulator page
prep/                    written-test prep
assets/js/sim/           fdm.js (flight model), world-data.js, world3d.js, plane3d.js, panel.js, map.js,
                         nav.js, weather.js, input.js, audio.js, checklists.js, lessons.js, main.js
assets/js/prep/prep.js   prep app
assets/data/questions.json  question bank
tools/                   dev server and tests
```

## Disclaimer

Study aid only. Not FAA-approved training and not for real-world navigation. Not affiliated with Sporty's, King Schools, FLY8MA, Laminar Research, Microsoft or the FlightGear project. Practice questions are written from public FAA references (AIM, 14 CFR, PHAK).

## License

MIT
