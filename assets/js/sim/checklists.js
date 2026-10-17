// C172-style checklists. Items with a `check` tick themselves from the sim state; the rest are ticked by hand.
// s = { ac, d, flags } where flags tracks run-up checks and radio calls.
const near = (a, b, tol) => Math.abs(a - b) <= tol;

export const CHECKLISTS = [
  { id: "start", name: "Before start & engine start", items: [
    { t: "Preflight inspection: COMPLETE (from the POH)" },
    { t: "Seats, belts, harnesses: ADJUSTED & LOCKED, passengers briefed", exam: "t30" },
    { t: "Fuel selector: BOTH", check: (s) => s.ac.eng.selector === "both" },
    { t: "Parking brake: SET", check: (s) => s.ac.parkingBrake },
    { t: "Mixture: RICH", check: (s) => s.ac.eng.mixture > 0.95 },
    { t: "Carburetor heat: COLD", check: (s) => !s.ac.eng.carbHeat },
    { t: "Throttle: OPEN ¼ inch", check: (s) => s.ac.ctl.throttle > 0.03 && s.ac.ctl.throttle < 0.2 },
    { t: "Master switch: ON", check: (s) => s.ac.elec.master },
    { t: "Beacon: ON", check: (s) => s.ac.elec.lights.beacon },
    { t: "Propeller area: CLEAR (shout “Clear!”)" },
    { t: "Ignition: START, then BOTH when running", check: (s) => s.ac.eng.running && s.ac.eng.mags === "both" },
    { t: "Oil pressure: GREEN within 30 s", check: (s) => s.ac.eng.running && s.d.oilP > 0.4 },
    { t: "Avionics master: ON", check: (s) => s.ac.elec.avionics },
  ] },
  { id: "taxi", name: "Before taxi", items: [
    { t: "ATIS: RECEIVED (tune 127.85 at KZAR)", check: (s) => s.flags.atis },
    { t: "Altimeter: SET to the ATIS setting", check: (s) => near(s.ac.inst.kollsman, s.qnh, 0.011), exam: "t4" },
    { t: "Heading indicator: SET to the magnetic compass", check: (s) => near(((s.d.hi - s.d.compass + 540) % 360) - 180, 0, 3), exam: "t50" },
    { t: "Attitude indicator: miniature airplane on the horizon bar", exam: "t31" },
    { t: "Transponder: 1200, ALT", check: (s) => s.ac.xpdr.code === "1200" && s.ac.xpdr.mode === "ALT" },
    { t: "Taxi light: ON", check: (s) => s.ac.elec.lights.taxi },
    { t: "Brakes: CHECK as you start rolling" },
  ] },
  { id: "runup", name: "Run-up", items: [
    { t: "Parking brake: SET", check: (s) => s.ac.parkingBrake },
    { t: "Throttle: 1,700 RPM", check: (s) => s.d.rpm > 1620 && s.d.rpm < 1800 },
    { t: "Magnetos: CHECK L and R (drop ≤ 125 RPM, ≤ 50 RPM difference)", check: (s) => s.flags.magL && s.flags.magR },
    { t: "Carburetor heat: CHECK (RPM drops)", check: (s) => s.flags.carbChk },
    { t: "Suction: 4.5–5.4 in Hg", check: (s) => s.d.suction >= 4.5 && s.d.suction <= 5.5 },
    { t: "Engine instruments and ammeter: CHECK", check: (s) => s.d.oilP > 0.4 && s.d.amps >= 0 },
    { t: "Flight controls: FREE & CORRECT", check: (s) => s.flags.ctrlFull },
    { t: "Trim: TAKEOFF", check: (s) => near(s.ac.ctl.trim, 0.12, 0.12) },
    { t: "Throttle: IDLE", check: (s) => s.ac.ctl.throttle < 0.05 },
  ] },
  { id: "takeoff", name: "Before takeoff & takeoff", items: [
    { t: "Flaps: 0–10°", check: (s) => s.ac.flapsSet <= 10 },
    { t: "Strobes & landing light: ON", check: (s) => s.ac.elec.lights.strobe && s.ac.elec.lights.landing },
    { t: "Mixture: RICH (lean only above 3,000 ft density altitude)", check: (s) => s.ac.eng.mixture > 0.95 || s.d.densAlt > 3000 },
    { t: "Parking brake: RELEASE", check: (s) => !s.ac.parkingBrake },
    { t: "Takeoff clearance / CTAF call: MADE", check: (s) => s.flags.departCall },
    { t: "Throttle: FULL OPEN, check ~2,300 RPM static", check: (s) => s.ac.ctl.throttle > 0.97 },
    { t: "Rotate at 55 KIAS", check: (s) => !s.d.onGround && s.flags.airborneOnce },
    { t: "Climb at Vy 74 KIAS (Vx 59 for obstacles)", check: (s) => !s.d.onGround && s.d.agl > 150 && near(s.d.ias, 74, 6), exam: "t16" },
  ] },
  { id: "cruise", name: "Climb & cruise", items: [
    { t: "Climb: 70–85 KIAS, full throttle, watch oil temperature" },
    { t: "Cruise power: 2,100–2,400 RPM", check: (s) => s.d.rpm > 2100 && s.d.rpm < 2450 && !s.d.onGround },
    { t: "Mixture: LEAN for smooth running / peak RPM", check: (s) => s.ac.eng.mixture < 0.97 && s.d.densAlt > 3000 },
    { t: "Heading indicator: RESET to compass every ~15 min", exam: "t50" },
    { t: "VFR cruising altitude: odd+500 heading 0–179°, even+500 heading 180–359°", exam: "e10" },
    { t: "Carb ice? RPM loss → carb heat ON", exam: "e41" },
  ] },
  { id: "landing", name: "Descent & before landing", items: [
    { t: "ATIS / AWOS: RECEIVED; altimeter SET", check: (s) => near(s.ac.inst.kollsman, s.qnh, 0.011) },
    { t: "CTAF / tower call ~10 NM out", check: (s) => s.flags.inboundCall, exam: "t1" },
    { t: "Fuel selector: BOTH", check: (s) => s.ac.eng.selector === "both" },
    { t: "Mixture: RICH", check: (s) => s.ac.eng.mixture > 0.95 },
    { t: "Carburetor heat: ON before reducing power", check: (s) => s.ac.eng.carbHeat },
    { t: "Landing light: ON", check: (s) => s.ac.elec.lights.landing },
    { t: "Flaps: as required below 85 KIAS (white arc)", check: (s) => s.ac.flapsSet > 0 && s.d.ias < 86 },
    { t: "Approach speed: 65–70 KIAS", check: (s) => !s.d.onGround && s.d.agl < 800 && near(s.d.ias, 67, 5) },
  ] },
  { id: "after", name: "After landing & shutdown", items: [
    { t: "Flaps: UP", check: (s) => s.ac.flapsSet === 0 && s.d.onGround },
    { t: "Carburetor heat: COLD", check: (s) => !s.ac.eng.carbHeat && s.d.onGround },
    { t: "Transponder: STBY", check: (s) => s.ac.xpdr.mode === "STBY" },
    { t: "Strobes & landing light: OFF", check: (s) => !s.ac.elec.lights.strobe && !s.ac.elec.lights.landing },
    { t: "Parking brake: SET", check: (s) => s.ac.parkingBrake && s.d.gs < 1 },
    { t: "Avionics: OFF", check: (s) => !s.ac.elec.avionics },
    { t: "Mixture: IDLE CUTOFF", check: (s) => s.ac.eng.mixture < 0.08 },
    { t: "Magnetos: OFF, key out", check: (s) => s.ac.eng.mags === "off" },
    { t: "Master: OFF", check: (s) => !s.ac.elec.master },
  ] },
];

export function suggestChecklist(s) {
  const d = s.d, ac = s.ac;
  if (d.onGround) {
    if (!ac.eng.running) return ac.elec.master || s.flags.everRan ? "after" : "start";
    if (s.flags.everAirborne) return "after";
    if (!s.flags.atis && d.gs < 1) return "taxi";
    if (ac.parkingBrake && d.rpm > 1200) return "runup";
    return d.gs > 2 && !s.flags.runupDone ? "taxi" : "takeoff";
  }
  if (d.agl < 1600 && d.vsi < -200) return "landing";
  if (d.agl < 400 && d.vsi > 0) return "takeoff";
  return "cruise";
}
