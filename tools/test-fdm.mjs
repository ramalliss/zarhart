// Headless checks of the Zarhart flight model against Cessna 172N book numbers.
// Run: node tools/test-fdm.mjs
import { Aircraft, FT, KT } from "../assets/js/sim/fdm.js";
import { groundAt, AIRPORTS, heightAt } from "../assets/js/sim/world-data.js";

const weather = { qnhInHg: 29.92, tempC: 15, dewC: 5, isaDev: 0 };
const env = { ground: groundAt, wind: () => ({ x: 0, y: 0, z: 0 }), weather };
const kzar = AIRPORTS[0];
const out = [];
const log = (k, v, book) => out.push(`${k.padEnd(38)} ${String(v).padStart(9)}   ${book ?? ""}`);

function pid(kp, ki, kd) { let i = 0, prev = null; return (err, dt) => { i = Math.max(-5, Math.min(5, i + err * dt)); const d = prev == null ? 0 : (err - prev) / dt; prev = err; return kp * err + ki * i + kd * d; }; }
function fly(a, secs, ctl) { const dt = 1 / 60; for (let t = 0; t < secs; t += dt) { ctl(a, dt, t); a.step(dt); if (a.crashed) return t; } return secs; }
function holdAttitude(targetPitch, targetBank) {
  const pp = pid(0.06, 0.03, 0.02), rp = pid(0.035, 0.004, 0.01), yp = pid(0.15, 0.02, 0);
  return (a, dt) => {
    const d = a.derived;
    a.ctl.elevator = Math.max(-1, Math.min(1, pp(targetPitch() - d.pitch, dt)));
    a.ctl.aileron = Math.max(-1, Math.min(1, rp(targetBank() - d.bank, dt)));
    a.ctl.rudder = Math.max(-1, Math.min(1, yp(d.ball, dt)));
  };
}

// 1. Parked on the runway
{
  const a = new Aircraft(env); a.reset({ x: -700, z: 0, hdg: 90, onGround: true });
  fly(a, 6, () => {});
  log("Parked: height above runway (m)", (a.pos.y - kzar.elev).toFixed(3), "~1.25");
  log("Parked: ground speed (kt)", (Math.hypot(a.vel.x, a.vel.z) / KT).toFixed(2), "0");
  log("Parked: crashed?", a.crashed ? a.crashed.reason : "no");
}

// 2. Takeoff roll and Vy climb
let climb;
{
  const a = new Aircraft(env); a.reset({ x: -720, z: 0, hdg: 90, onGround: true });
  a.parkingBrake = false; a.ctl.throttle = 1; a.flapsSet = 0; a.flaps = 0;
  const x0 = a.pos.x; let liftoffX = null, liftoffKias = null;
  const ap = pid(0.06, 0.02, 0.02);
  let phase = "roll";
  fly(a, 120, (ac, dt) => {
    const d = ac.derived;
    ac.ctl.rudder = Math.max(-1, Math.min(1, -0.04 * ac.pos.z - 0.6 * ac.vel.z / 10 - 0.02 * ((d.hdg - 90 + 540) % 360 - 180)));
    if (phase === "roll") { ac.ctl.elevator = d.ias > 52 ? 0.45 : 0; if (d.ias > 30 && !ac.onGround) { phase = "climb"; liftoffX = ac.pos.x; liftoffKias = d.ias; } }
    else {
      const tgtPitch = 6 + (d.ias - 74) * 0.6;
      ac.ctl.elevator = Math.max(-1, Math.min(1, ap(tgtPitch - d.pitch, dt)));
      ac.ctl.aileron = Math.max(-1, Math.min(1, -0.03 * d.bank));
      ac.ctl.rudder = Math.max(-1, Math.min(1, 0.4 * d.ball));
    }
  });
  log("Takeoff: ground roll (ft)", liftoffX ? Math.round((liftoffX - x0) / FT) : "none", "book ~720 ft");
  log("Takeoff: liftoff (KIAS)", liftoffKias ? liftoffKias.toFixed(0) : "-", "~50-55");
  const d = a.derived;
  log("Climb at ~74 KIAS: rate (fpm)", Math.round(d.vsTrue), "book ~770 fpm SL");
  log("Climb: IAS / alt (ft)", `${d.ias.toFixed(0)} / ${Math.round(d.altInd)}`);
  log("Climb: rpm / rudder for ball", `${Math.round(d.rpm)} / ${a.ctl.rudder.toFixed(2)}`, "needs right rudder (+)");
  log("Climb: crashed?", a.crashed ? a.crashed.reason : "no");
  climb = a;
}

// 3. Level flight at 3,000 ft — full throttle top speed, then 2,400 rpm cruise
function levelAt(throttle, altFt = 3000, secs = 160) {
  const a = new Aircraft(env); a.reset({ x: 0, z: 0, hdg: 90, onGround: false, altFt, kias: 100 });
  a.ctl.throttle = throttle; a.ctl.trim = 0;
  const altP = pid(0.012, 0.002, 0.02);
  const hold = holdAttitude(() => Math.max(-5, Math.min(10, altP(altFt - a.derived.altTrue, 1 / 60) * 20)), () => 0);
  fly(a, secs, hold);
  return a;
}
{
  const a = levelAt(1);
  log("Full throttle level @3,000 ft (KTAS)", a.derived.tas.toFixed(0), "book ~122 KTAS");
  log("  rpm", Math.round(a.derived.rpm), "~2,650 (redline 2,700)");
  const b = levelAt(0.68);
  log("Throttle 68% level (KIAS / rpm)", `${b.derived.ias.toFixed(0)} / ${Math.round(b.derived.rpm)}`, "~100 kt @ ~2,350");
  log("  fuel flow (gph)", b.derived.fuelFlow.toFixed(1), "~7-8");
}

// 4. Stall speeds (power idle, slow 1 kt/s)
function stallSpeed(flaps) {
  const a = new Aircraft(env); a.reset({ x: 0, z: 0, hdg: 90, onGround: false, altFt: 5000, kias: 70, flaps });
  a.ctl.throttle = 0; a.flapsSet = flaps; a.flaps = flaps;
  let stallIas = null, warnIas = null;
  const altP = pid(0.012, 0.0, 0.02);
  let pitchCmd = 2;
  fly(a, 120, (ac, dt) => {
    const d = ac.derived;
    pitchCmd += dt * 0.35;
    ac.ctl.elevator = Math.max(-1, Math.min(1, 0.08 * (pitchCmd - d.pitch) - 0.25 * ac.w.y));
    ac.ctl.aileron = Math.max(-1, Math.min(1, -0.03 * d.bank));
    ac.ctl.rudder = Math.max(-1, Math.min(1, 0.4 * d.ball));
    if (warnIas == null && d.stallWarn) warnIas = d.ias;
    if (stallIas == null && d.stalled) stallIas = d.ias;
  });
  return { stallIas, warnIas, a };
}
{
  const s0 = stallSpeed(0), s30 = stallSpeed(30);
  log("Stall, flaps up (KIAS)", s0.stallIas?.toFixed(0), "book Vs1 ~44-47");
  log("  stall warning at (KIAS)", s0.warnIas?.toFixed(0), "5-10 kt above stall");
  log("Stall, flaps 30 (KIAS)", s30.stallIas?.toFixed(0), "book Vs0 ~41");
}

// 5. Power-off glide at 68 KIAS
{
  const a = new Aircraft(env); a.reset({ x: 0, z: 0, hdg: 90, onGround: false, altFt: 6000, kias: 68 });
  a.ctl.throttle = 0; a.eng.running = false; a.eng.mags = "off";
  const sp = pid(0.5, 0.05, 0.1);
  const hold = holdAttitude(() => Math.max(-10, Math.min(8, -sp(68 - a.derived.ias, 1 / 60))), () => 0);
  fly(a, 90, hold);
  const d = a.derived;
  log("Engine-out glide @68 KIAS: descent (fpm)", Math.round(d.vsTrue), "book ~ -700");
  log("  glide ratio", (d.gs * KT / (-d.vsTrue * FT / 60)).toFixed(1), "book ~9:1");
}

// 6. Level 45° and 60° bank turns: load factor
for (const bank of [45, 60]) {
  const a = new Aircraft(env); a.reset({ x: 0, z: 0, hdg: 0, onGround: false, altFt: 4000, kias: 100 });
  a.ctl.throttle = bank === 60 ? 1 : 0.85;
  const altP = pid(0.02, 0.004, 0.03);
  const hold = holdAttitude(() => Math.max(-5, Math.min(18, 3 + altP(4000 - a.derived.altTrue, 1 / 60) * 15)), () => bank);
  fly(a, 60, hold);
  log(`${bank}° bank level turn: load factor (G)`, a.derived.g.toFixed(2), bank === 45 ? "theory 1.41" : "theory 2.00");
  log(`  turn rate (°/s) / alt (ft)`, `${(a.derived.tc * 3).toFixed(1)} / ${Math.round(a.derived.altTrue)}`);
}

// 7. Hands-off: trimmed cruise, controls released for 40 s (no rudder)
{
  const a = new Aircraft(env); a.reset({ x: 0, z: 0, hdg: 90, onGround: false, altFt: 4000, kias: 100 });
  a.ctl.throttle = 0.68; a.ctl.trim = 0.0;
  fly(a, 40, (ac) => { ac.ctl.elevator = 0; ac.ctl.aileron = 0; ac.ctl.rudder = 0; });
  log("Hands-off 40 s: bank / hdg change (deg)", `${a.derived.bank.toFixed(1)} / ${((a.derived.hdg - 90 + 540) % 360 - 180).toFixed(0)}`, "slow drift, no spiral");
  log("  vs (fpm) / ias", `${Math.round(a.derived.vsTrue)} / ${a.derived.ias.toFixed(0)}`);
}
// 8. Hands-off full-power climb, no rudder: how fast does it roll off?
{
  const a = new Aircraft(env); a.reset({ x: 0, z: 0, hdg: 90, onGround: false, altFt: 2000, kias: 75, pitch: 7 });
  a.ctl.throttle = 1; a.ctl.trim = 0.35;
  fly(a, 30, (ac) => { ac.ctl.elevator = 0; ac.ctl.aileron = 0; ac.ctl.rudder = 0; });
  log("Hands-off climb 30 s: bank / hdg change", `${a.derived.bank.toFixed(1)} / ${((a.derived.hdg - 90 + 540) % 360 - 180).toFixed(0)}`, "drifts left slowly");
}

console.log(out.join("\n"));
