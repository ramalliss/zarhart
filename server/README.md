# Host a Zarhart server

One shared sky, with radios that work like the real ones. Hosting is like hosting a Minecraft server: one person runs the server, everyone else opens its address and joins.

## Start it

You need [Node.js](https://nodejs.org) 18 or newer. From the `zarhart` folder:

```
node server/zarhart-server.mjs
```

Options: `--port 8080` (default 8080), `--name "Friday night pattern"`, `--password secret` (players must type it to join), `--max 32` (player limit).

It serves the whole site too, so on the computer running it you just open `http://localhost:8080/sim/`, then **Online → Join**. The server address fills itself in.

## Let friends join

Voice needs the microphone, and browsers only allow the microphone on **https** pages (or on `localhost`). So friends need an https address for your server:

- **Free and quick: a Cloudflare quick tunnel.** Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then, while the server runs, open a second terminal and run `cloudflared tunnel --url http://localhost:8080`. It prints an address like `https://something.trycloudflare.com`. Send that to your friends: they open it, add `/sim/`, and join. No account needed. The address changes each time you start the tunnel.
- **Always on:** put the server on any Node.js host that gives you https (most do), with `node server/zarhart-server.mjs --port $PORT`.
- **Same Wi-Fi only:** friends can open `http://your-computer's-IP:8080/sim/` and fly together, and typed radio calls work. Voice needs https, so use the tunnel for voice.

Players on the public site (ramalliss.github.io/zarhart) can join your server too: in **Online**, they type your https address.

## Host commands

Type in the server window:

| Command | What it does |
|---|---|
| `list` | Who's online, as what, from where |
| `kick <callsign>` | Remove someone |
| `weather <preset>` | Everyone's weather: `clear`, `scattered`, `marginal`, `crosswind`, `rain`, `heavyrain`, `snow`, `calm`, `fog`, `gusty`, `storm`, `frost`, `freezing` |
| `time <hour>` | Everyone's time of day, 0–24 |
| `say <message>` | A notice to every player |
| `stop` | Shut the server down |

## How the radio works

- **Push to talk.** Hold Space (or the Talk button, or your controller's mic button) and speak. Your voice goes out on the radio your audio panel's MIC selects (COM1 or COM2). A quick tap is a mic click (pilot-controlled lighting).
- **You hear a station only if you could in a real airplane:** one of your radios is tuned to its frequency, that radio is switched on in the audio panel, and you're in line of sight. VHF range in nautical miles is about 1.23 × (√ your height + √ their height), heights in feet above the ground. Two airplanes on the ground 10 miles apart can't hear each other; at a few thousand feet you hear for 60–80 miles. Controllers' antennas have their own range.
- **It sounds like aviation AM radio:** voice is 8 kHz, band-limited, a little distorted and compressed. Static grows as a station gets farther away, and there's a squelch tail when a transmission ends.
- **Two people transmitting at once block each other.** Listeners hear a squeal, and the radio strip shows BLOCKED. Listen before you talk.
- **Stuck mic:** a transmission is cut after two minutes.
- **Typed calls** (in the Radio menu) follow the same rules, for anyone without a microphone.

## Controllers

In **Online**, pick a seat: Zarhart Tower (118.300), Zarhart Ground (121.900), Zarhart Approach (125.500) or Earhart UNICOM (122.800). Each seat holds one person. Controllers see a traffic scope: each pilot is a target with a data block showing callsign, altitude in hundreds of feet and groundspeed. When a controller is on a frequency, the simulator's automated controller stays quiet there: the person answers.

## Privacy

Everything goes to the server you join, never to Zarhart: your callsign, position and radio settings while you're connected, and your voice while you hold push-to-talk, relayed to the players who can hear it. The server keeps nothing on disk. The host sees who's connected and their network addresses.

## Protocol (for tinkerers)

WebSocket at `/mp`. JSON text messages: `hello` → `welcome`, `state` (5 per second), `states` (everyone, 5 per second), `tx` (key/unkey), `text`, `rx`, `join`, `leave`, `world`, `notice`. Binary messages carry voice: from a client `[version][sequence, 2 bytes][μ-law samples]`, to a client `[sender id, 4 bytes][frequency × 1000, 4 bytes][signal 0–255][the client's packet]`. Server info: `GET /mp/info`.
