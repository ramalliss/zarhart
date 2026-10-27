// Weather, wind field, time of day, METAR/ATIS text.
import { simplex, heightAt, AIRPORTS } from "./world-data.js";
import { KT, FT, RWY_COND } from "./fdm.js";
export { RWY_COND };

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const PHONETIC = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu"];

export const PRESETS = {
  clear: { label: "Clear and calm", windDir: 270, windKt: 4, gustKt: 0, turb: 0.05, visSM: 10, clouds: [], tempC: 18, dewC: 6, qnhInHg: 30.02 },
  scattered: { label: "Scattered, breezy", windDir: 260, windKt: 11, gustKt: 17, turb: 0.25, visSM: 10, clouds: [{ cover: "SCT", baseFt: 4500 }], tempC: 21, dewC: 10, qnhInHg: 29.96 },
  marginal: { label: "Marginal VFR", windDir: 200, windKt: 8, gustKt: 0, turb: 0.15, visSM: 4, clouds: [{ cover: "BKN", baseFt: 2200 }], tempC: 12, dewC: 10, qnhInHg: 29.84 },
  crosswind: { label: "Gusty crosswind", windDir: 220, windKt: 14, gustKt: 21, turb: 0.4, visSM: 10, clouds: [{ cover: "FEW", baseFt: 5500 }], tempC: 16, dewC: 4, qnhInHg: 29.88 },
  humid: { label: "Humid (carb ice)", windDir: 180, windKt: 6, gustKt: 0, turb: 0.1, visSM: 6, clouds: [{ cover: "SCT", baseFt: 3500 }], tempC: 13, dewC: 11, qnhInHg: 29.9 },
  hot: { label: "Hot day (high density altitude)", windDir: 240, windKt: 6, gustKt: 0, turb: 0.2, visSM: 10, clouds: [{ cover: "FEW", baseFt: 8000 }], tempC: 38, dewC: 12, qnhInHg: 29.82 },
  overcast: { label: "Overcast (stay below!)", windDir: 300, windKt: 9, gustKt: 0, turb: 0.15, visSM: 7, clouds: [{ cover: "OVC", baseFt: 3200 }], tempC: 9, dewC: 4, qnhInHg: 30.12 },
  calm: { label: "Dead calm (no wind at all)", windDir: 0, windKt: 0, gustKt: 0, turb: 0, visSM: 10, clouds: [], tempC: 15, dewC: 9, qnhInHg: 30.08 },
  fog: { label: "Calm morning fog (radiation fog)", windDir: 0, windKt: 0, gustKt: 0, turb: 0, visSM: 0.75, clouds: [{ cover: "OVC", baseFt: 300 }], tempC: 8, dewC: 8, qnhInHg: 30.14 },
  gusty: { label: "Strong gusty wind", windDir: 280, windKt: 18, gustKt: 30, turb: 0.6, visSM: 10, clouds: [{ cover: "SCT", baseFt: 5000 }], tempC: 14, dewC: 2, qnhInHg: 29.74 },
  rain: { label: "Rain showers (wet runway)", windDir: 240, windKt: 9, gustKt: 0, turb: 0.2, visSM: 4, clouds: [{ cover: "BKN", baseFt: 2500 }, { cover: "OVC", baseFt: 5000 }], tempC: 14, dewC: 12, qnhInHg: 29.78, precip: "rain", precipRate: 0.6 },
  heavyrain: { label: "Heavy rain (standing water)", windDir: 220, windKt: 12, gustKt: 20, turb: 0.4, visSM: 2, clouds: [{ cover: "OVC", baseFt: 1500 }], tempC: 17, dewC: 16, qnhInHg: 29.66, precip: "rain", precipRate: 1 },
  storm: { label: "Thunderstorm nearby (microburst)", windDir: 250, windKt: 10, gustKt: 24, turb: 0.5, visSM: 5, clouds: [{ cover: "BKN", baseFt: 3000 }], tempC: 27, dewC: 19, qnhInHg: 29.7, precip: "rain", precipRate: 0.5, microburst: { x: 4000, z: 0, r: 900, kt: 22, fpm: 1200 } },
  snow: { label: "Light snow (snow on the runway)", windDir: 330, windKt: 8, gustKt: 0, turb: 0.15, visSM: 3, clouds: [{ cover: "OVC", baseFt: 2800 }], tempC: -3, dewC: -5, qnhInHg: 30.18, precip: "snow", precipRate: 0.5, snowCover: true },
  frost: { label: "Frosty morning (frost on the wings)", windDir: 320, windKt: 5, gustKt: 0, turb: 0.05, visSM: 10, clouds: [], tempC: -6, dewC: -8, qnhInHg: 30.31, snowCover: true, rwy: "snow", frost: true },
  freezing: { label: "Freezing rain (icing)", windDir: 90, windKt: 7, gustKt: 0, turb: 0.2, visSM: 3, clouds: [{ cover: "OVC", baseFt: 1800 }], tempC: -2, dewC: -3, qnhInHg: 29.92, precip: "fzra", precipRate: 0.6, rwy: "ice" },
};
const RWY_FROM_PRECIP = { rain: (r) => (r >= 0.9 ? "water" : "wet"), snow: () => "snow", fzra: () => "ice" };
const fracSM = (v) => (v <= 0.25 ? "1/4" : v <= 0.5 ? "1/2" : "3/4");

export class Weather {
  constructor() {
    this.home = AIRPORTS[0];
    this.set(PRESETS.scattered);
    this.hour = 14;
    this.extraWind = []; // functions (x,y,z,t) -> {x,y,z} (e.g. wake vortices)
    this.atisIndex = 0;
  }
  set(p) {
    Object.assign(this, JSON.parse(JSON.stringify({ windDir: p.windDir, windKt: p.windKt, gustKt: p.gustKt, turb: p.turb, visSM: p.visSM, clouds: p.clouds, tempC: p.tempC, dewC: p.dewC, qnhInHg: p.qnhInHg })));
    // precipitation (none | rain | snow | fzra), how hard (0–1), the runway it leaves, and snow on the ground
    this.precip = p.precip || "none"; this.precipRate = p.precip ? p.precipRate ?? 0.6 : 0;
    this.rwy = p.rwy || RWY_FROM_PRECIP[this.precip]?.(this.precipRate) || "dry";
    this.snowCover = !!(p.snowCover || this.precip === "snow");
    this.microburst = p.microburst ? { ...p.microburst } : null;
    this.frost = !!p.frost; // frost on the parked airplane's wings at the next spawn
    this.atisIndex = ((this.atisIndex ?? -1) + 1) % 26;
  }
  /** what the flight model reads */
  get state() {
    return { qnhInHg: this.qnhInHg, tempC: this.tempC, dewC: this.dewC, isaDev: this.tempC - (15 - 1.98 * this.home.elevFt / 1000), rwy: this.rwy, precip: this.precip };
  }
  cloudLayersMsl() { return this.clouds.map((c) => ({ cover: c.cover, baseMsl: (this.home.elevFt + c.baseFt) * FT })); }
  /** air velocity (m/s, direction the air moves toward) */
  windAt(x, y, z, t) {
    const agl = Math.max(1, y - heightAt(x, z));
    const shear = clamp(Math.log(agl / 0.05) / Math.log(10 / 0.05), 0.25, 1.35);
    const gust = this.gustKt > this.windKt ? Math.max(0, simplex(t * 0.11, 3.7)) * (this.gustKt - this.windKt) * 1.3 : 0;
    const spd = (this.windKt + gust) * KT * shear;
    const to = (this.windDir + 180) * DEG;
    let wx = Math.sin(to) * spd, wz = -Math.cos(to) * spd, wy = 0;
    // turbulence grows with wind, near terrain and over the mountains
    const ti = this.turb * (0.6 + this.windKt / 20) * (agl < 600 ? 1.2 : 0.8) + (z < -12000 ? 0.4 * this.windKt / 15 : 0);
    if (ti > 0) {
      const s = 1 / 180, ts = 0.35;
      wx += simplex(x * s + t * ts, z * s) * 2.2 * ti;
      wz += simplex(x * s - 40, z * s + t * ts) * 2.2 * ti;
      wy += simplex(x * s + 90, z * s - t * ts) * 1.6 * ti;
    }
    for (const f of this.extraWind) { const e = f(x, y, z, t); wx += e.x; wy += e.y; wz += e.z; }
    if (this.microburst) { const m = this.microburstAt(x, z, agl); wx += m.x; wy += m.y; wz += m.z; }
    return { x: wx, y: wy, z: wz };
  }
  /**
   * A microburst (AIM 7-1-24): air falling out of a storm and spreading along the ground. Flying through it you
   * first get a headwind (airspeed and climb go up), then the downdraft, then a tailwind (airspeed falls away).
   */
  microburstAt(x, z, agl) {
    const m = this.microburst, dx = x - m.x, dz = z - m.z, r = Math.hypot(dx, dz) || 1, u = r / m.r;
    const out = m.kt * KT * u * Math.exp(0.5 * (1 - u * u)) * clamp(agl / 40, 0, 1) * Math.exp(-agl / 700); // outflow, strongest low down
    const down = -(m.fpm * FT / 60) * Math.exp(-u * u) * clamp(agl / 120, 0.15, 1);
    return { x: (dx / r) * out, y: down, z: (dz / r) * out };
  }
  /** runway with the most headwind at an airport */
  activeRunway(ap) {
    if (this.windKt < 3 && ap.calmRwy) for (const r of ap.runways) for (const e of r.ends) if (e.id === ap.calmRwy) return { rwy: r, end: e }; // calm-wind runway
    let best = null, bh = -Infinity;
    for (const r of ap.runways) if (!r.closed) for (const e of r.ends) { const h = Math.cos((this.windDir - e.hdg) * DEG); if (h > bh) { bh = h; best = { rwy: r, end: e }; } }
    return best;
  }
  components(rwyHdg) {
    const a = (this.windDir - rwyHdg) * DEG;
    return { head: Math.round(this.windKt * Math.cos(a)), cross: Math.round(this.windKt * Math.sin(a)) };
  }
  zulu(simHour) { const z = (simHour + 5 + 24) % 24; const hh = Math.floor(z), mm = Math.floor((z - hh) * 60); return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`; }
  metar(ap = this.home, hour = this.hour) {
    const day = String(new Date().getDate()).padStart(2, "0");
    const t = (v) => (v < 0 ? "M" : "") + String(Math.abs(Math.round(v))).padStart(2, "0");
    const dir = this.windKt < 3 ? "00000KT" : `${String(Math.round(this.windDir / 10) * 10 || 360).padStart(3, "0")}${String(Math.round(this.windKt)).padStart(2, "0")}${this.gustKt > this.windKt ? "G" + Math.round(this.gustKt) : ""}KT`;
    const vis = `${this.visSM >= 10 ? 10 : this.visSM < 1 ? fracSM(this.visSM) : this.visSM}SM`;
    const wx = this.wxCode();
    const cl = this.clouds.length ? this.clouds.map((c) => `${c.cover}${String(Math.round(c.baseFt / 100)).padStart(3, "0")}`).join(" ") : "CLR";
    return `${ap.id} ${day}${this.zulu(hour)}Z ${dir} ${vis}${wx ? " " + wx : ""} ${cl} ${t(this.tempC)}/${t(this.dewC)} A${Math.round(this.qnhInHg * 100)}`;
  }
  /** present weather for the METAR: storms nearby, intensity + precipitation, then fog or mist */
  wxCode() {
    const k = [];
    if (this.microburst) k.push("VCTS");
    if (this.precip !== "none") k.push((this.precipRate < 0.45 ? "-" : this.precipRate >= 0.9 ? "+" : "") + { rain: "RA", snow: "SN", fzra: "FZRA" }[this.precip]);
    if (this.visSM < 0.625) k.push("FG"); else if (this.visSM <= 6 && this.tempC - this.dewC <= 2 && this.precip === "none") k.push(this.visSM < 1 ? "FG" : "BR");
    return k.join(" ");
  }
  atis(ap = this.home, hour = this.hour) {
    const letter = PHONETIC[this.atisIndex];
    const act = this.activeRunway(ap);
    const sky = this.clouds.length ? this.clouds.map((c) => `${{ FEW: "few clouds", SCT: "scattered", BKN: "ceiling broken", OVC: "ceiling overcast" }[c.cover]} ${c.baseFt.toLocaleString()}`).join(", ") : "";
    const showSky = !(this.visSM >= 5 && (!this.clouds.some((c) => c.cover === "BKN" || c.cover === "OVC") || this.clouds.every((c) => c.baseFt >= 5000)));
    const wind = this.windKt < 3 ? "wind calm" : `wind ${String(Math.round(this.windDir / 10) * 10).padStart(3, "0")} at ${Math.round(this.windKt)}${this.gustKt > this.windKt ? `, gusts ${Math.round(this.gustKt)}` : ""}`;
    const parts = [
      `${ap.name} information ${letter}, ${this.zulu(hour)} Zulu.`,
      `${wind[0].toUpperCase() + wind.slice(1)}.`,
      showSky ? `Visibility ${this.visSM >= 10 ? "1 0" : this.visSM}. ${sky ? sky[0].toUpperCase() + sky.slice(1) + "." : "Sky clear."}` : "",
      `Temperature ${Math.round(this.tempC)}, dew point ${Math.round(this.dewC)}.`,
      `Altimeter ${this.qnhInHg.toFixed(2)}.`,
      this.precip !== "none" ? `${{ rain: "Rain", snow: "Snow", fzra: "Freezing rain" }[this.precip]}${this.precipRate >= 0.9 ? ", heavy" : this.precipRate < 0.45 ? ", light" : ""}.` : "",
      `Landing and departing runway ${act.end.id}${this.windKt < 3 && ap.calmRwy ? ", the calm-wind runway" : ""}.`,
      this.rwy !== "dry" ? `Runway condition: ${{ wet: "wet", water: "standing water, braking action poor", snow: "snow covered, braking action poor", ice: "ice, braking action nil" }[this.rwy]}.` : "",
      this.microburst ? "Thunderstorm in the vicinity. Wind shear and microburst alerts in effect." : "",
      ap.id === "KZAR" ? "Runway 18 36 intersects runway 9 27: hold short of the intersecting runway when instructed." : "",
      Math.abs(this.tempC - this.dewC) < 3 ? "Temperature dew point spread is narrow. Watch for fog and carburetor ice." : "",
      this.tempC <= 2 && (this.precip !== "none" || this.clouds.some((c) => c.cover === "BKN" || c.cover === "OVC")) ? "Icing conditions: stay out of clouds and precipitation." : "",
      `Advise on initial contact you have information ${letter}.`,
    ];
    return { letter, text: parts.filter(Boolean).join(" "), skyOmitted: !showSky };
  }
}
