// Calculation and decoding drills: freshly generated questions every time, with the work shown in the explanation.
// Each card looks like a question-bank card (c[0] is the right answer) plus drill: true, so the quiz runs it as is
// but doesn't count it in the per-question study history.

const DEG = Math.PI / 180;
const R = Math.random;
const pick = (a) => a[Math.floor(R() * a.length)];
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
const fmt3 = (d) => String(d).padStart(3, "0");
const comma = (n) => n.toLocaleString("en-US");
const norm = (h) => ((Math.round(h) % 360) + 360) % 360 || 360;
let seq = 0;

/** a card with the right answer first and two different wrong answers taken from `cands` */
function card(key, topic, q, right, cands, why, ref, code) {
  const wrong = [];
  for (const x of cands) if (x !== right && !wrong.includes(x)) wrong.push(x);
  if (wrong.length < 2) return null; // not enough distinct distractors: the caller makes another
  return { id: `d-${key}-${++seq}`, drill: true, src: "drill", topic, q, code, c: [right, wrong[0], wrong[1]], why, ref };
}
/** keep generating until a card comes out (a few combinations can't make three distinct choices) */
const retry = (fn) => { for (let i = 0; i < 50; i++) { const c = fn(); if (c) return c; } throw new Error("drill generator failed"); };

/* ---------------- METARs ---------------- */
const VIS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 10];
const visTxt = (v) => (v >= 10 ? "10" : { 0.25: "1/4", 0.5: "1/2", 0.75: "3/4", 1.5: "1 1/2", 2.5: "2 1/2" }[v] ?? String(v));
const visWords = (v) => (v >= 10 ? "10 SM or more" : `${visTxt(v)} SM`);
function genMetar() {
  const vis = pick(VIS);
  // layers rise, and each one's cover includes those below it (the summation principle), so cover never decreases going up
  const COV = ["FEW", "SCT", "BKN", "OVC"], layers = [], n = int(0, 3); let h = pick([3, 4, 5, 6, 8, 9, 12, 15, 20, 25, 30, 35, 45]), k = 0;
  for (let i = 0; i < n; i++) { k = Math.min(i === n - 1 ? 3 : 2, k + int(i ? 0 : 0, 1) + (i === 0 ? int(0, 1) : 0)); layers.push({ cover: COV[k], h }); h += pick([5, 8, 10, 15, 20, 30]); if (k === 3) break; }
  const wx = vis < 0.625 ? "FG" : vis <= 6 ? pick(["BR", "-RA", "RA", "-SN", "BR", "+RA"]) : "";
  const temp = int(-6, 32), dew = temp - (wx === "FG" || wx === "BR" ? int(0, 2) : int(1, 14));
  const wdir = int(1, 36) * 10, wspd = int(0, 24), gust = wspd >= 10 && R() < 0.4 ? wspd + int(6, 14) : 0;
  const wind = wspd < 3 ? "00000KT" : `${fmt3(wdir)}${String(wspd).padStart(2, "0")}${gust ? "G" + gust : ""}KT`;
  const t = (v) => (v < 0 ? "M" : "") + String(Math.abs(v)).padStart(2, "0");
  const sky = layers.length ? layers.map((l) => l.cover + fmt3(l.h)).join(" ") : "CLR";
  const text = `METAR ${pick(["KZAR", "KAME", "KSRH"])} ${String(int(1, 28)).padStart(2, "0")}${String(int(0, 23)).padStart(2, "0")}53Z ${wind} ${visTxt(vis)}SM${wx ? " " + wx : ""} ${sky} ${t(temp)}/${t(dew)} A${(2960 + int(0, 80))}`;
  const ceilLayer = layers.find((l) => l.cover === "BKN" || l.cover === "OVC");
  return { text, vis, ceil: ceilLayer ? ceilLayer.h * 100 : null, layers, wdir, wspd, gust };
}
/** VFR above 3,000 ft and 5 SM; MVFR 1,000–3,000 ft and/or 3–5 SM; IFR 500 to below 1,000 ft and/or 1 to below 3 SM; LIFR below that */
export function flightCategory(ceil, vis) {
  const c = ceil ?? Infinity;
  if (c < 500 || vis < 1) return "LIFR";
  if (c < 1000 || vis < 3) return "IFR";
  if (c <= 3000 || vis <= 5) return "MVFR";
  return "VFR";
}
const CAT_WHY = "VFR: ceiling above 3,000 ft and visibility above 5 SM. MVFR: ceiling 1,000 to 3,000 ft and/or visibility 3 to 5 SM. IFR: ceiling 500 to below 1,000 ft and/or visibility 1 to below 3 SM. LIFR: ceiling below 500 ft and/or visibility below 1 SM.";
function metarCard() {
  const m = genMetar(), ceilTxt = m.ceil ? `${comma(m.ceil)} ft AGL` : "No ceiling (no broken or overcast layer)";
  const ceilWhy = m.ceil ? `The ceiling is the lowest broken (BKN) or overcast (OVC) layer: ${comma(m.ceil)} ft above the ground. FEW and SCT layers don't count.` : "There's no broken or overcast layer, so there's no ceiling. FEW and SCT layers don't make one.";
  const kind = pick(["cat", "cat", "ceil", "wind", "classd"]);
  if (kind === "cat") {
    const cat = flightCategory(m.ceil, m.vis), order = ["LIFR", "IFR", "MVFR", "VFR"], i = order.indexOf(cat);
    return card("metar", "wx", "What is the flight category for this METAR?", cat, [order[i + 1], order[i - 1], order[i + 2], order[i - 2]].filter(Boolean),
      `${ceilWhy} Visibility is ${visWords(m.vis)}. ${CAT_WHY}`, "AC 00-45H", m.text);
  }
  if (kind === "ceil") {
    const others = [...m.layers.filter((l) => l.h * 100 !== m.ceil).map((l) => `${comma(l.h * 100)} ft AGL`), m.ceil ? "No ceiling (no broken or overcast layer)" : null, m.ceil ? `${comma(m.ceil * 10)} ft AGL` : null, m.layers[0] ? `${comma(m.layers[0].h * 1000)} ft AGL` : null].filter(Boolean);
    return card("metar", "wx", "What is the ceiling in this METAR?", ceilTxt, others, `${ceilWhy} Heights are in hundreds of feet: ${m.layers[0] ? `${m.layers[0].cover}${fmt3(m.layers[0].h)} is ${comma(m.layers[0].h * 100)} ft` : "CLR means no clouds below 12,000 ft at an automated station"}.`, "AC 00-45H", m.text);
  }
  if (kind === "wind") {
    if (m.wspd < 3) return card("metar", "wx", "What does the wind group in this METAR mean?", "The wind is calm", ["The wind is variable at 3 knots or less", "Wind data is missing", "The wind is from 000° (north) at 0 knots, gusting"], "00000KT means calm.", "AC 00-45H", m.text);
    const g = m.gust ? `, gusting to ${m.gust}` : "";
    return card("metar", "wx", "What does the wind group in this METAR mean?", `From ${fmt3(m.wdir)}° true at ${m.wspd} knots${g}`,
      [`From ${fmt3(m.wdir)}° magnetic at ${m.wspd} knots${g}`, `Toward ${fmt3(m.wdir)}° true at ${m.wspd} knots${g}`, m.gust ? `From ${fmt3(m.wdir)}° true at ${m.gust} knots, gusting to ${m.wspd}` : `From ${fmt3(norm(m.wdir + 180))}° true at ${m.wspd} knots`],
      "METAR and TAF winds are the direction the wind blows from, in degrees true, in knots, with any gusts after the G. ATIS and tower winds are magnetic.", "AC 00-45H", m.text);
  }
  const ok = (m.ceil == null || m.ceil >= 1000) && m.vis >= 3;
  return card("metar", "regs", "This is the METAR at a Class D airport. Can you take off VFR without a special VFR clearance?",
    ok ? "Yes: the ceiling is at least 1,000 ft and the visibility at least 3 SM" : "No: you need a special VFR clearance (or an IFR clearance)",
    ok ? ["No: you need a special VFR clearance (or an IFR clearance)", "No: VFR in Class D needs at least 5 SM visibility"] : ["Yes: you only need to stay clear of clouds", "Yes: Class D only needs 1 SM visibility"],
    `${ceilWhy} Visibility is ${visWords(m.vis)}. VFR in the surface area of Class D needs a ceiling of at least 1,000 ft and at least 3 SM ground visibility (14 CFR 91.155). Below that you need special VFR or IFR.`, "14 CFR 91.155", m.text);
}

/* ---------------- wind components ---------------- */
function windCard() {
  const rwy = int(1, 36), rhdg = rwy * 10, ang = pick([10, 20, 30, 40, 45, 50, 60, 70, 80]), side = R() < 0.5 ? -1 : 1;
  const wdir = norm(rhdg + side * ang), spd = int(8, 30);
  const xe = spd * Math.sin(ang * DEG), he = spd * Math.cos(ang * DEG);
  if ([xe, he].some((v) => Math.abs((v % 1) - 0.5) < 0.02)) return null; // a half knot rounds either way: pick other numbers
  const xw = Math.round(xe), hw = Math.round(he), head = R() < 0.3;
  const right = `${head ? hw : xw} knots`;
  const cands = [head ? xw : hw, Math.round(spd * ang / 90), spd, Math.round(spd / 2), (head ? hw : xw) + 4, Math.max(1, (head ? hw : xw) - 4)].map((v) => `${v} knots`);
  return card("wind", "perf", `Landing on runway ${String(rwy).padStart(2, "0")}, the ATIS wind is ${fmt3(wdir)} at ${spd} knots. What is the ${head ? "headwind" : "crosswind"} component?`, right, cands,
    `The wind is ${ang}° off the runway heading (${fmt3(rhdg)}°), from the ${side > 0 ? "right" : "left"}. Crosswind = ${spd} × sin ${ang}° ≈ ${xw} kt; headwind = ${spd} × cos ${ang}° ≈ ${hw} kt. Rule of thumb: 30° off puts half the wind across the runway, 45° about 70%, 60° about 90%.`, "PHAK ch. 11");
}

/* ---------------- pressure and density altitude ---------------- */
function daCard() {
  const elev = int(0, 60) * 100, setting = 29.62 + int(0, 60) / 100;
  if (Math.abs(setting - 29.92) < 0.005) return null;
  const pa = elev + Math.round((29.92 - setting) * 1000), alt = setting.toFixed(2);
  if (R() < 0.45) {
    return card("da", "perf", `Field elevation ${comma(elev)} ft, altimeter setting ${alt} inHg. What is the pressure altitude?`, `${comma(pa)} ft`,
      [`${comma(2 * elev - pa)} ft`, `${comma(elev)} ft`, `${comma(pa + 1000)} ft`].filter((s) => !s.startsWith("-")),
      `Pressure altitude = field elevation + (29.92 − altimeter setting) × 1,000 = ${comma(elev)} + (29.92 − ${alt}) × 1,000 = ${comma(pa)} ft. A setting below 29.92 means pressure altitude is higher than the field.`, "PHAK ch. 11");
  }
  const isa = 15 - 2 * pa / 1000, oat = int(-10, 38);
  if (Math.abs(oat - isa) < 5) return null;
  const da = Math.round((pa + 120 * (oat - isa)) / 100) * 100, wrongSign = Math.round((pa - 120 * (oat - isa)) / 100) * 100;
  return card("da", "perf", `Pressure altitude ${comma(pa)} ft, outside air temperature ${oat}°C. Using the rule of thumb of 120 ft per °C away from standard, the density altitude is about`, `${comma(da)} ft`,
    [`${comma(wrongSign)} ft`, `${comma(pa)} ft`, `${comma(da + 1500)} ft`].filter((s) => !s.startsWith("-") || da < 0),
    `Standard temperature at ${comma(pa)} ft is about 15 − 2 × ${(pa / 1000).toFixed(1)} = ${isa.toFixed(0)}°C. ${oat}°C is ${Math.abs(oat - isa).toFixed(0)}° ${oat > isa ? "warmer" : "colder"} than standard, so density altitude ≈ ${comma(pa)} ${oat > isa ? "+" : "−"} 120 × ${Math.abs(oat - isa).toFixed(0)} ≈ ${comma(da)} ft. Warmer air is thinner: higher density altitude, worse performance.`, "PHAK ch. 11");
}

/* ---------------- time, speed, distance and fuel ---------------- */
const hm = (h) => { const m = Math.round(h * 60); return m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} hour${m >= 120 ? "s" : ""}${m % 60 ? ` ${m % 60} minutes` : ""}`; };
function tsdCard() {
  const kind = pick(["time", "dist", "gs", "fuel", "reserve"]);
  if (kind === "fuel") {
    const burn = pick([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 11, 12]), t = pick([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]);
    const g = (x) => `${(Math.round(x * 10) / 10).toFixed(1)} gallons`;
    return card("tsd", "nav", `At ${burn} gallons per hour, how much fuel does a ${hm(t)} flight burn?`, g(burn * t), [g(burn * (t + 0.5)), g(burn * Math.max(0.25, t - 0.25)), g(burn * t * 1.5)],
      `Fuel = burn rate × time = ${burn} gal/h × ${t} h = ${g(burn * t)}.`, "PHAK ch. 16");
  }
  if (kind === "reserve") {
    const night = R() < 0.5, burn = pick([6.5, 7, 8, 8.5, 9, 10]), min = pick([40, 50, 55, 65, 70, 80, 95, 110]), res = night ? 45 : 30;
    const g = (m) => `${(Math.round(burn * m / 60 * 10) / 10).toFixed(1)} gallons`;
    return card("tsd", "regs", `A ${night ? "night" : "day"} VFR flight will take ${min} minutes at ${burn} gallons per hour. Including the required VFR fuel reserve, the minimum fuel at takeoff is`, g(min + res), [g(min), g(min + (night ? 30 : 45)), g(min + 60)],
      `14 CFR 91.151: enough fuel to reach the first point of intended landing plus ${night ? "45 minutes at night" : "30 minutes by day"} at normal cruise. (${min} + ${res}) min × ${burn} gal/h ÷ 60 = ${g(min + res)}.`, "14 CFR 91.151");
  }
  const gs = int(8, 15) * 10, min = pick([12, 15, 18, 20, 24, 30, 36, 40, 45, 48]), dist = gs * min / 60;
  if (!Number.isInteger(dist)) return null;
  if (kind === "time") return card("tsd", "nav", `How long does it take to fly ${dist} NM at a groundspeed of ${gs} knots?`, `${min} minutes`, [`${min + pick([5, 6, 8])} minutes`, `${Math.max(4, min - pick([4, 5, 7]))} minutes`, `${Math.round(min * 1.5)} minutes`],
    `Time = distance ÷ groundspeed = ${dist} ÷ ${gs} = ${(dist / gs).toFixed(2)} h × 60 = ${min} minutes.`, "PHAK ch. 16");
  if (kind === "dist") return card("tsd", "nav", `How far will you fly in ${min} minutes at a groundspeed of ${gs} knots?`, `${dist} NM`, [`${dist + pick([5, 6, 10])} NM`, `${Math.max(2, dist - pick([4, 5, 8]))} NM`, `${Math.round(gs * min / 100)} NM`],
    `Distance = groundspeed × time = ${gs} kt × ${min}/60 h = ${dist} NM.`, "PHAK ch. 16");
  return card("tsd", "nav", `You cover ${dist} NM in ${min} minutes. What is your groundspeed?`, `${gs} knots`, [`${gs + 10} knots`, `${gs - 10} knots`, `${Math.round(dist / min * 100)} knots`],
    `Groundspeed = distance ÷ time = ${dist} NM ÷ (${min}/60 h) = ${gs} knots.`, "PHAK ch. 16");
}

/* ---------------- true course to magnetic heading ---------------- */
function hdgCard() {
  const tc = norm(int(1, 72) * 5), wca = pick([-12, -10, -8, -7, -5, -4, -3, 3, 4, 5, 7, 8, 10, 12]), v = int(2, 18), east = R() < 0.5;
  const th = norm(tc + wca), mh = norm(th + (east ? -v : v)), backwards = norm(th + (east ? v : -v)), noWca = norm(tc + (east ? -v : v));
  return card("hdg", "nav", `True course ${fmt3(tc)}°, wind correction angle ${wca > 0 ? "+" : "−"}${Math.abs(wca)}° (${wca > 0 ? "right" : "left"}), variation ${v}° ${east ? "E" : "W"}. What is the magnetic heading?`,
    `${fmt3(mh)}°`, [`${fmt3(backwards)}°`, `${fmt3(noWca)}°`, `${fmt3(norm(mh + 2 * wca))}°`],
    `True heading = true course + wind correction = ${fmt3(tc)} ${wca > 0 ? "+" : "−"} ${Math.abs(wca)} = ${fmt3(th)}°. Then variation: east is least (subtract), west is best (add): ${fmt3(th)} ${east ? "−" : "+"} ${v} = ${fmt3(mh)}° magnetic.`, "PHAK ch. 16");
}

const GEN = { metar: metarCard, wind: windCard, da: daCard, tsd: tsdCard, hdg: hdgCard };
export const DRILLS = [
  { key: "metar", label: "Decode METARs: ceiling, category, wind" },
  { key: "wind", label: "Crosswind & headwind components" },
  { key: "da", label: "Pressure & density altitude" },
  { key: "tsd", label: "Time, speed, distance & fuel" },
  { key: "hdg", label: "True course to magnetic heading" },
  { key: "mix", label: "Mixed calculation drill" },
];
/** n fresh cards for a drill */
export function drillSet(key, n) {
  return Array.from({ length: n }, () => retry(GEN[key === "mix" ? pick(Object.keys(GEN)) : key]));
}
