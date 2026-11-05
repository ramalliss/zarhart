// Zarhart Pro license check for the website (a Cloudflare Worker; the free plan covers it).
// The website is static, and Lemon Squeezy's License API can't be called reliably from a browser,
// so this small service checks a Pro license key and answers { valid: true | false }.
//
// Set up once:
//   1. In Lemon Squeezy, turn on license keys for the Zarhart Pro product (monthly and yearly).
//   2. Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy.
//   3. Worker → Settings → Variables: PRO_PRODUCT_IDS = the Pro product id(s) from Lemon Squeezy,
//      comma-separated; ALLOW_ORIGIN = https://ramalliss.github.io
//   4. Put the worker's URL in WEB_PRO.verifyUrl in assets/js/limits.js. The website's free limits
//      switch on from that moment, so set the Pro checkout links in pricing/index.html at the same time.
//
// A key counts as valid when Lemon Squeezy says it is, it belongs to a Pro product, and it isn't
// expired or disabled (a cancelled subscription's key expires when the subscription ends).

const LS_VALIDATE = "https://api.lemonsqueezy.com/v1/licenses/validate";

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "https://ramalliss.github.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ valid: false, error: "POST a JSON body: { license_key }" }, 405);

    let key = "";
    try { key = String((await req.json()).license_key || "").trim(); } catch { /* not JSON */ }
    if (!key || key.length > 200) return json({ valid: false, error: "missing key" }, 400);

    let data = {};
    try {
      const r = await fetch(LS_VALIDATE, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ license_key: key }),
      });
      data = await r.json();
    } catch {
      return json({ valid: false, error: "license service unreachable" }, 502);
    }

    const ids = String(env.PRO_PRODUCT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const productOk = !ids.length || ids.includes(String(data?.meta?.product_id ?? ""));
    const status = data?.license_key?.status;
    const valid = data?.valid === true && productOk && status !== "expired" && status !== "disabled";
    return json({ valid });
  },
};
