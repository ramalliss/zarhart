// Weather, wind field, time of day, METAR/ATIS text.
import { simplex, heightAt, AIRPORTS } from "./world-data.js";
import { KT, FT } from "./fdm.js";

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
};

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
    this.atisIndex = ((this.atisIndex ?? -1) + 1) % 26;
  }
  /** what the flight model reads */
  get state() {
    return { qnhInHg: this.qnhInHg, tempC: this.tempC, dewC: this.dewC, isaDev: this.tempC - (15 - 1.98 * this.home.elevFt / 1000) };
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
    return { x: wx, y: wy, z: wz };
  }
  /** runway with the most headwind at an airport */
  activeRunway(ap) {
    let best = null, bh = -Infinity;
    for (const r of ap.runways) for (const e of r.ends) { const h = Math.cos((this.windDir - e.hdg) * DEG); if (h > bh) { bh = h; best = { rwy: r, end: e }; } }
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
    const vis = `${this.visSM >= 10 ? 10 : this.visSM}SM`;
    const cl = this.clouds.length ? this.clouds.map((c) => `${c.cover}${String(Math.round(c.baseFt / 100)).padStart(3, "0")}`).join(" ") : "CLR";
    return `${ap.id} ${day}${this.zulu(hour)}Z ${dir} ${vis} ${cl} ${t(this.tempC)}/${t(this.dewC)} A${Math.round(this.qnhInHg * 100)}`;
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
      `Landing and departing runway ${act.end.id}.`,
      ap.id === "KZAR" ? "Runway 18 36 intersects runway 9 27: hold short of the intersecting runway when instructed." : "",
      Math.abs(this.tempC - this.dewC) < 3 ? "Temperature dew point spread is narrow. Watch for fog and carburetor ice." : "",
      `Advise on initial contact you have information ${letter}.`,
    ];
    return { letter, text: parts.filter(Boolean).join(" "), skyOmitted: !showSky };
  }
}
