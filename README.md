# Zarhart

**Learn to fly in your browser.** Zarhart is a free, open-source flight simulator and FAA Private Pilot (PAR) written-test prep site, named for **Zara Rutherford** (youngest woman to fly solo around the world, 2022) and **Amelia Earhart** (first woman to fly solo across the Atlantic, 1932).

Created by **Sophia Ramalli**, a student pilot who built it while studying for the FAA written test.

**Live site:** https://ramalliss.github.io/zarhart/

| | |
|---|---|
| **Fly** (`/sim/`) | A Cessna 172N-class flight model checked against book numbers, three airplanes (Cessna 172 and 152, Piper PA-28), the Zarhart Valley (six airports including a 4,430 ft mountain strip and a regional field with a displaced threshold, blast pad and closed runway; two VORs; Class D airspace; landmarks for pilotage), weather with rain, snow, frost, icing, gusts, calm wind, fog and a microburst, wet and icy runways with hydroplaning, and 19 free lessons including rain, snow, a microburst, calm wind, density altitude and a displaced threshold, six-pack and G1000-style glass instruments, a sectional-style map, radios with ATIS and simple ATC, pilot-controlled lighting, light-gun signals, a VFR minimums monitor, checklists, failures, weather, weight & balance, and 13 lessons linked to written-test questions, plus ten Pro lessons from the Private Pilot ACS (short-field landing, slow flight, turns around a point, S-turns, rectangular course, forward slip, go-around, emergency descent, diversion, night cross-country), free while Pro is in the works. |
| **Study** (`/prep/`) | 650+ practice questions with explanations, a study guide by topic (ACS area, PHAK chapter, simulator lesson), flashcards, smart-review quizzes, scenario quizzes (rain, icing, wind, storms, fog, METARs, markings, mountains, airplanes), calculation drills that generate new questions every time (METAR decoding and flight category, wind components, pressure and density altitude, time-speed-distance and fuel, true course to magnetic heading), ten fixed timed 60-question practice tests plus random ones, each with a topic report, and Quizlet export. |
| **Path** (`/#path`) | The free route to the written test: FLY8MA ground school → FAA PHAK → Sporty's and King Schools practice tests → endorsement → FTN in IACRA → book with PSI. |

## What it borrows

- **X-Plane 12:** physics-based flight model, procedures and instruments, radio navigation.
- **Microsoft Flight Simulator 2024:** a visual world for VFR pilotage and a C172 with glass and steam cockpits.
- **FlightGear:** free and open source. It runs in a browser with no install.

## Controls

`↑/↓` pitch · `←/→` roll · `Q/E` rudder · `R/F` throttle · `[ ]` flaps · `T/G` trim · `B` brakes · `Shift+B` parking brake · `H` carb heat · `C` view · `I` panel · `M` map · `K` checklist · `U` flight assist · `Space` mic click · `P` pause. Gamepads, joysticks and touch work too: in **Settings → Joystick, throttle and pedals**, click Assign and move any axis or press any button to map it, across several devices at once (stick, throttle quadrant, rudder pedals), with invert and a sensitivity curve. No keyboard? The on-screen stick and throttle lever work with a mouse too (drag the stick, push the lever up for power), and a coach reminds you about the parking brake, when to rotate and how to hold the climb on your first takeoffs. On phones the stick floats under your left thumb, the right thumb gets either a throttle lever with buttons (rudder, flaps, brakes, parking brake, view, pause) or a second throttle/rudder stick, and you can turn on tilt-to-fly. Phones vibrate and gamepads rumble with the stall horn and on touchdown. Flight assist starts in **Assisted** (let go of the controls and the airplane holds its pitch and bank, with auto-trim and auto-rudder); `U` switches to **Auto-rudder** only or full **Manual** to practise coordination.

## Instructor's notes

The sim records every flight, four samples a second: airspeed, altitude, height above the ground, sink rate, pitch, bank, heading, position, throttle, flaps and the stall warning, plus each liftoff, touchdown and crash. After each landing it marks the moments an instructor would point at, each with the number and the fix:

- **On final, from 500 ft down to 100 ft:** more than 10 kt fast or 5 kt slow for at least a second and a half, or sinking over 1,000 fpm. The target is the airplane's approach speed (5 kt more with the flaps up, plus half the gust factor), or the lesson's own (60 KIAS for the short-field landing).
- **The flare:** flaring late (still sinking as fast at 10 ft as at 50 ft), or levelling off or ballooning above 15 ft.
- **The touchdown:** firm or hard, long (past the first third of the runway), short, off the centreline, crabbed, too fast, or bounced.
- **Anywhere:** the stall warning (not in the flare, and not in the stall lessons, where it's the point), and more than 30° of bank below 600 ft.

A finished lesson shows these as **Instructor's notes** under the result, with when each happened and what to try next. Below them, a chart of each approach draws your height against the 3° path to the 1,000 ft aiming point and your airspeed against the target band, with each note's number at the moment it happened. In free flight the same notes and chart open in a card after each landing. In VR they appear one at a time on the glareshield and are read aloud, and so are the callouts. While you fly, the sim calls out airspeed or sink rate on final and steep bank close to the ground, twice at most per approach. Settings → Controls has a switch for all of it. The rules are in `assets/js/sim/debrief.js`; the recording is what the AI debrief will read later.

## Radio practice, traffic and multiplayer

- **Radio practice:** hold Space (or Talk) and speak the call the radio strip suggests. Your browser's speech recognition transcribes it, the call is scored part by part against standard phraseology, and ATC answers a good call. You can also type calls.
- **Automated traffic** in free flight taxis, departs and flies the pattern at four airports, talking to Ground, Tower or the CTAF. Tower gives you traffic advisories.
- **Multiplayer:** `node server/zarhart-server.mjs` hosts a shared sky that serves the site too. Players join in the **Online** menu as pilots or controllers. Voice is push-to-talk and only reaches stations tuned to your frequency and in line of sight, with AM-radio static, squelch tails and blocked transmissions. See [server/README.md](server/README.md).

## Real World mode

On the simulator's start screen, type any US airport ID (KPAO, KASE, FDK…) under **Or fly from a real US airport**. The sim builds a 60 × 60 km square around it from free, open data, with no account or key:

- **Terrain heights:** [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (Tilezen, from USGS 3DEP, SRTM and other public sources). The flight model flies over them too.
- **Aerial photos:** USGS The National Map orthoimagery (public domain), sharper within about 3 km of the home airport.
- **Airports, runways, frequencies and VORs:** [OurAirports](https://ourairports.com/data/) (public domain), packed per 1° square by `tools/build-airports.mjs` into `assets/data/airports/`. Re-run it to refresh the data.
- **Live weather:** the National Weather Service's latest observation ([api.weather.gov](https://www.weather.gov/documentation/services-web-api), public domain) for the field or the nearest station with one, flown as its METAR: wind and gusts, visibility, rain, snow or freezing rain, cloud layers, temperature and altimeter. The sim starts at the real local time of day there.
- **Airspace:** the FAA's Class B, C, D and E shapes and special use airspace (prohibited, restricted, warning and alert areas, MOAs) from [FAA Aeronautical Information Services open data](https://adds-faa.opendata.arcgis.com/) (public domain), drawn on the map like a sectional, with warnings when you enter Class B, C or D without the clearance or contact it needs.
- **Obstacles:** every tower, mast, chimney, wind turbine and tall building of 150 ft or more from the FAA's Digital Obstacle File (same open data, public domain), built at its real height with its red or white lights, and solid: flying into one ends the flight.
- **Taxiways, ramps, hangars, terminals, windsocks and parking spots:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), asked for live from the Overpass API and kept in the browser (IndexedDB) for 30 days. The public Overpass servers can take half a minute to answer, so on a first visit taxiways may appear a little after the sim loads; later visits are instant.

Runway lengths, widths, surfaces, lights and numbers are real, and so are the tower, ground, ATIS, CTAF and AWOS frequencies (when OurAirports has them). Hold-short lines and their signs go where each taxiway reaches the holding distance from a runway (125, 200 or 250 ft from the centreline, by airport size), you can start at a real parking spot, and Ground's taxi instructions name the real taxiways along the shortest route to your runway. The compass, heading indicator, VOR radials, GPS courses and controllers' winds are magnetic, using the variation of the nearest VOR (METARs stay true, as real ones are). Every towered field's Tower and Ground answer you, by its real name ("San Carlos Tower"), and Approach (named for its real facility, such as "NorCal Approach") gives flight following: a squawk code, then radar contact once your transponder shows it (the two-way contact Class C needs), and on request a Class B transition, which is usually granted and sometimes "remain clear". Live weather refreshes every 30 minutes with a new observation. Lighted airports have a rotating beacon (green and white). Lessons are built for the real home field, using the runway the wind favours and today's weather: a traffic pattern at its real pattern altitude, a landing from a 3-mile final, a cross-country to a real paved airport 10 to 25 NM away (at a VFR cruising altitude by the hemispheric rule, calling its tower or CTAF on the way in), and, where OpenStreetMap maps one, flying the PAPI (four units set at 3.5°, 3.17°, 2.83° and 2.5°) or VASI. Pattern traffic flies at the home field and two nearby fields, and a Cherokee taxis out from a parking spot along the real taxiways and departs. If the FAA or weather service can't be reached, towered fields get an approximate Class D or C and the weather is a preset. The full lesson course and multiplayer stay in Zarhart Valley. It needs an internet connection, and loading takes 10–30 seconds.

## Install it on a phone

The site is an installable web app. On iPhone or iPad, open it in Safari and tap **Share → Add to Home Screen**; on Android or desktop Chrome and Edge, use **Install the app** on the home page (or Install in the browser menu). It opens full screen, and pages you've visited work offline (`sw.js`, network first, so online visitors always get the latest version).

## VR (Meta Quest, Apple Vision Pro, or a phone in a viewer)

Open the simulator in the Quest's built-in browser and tap **Fly in VR** (or **VR** in the toolbar). It's a seated cockpit view through WebXR: the instruments are on the dashboard, lesson objectives and radio calls are on a strip on the glareshield, and the controllers fly the airplane:

Right stick: pitch and roll · Left stick: throttle (up/down) and rudder (left/right) · Right trigger: brakes · A / B: flaps down / up · X: mic click · Y: recenter your view · Right stick press: flight assist · Left stick press: pause.

**Graphics on a standalone headset.** A headset like the Quest draws the cockpit twice every frame, 72 to 90 times a second, on its built-in graphics chip. So when Graphics is High or Ultra, **Fly in VR** (and **VR** in the toolbar) first asks *Switch to Low for VR? Recommended on Quest.* **Switch** saves Graphics: Low and reloads the page, then highlights **Fly in VR**: tap it again, because a VR session can only start from a tap. **Keep** goes into VR with your current setting and isn't asked again until the page reloads. Desktop browsers driving a PC headset, and phone VR, never ask. The headset check is by browser (Meta Quest Browser, Pico Browser, Wolvic), in `assets/js/sim/headset.js`.

**Without controllers: pinch controls (Apple Vision Pro, or a Quest with hand tracking).** If no controller with sticks shows up in the first few frames, or on the first pinch, the cockpit shows a small console of six buttons below the panel, and you fly with your hands:

- **Right hand, pinch and move** works like a yoke. Pull toward you for nose up, push away for nose down, move sideways to roll. Full deflection takes 10 cm. Let go and the yoke centres.
- **Left hand, pinch and move**: up and down move the throttle like a lever from where it was (15 cm for full travel), and sideways is rudder. Let go and the throttle stays where you left it.
- **Look at a console button and pinch** for Flaps up, Flaps down, Brakes (on while you hold the pinch), Mic, Recenter, and Pause (Resume while paused, Try again after a crash). A button needs a short pinch that stays put; a long hold does nothing.

Movement is measured from the way your head faced when the pinch began, so the controls still work if you turn in the seat. A pinch from a hand the headset doesn't call left or right takes the yoke on the right of your head and the lever on the left. The maths is in `assets/js/sim/headset.js`, the controls in `assets/js/sim/vr.js`.

WebXR needs HTTPS, so test VR on the live site rather than the local dev server. The VR button only appears in browsers that support immersive VR.

### Testing VR on a headset

Pinch controls have been tested only in a desktop browser with a simulated session, not on a Vision Pro or a Quest. On a headset, check: that the console appears and the controller message doesn't; that a right-hand pinch pulled back raises the nose, without needing so much movement that it's tiring; that the left hand moves the throttle and holds it when let go; that looking at each console button and pinching presses it, and that a pinch aimed elsewhere flies instead; and that Brakes stay on only while held.

Zarhart hasn't been measured on a headset yet, so neither setting is known to hold the frame rate. Two URL flags help compare them:

- `?vrstats=1` shows a strip on the right of the glareshield in VR: frames per second (green at 71 and up, amber from 55, red below), the average and worst time between frames, and the CPU time of Zarhart's own work per frame, plus the Graphics setting, whether the logarithmic depth buffer is on, and the VR framebuffer size. It counts how often frames arrive; it doesn't measure the graphics chip. Use OVR Metrics Tool for that.
- `?logdepth=0` turns off the logarithmic depth buffer. It keeps distant surfaces from flickering through each other across the 160 km view, but every pixel then writes its own depth, which stops a graphics chip from skipping hidden pixels early and can cost speed on a headset. three.js fixes it when the renderer starts, so the flag covers the whole page load, the flat view included. The default is unchanged (on). In still views on a computer, turning it off changed under 0.02% of pixels (far-off runway lights); watch for flicker in the distance while moving, such as runway markings and taxiways far ahead.

Combine them: `https://ramalliss.github.io/zarhart/sim/?vrstats=1` and `https://ramalliss.github.io/zarhart/sim/?vrstats=1&logdepth=0`. For each one, on Low and on High, fly the same thing (for example free flight from runway 27, a minute on the runway and a minute at 2,000 ft over the valley) with Meta's OVR Metrics Tool (in the Meta Horizon Store; see [Meta's performance guide](https://developers.meta.com/horizon/documentation/native/android/ts-ovr-best-practices/)) showing its overlay, and note FPS, GPU and CPU utilization, GPU and CPU levels, and stale frames. In OVR Metrics Tool's Settings tab, turn on **Enable Persistent Overlay** so the graph stays on top of the browser, and **Record all captured metrics to CSV file** to compare runs afterwards on a computer.

### Phone VR (Cardboard-style viewers, iPhone included)

Phones without WebXR (iPhone Safari, the iOS app) get **phone VR** from the same **VR** button: two eye views side by side for a $15–30 phone viewer, head tracking from the phone's motion sensors (iOS asks for Motion & Orientation access), and the same cockpit, dashboard instruments and glareshield messages as the headset mode. Fly with a Bluetooth game controller (Xbox, PlayStation, Switch Pro or MFi). Tap the screen, or the viewer's button, to recenter; double-tap to leave. Eye spacing and field of view are adjustable for different phones and lenses. Add the site to the Home Screen first for a full-screen view on iPhone.

## Run locally

```bash
python tools/serve.py        # http://localhost:8765 (no-cache dev server)
node tools/test-fdm.mjs      # headless flight-model checks against C172 book numbers
node tools/test-vr.mjs       # VR on headsets: headset detection, when to suggest Low, the VR test flags, pinch-control maths
node tools/test-debrief.mjs  # instructor's notes: the recorder, each mistake rule on synthetic approaches, the callouts
npm test                     # both
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
                         nav.js, weather.js, input.js, audio.js, checklists.js, lessons.js, main.js,
                         gfx.js (Graphics presets Low/High/Ultra, textures made in code, sun glare, Ultra's bloom),
                         realworld.js (Real World mode: terrain, aerial photos and airports for a real place),
                         headset.js (VR on standalone headsets: the Low-for-VR suggestion, VR test flags, pinch-control maths)
                         debrief.js (the flight recorder, the mistake finder and the callouts: the instructor's notes)
assets/data/airports/    real US airports, runways, frequencies and VORs per 1° square (OurAirports)
assets/js/prep/prep.js   prep app
assets/data/questions.json  question bank
tools/                   dev server, tests, and build-airports.mjs (the Real World airport data)
```

## Disclaimer

Study aid only. Not FAA-approved training and not for real-world navigation. Not affiliated with Sporty's, King Schools, FLY8MA, Laminar Research, Microsoft or the FlightGear project. Practice questions are written from public FAA references (AIM, 14 CFR, PHAK).

## License

MIT
