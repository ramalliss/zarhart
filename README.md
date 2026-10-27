# Zarhart

**Learn to fly in your browser.** Zarhart is a free, open-source flight simulator and FAA Private Pilot (PAR) written-test prep site, named for **Zara Rutherford** (youngest woman to fly solo around the world, 2022) and **Amelia Earhart** (first woman to fly solo across the Atlantic, 1932).

Created by **Sophia Ramalli**, a student pilot who built it while studying for the FAA written test.

**Live site:** https://ramalliss.github.io/zarhart/

| | |
|---|---|
| **Fly** (`/sim/`) | A Cessna 172N-class flight model checked against book numbers, three airplanes (Cessna 172 and 152, Piper PA-28), the Zarhart Valley (six airports including a 4,430 ft mountain strip and a regional field with a displaced threshold, blast pad and closed runway; two VORs; Class D airspace; landmarks for pilotage), weather with rain, snow, frost, icing, gusts, calm wind, fog and a microburst, wet and icy runways with hydroplaning, six-pack and G1000-style glass instruments, a sectional-style map, radios with ATIS and simple ATC, pilot-controlled lighting, light-gun signals, a VFR minimums monitor, checklists, failures, weather, weight & balance, and 13 lessons linked to written-test questions, plus ten Pro lessons from the Private Pilot ACS (short-field landing, slow flight, turns around a point, S-turns, rectangular course, forward slip, go-around, emergency descent, diversion, night cross-country), free while Pro is in the works. |
| **Study** (`/prep/`) | 650+ practice questions with explanations, a study guide by topic (ACS area, PHAK chapter, simulator lesson), flashcards, smart-review quizzes, scenario quizzes (rain, icing, wind, storms, fog, METARs, markings, mountains, airplanes), ten fixed timed 60-question practice tests plus random ones, each with a topic report, and Quizlet export. |
| **Path** (`/#path`) | The free route to the written test: FLY8MA ground school → FAA PHAK → Sporty's and King Schools practice tests → endorsement → FTN in IACRA → book with PSI. |

## What it borrows

- **X-Plane 12:** physics-based flight model, procedures and instruments, radio navigation.
- **Microsoft Flight Simulator 2024:** a visual world for VFR pilotage and a C172 with glass and steam cockpits.
- **FlightGear:** free and open source. It runs in a browser with no install.

## Controls

`↑/↓` pitch · `←/→` roll · `Q/E` rudder · `R/F` throttle · `[ ]` flaps · `T/G` trim · `B` brakes · `Shift+B` parking brake · `H` carb heat · `C` view · `I` panel · `M` map · `K` checklist · `U` flight assist · `Space` mic click · `P` pause. Gamepads, joysticks and touch work too: in **Settings → Joystick, throttle and pedals**, click Assign and move any axis or press any button to map it, across several devices at once (stick, throttle quadrant, rudder pedals), with invert and a sensitivity curve. No keyboard? The on-screen stick and throttle lever work with a mouse too (drag the stick, push the lever up for power), and a coach reminds you about the parking brake, when to rotate and how to hold the climb on your first takeoffs. On phones the stick floats under your left thumb, the right thumb gets either a throttle lever with buttons (rudder, flaps, brakes, parking brake, view, pause) or a second throttle/rudder stick, and you can turn on tilt-to-fly. Phones vibrate and gamepads rumble with the stall horn and on touchdown. Flight assist starts in **Assisted** (let go of the controls and the airplane holds its pitch and bank, with auto-trim and auto-rudder); `U` switches to **Auto-rudder** only or full **Manual** to practise coordination.

## Install it on a phone

The site is an installable web app. On iPhone or iPad, open it in Safari and tap **Share → Add to Home Screen**; on Android or desktop Chrome and Edge, use **Install the app** on the home page (or Install in the browser menu). It opens full screen, and pages you've visited work offline (`sw.js`, network first, so online visitors always get the latest version).

## VR (Meta Quest, or a phone in a viewer)

Open the simulator in the Quest's built-in browser and tap **Fly in VR** (or **VR** in the toolbar). It's a seated cockpit view through WebXR: the instruments are on the dashboard, lesson objectives and radio calls are on a strip on the glareshield, and the controllers fly the airplane:

Right stick: pitch and roll · Left stick: throttle (up/down) and rudder (left/right) · Right trigger: brakes · A / B: flaps down / up · X: mic click · Y: recenter your view · Right stick press: flight assist · Left stick press: pause.

WebXR needs HTTPS, so test VR on the live site rather than the local dev server. The VR button only appears in browsers that support immersive VR.

### Phone VR (Cardboard-style viewers, iPhone included)

Phones without WebXR (iPhone Safari, the iOS app) get **phone VR** from the same **VR** button: two eye views side by side for a $15–30 phone viewer, head tracking from the phone's motion sensors (iOS asks for Motion & Orientation access), and the same cockpit, dashboard instruments and glareshield messages as the headset mode. Fly with a Bluetooth game controller (Xbox, PlayStation, Switch Pro or MFi). Tap the screen, or the viewer's button, to recenter; double-tap to leave. Eye spacing and field of view are adjustable for different phones and lenses. Add the site to the Home Screen first for a full-screen view on iPhone.

## Run locally

```bash
python tools/serve.py        # http://localhost:8765 (no-cache dev server)
node tools/test-fdm.mjs      # headless flight-model checks against C172 book numbers
```

To flight-test the lessons end to end, open `/sim/` on the dev server and run this in the browser console:

```js
const T = await import('/tools/test-pilot.js');
await T.runLesson('pattern'); // or vasi, steep, stall, softfield, vor, xc, night, enginefail, carbice, crosswind, wake, nordo, shortfield, slowflight, turnspoint, sturns, rectangle, nightxc, slip, goaround, emerdesc, diversion
```

A scripted pilot flies the lesson through `window.__zarhart.step()` (physics, monitors and lesson checks, without rendering) and returns each objective's state, the debrief and any failure.

It's a static site with no build step. Three.js 0.160 loads from jsDelivr through an import map.

## Layout

```
index.html               landing page
sim/                     simulator page
prep/                    written-test prep
pricing/                 plans and pricing (prices and checkout links in its CONFIG block)
learn/                   study notes: one sourced page per written-test topic, with practice questions
sitemap.xml              for Google Search Console (robots.txt only applies on a custom domain)
assets/img/shots/        product shots rendered in the simulator
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
