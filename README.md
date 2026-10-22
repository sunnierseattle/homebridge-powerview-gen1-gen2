# homebridge-powerview-gen1-gen2

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://img.shields.io/npm/v/homebridge-powerview-gen1-gen2.svg)](https://www.npmjs.com/package/homebridge-powerview-gen1-gen2)
[![npm](https://img.shields.io/npm/dt/homebridge-powerview-gen1-gen2.svg)](https://www.npmjs.com/package/homebridge-powerview-gen1-gen2)

[Hunter Douglas PowerView](https://www.hunterdouglas.com/operating-systems/motorized/powerview-motorization) shades in HomeKit, for **Generation 1 and 2 hubs**.

- **PowerView scenes appear as HomeKit switches**, so a group of shades moves together instead of one at a time.
- **Your shades stay asleep overnight.** By default, no battery poll or asking shades at startup wakes the motors between 21:00 and 08:00.

Homebridge 1.8+ and 2.x, Node.js 22 or 24. Generation 3 gateways are not supported.

> **Credits.** This is a fork of [squircle12/homebridge-powerview-3](https://github.com/squircle12/homebridge-powerview-3), itself a TypeScript rewrite of [owenselles/homebridge-powerview-2](https://github.com/owenselles/homebridge-powerview-2), originally by [Scott James Remnant](https://github.com/keybuk). The full upstream commit history is preserved in this repository. This fork adds scene support, and fixes to hub request serialisation, position reporting, battery scaling, shade capability detection, accessory removal, and input handling. See [What this fork changes](#what-this-fork-changes).

## Requirements

- [Homebridge](https://github.com/homebridge/homebridge) **1.8.0** or **2.0.0**
- Node.js **22** or **24**

## Supported shades

- Roller shades
- Horizontal vane shades (e.g. Silhouette, Pirouette) — position plus tilt in Details
- Vertical vane shades (e.g. Luminette) — position plus tilt in Details
- Top-down/bottom-up shades (e.g. Duette) — two Window Covering services per shade

Shades work in HomeKit scenes and automations.

## What this fork changes

All of the following are fixes to behaviour inherited from upstream, made against a real
Generation 1 hub (firmware build 827).

**It stops waking your shades.** Battery polling ran every six hours with no way to turn it off.
Forcing a battery reading is a radio round-trip that spins the motor — measured at 3.7s against
0.08s for a cached read — so on a six-hour cycle one poll always landed overnight whatever time
Homebridge started. It is now off by default, opt-in, once a day at a time you choose. The
plugin does not ask shades at startup during configurable quiet hours, so an unattended restart at
03:00 cannot wake five motors.

**It stops the Home app reporting the wrong position.** Positions persist across restarts, so a
cold start no longer reports every shade as fully closed until the first refresh lands. Reads are
answered from the last known position and refreshed behind the answer, instead of blocking
HomeKit on a hub round-trip until it gave up.

**It will not destroy your accessories.** A shade missing from a single hub response used to be
unregistered from HomeKit, taking its room and any automations with it. Hubs under load do return
short lists. A shade must now be absent from several consecutive responses before it is removed.

**It drives more shade types correctly.** Shade behaviour is resolved from the capabilities the
hub reports, falling back to the documented 26-type table. The upstream list knew six types, so
twenty fell through to "assume roller" — wrong for seventeen of them. Types this plugin cannot yet
drive correctly say so once per shade rather than reporting a confident wrong position.

**Battery percentages are real numbers.** `batteryStrength` is pack voltage in tenths, not a
percentage. Any reading above 100 previously collapsed into one of four buckets, so a pack at 67%
and one at 98% both showed 90%.

**Hub communication is serialised properly.** Every request goes through one gate, including
reading the response body — a legacy hub answers one request at a time and returns truncated JSON
when calls overlap. Dropped connections are retried instead of silently losing the command.

**Scenes are exposed**, which is the only way to move a group of shades in unison.

**It does not pretend to stop a moving shade.** The hub accepts a stop command and ignores it, so
Hold is not offered. To stop a shade, send it a new position.

**It has no runtime dependencies**, so it adds no third-party code to your Homebridge install.
Hub responses are size-capped and streamed, shade names are sanitised before they reach your logs
or HomeKit, and the configured host is validated.

## Installation

1. Install and set up [Homebridge](https://github.com/homebridge/homebridge).
2. Install the plugin (Homebridge UI **Plugins** tab, or CLI):

```bash
npm install -g homebridge-powerview-gen1-gen2
```

3. Add the **PowerView** platform via the plugin **Settings** button in the Homebridge UI, or add a platform block to `config.json`:

```json
"platforms": [
  {
    "platform": "PowerView",
    "name": "PowerView"
  }
]
```

The hub is contacted at `powerview-hub.local` by default.

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `name` | Platform name in Homebridge | `PowerView` |
| `host` | Hub hostname or IP | `powerview-hub.local` |
| `exposeScenes` | Expose PowerView scenes as HomeKit switches | `true` |
| `excludeScenes` | Scene names (case-insensitive) or hub IDs to keep out of HomeKit | `[]` |
| `sceneNamePrefix` | Text put in front of new scene switch names, such as `Scene: ` | `""` |
| `healSweepIntervalMinutes` | Ask shades on this schedule (at least 30 minutes), one at a time, skipping quiet hours. `0` is off. Wakes motors | `0` |
| `healSweepGapMs` | Pause between shades when asking shades on schedule | `4000` |
| `batteryPolling` | Force a fresh battery reading daily. Wakes the shade motor | `false` |
| `batteryPollAt` | Local time for the battery poll, `HH:MM` | `14:00` |
| `syncPositionsOnStart` | Ask shades at startup that the hub has no position for. Wakes those motors | `true` |
| `quietHours` | Hours when the plugin won't ask shades at startup or on schedule, so an unattended restart cannot wake shades overnight | `21:00`–`08:00` |
| `reportTravel` | Animate travel in HomeKit instead of reporting the commanded position at once | `false` |
| `refreshShades` | Ask shades instead of hub on every HomeKit read. Wakes a motor every time, even during quiet hours | `false` |
| `pollShadesForUpdate` | Ask hub every 30 seconds for any position changes it has stored. Never wakes a motor | `false` |
| `requestIntervalMs` | Delay between hub requests. Raise it if your hub struggles under load | `100` |
| `strictErrors` | Fail HomeKit reads on hub errors instead of returning the last known position | `false` |
| `forceRollerShades` | Shade IDs to treat as roller | `[]` |
| `forceTopBottomShades` | Shade IDs to treat as top/bottom | `[]` |
| `forceHorizontalShades` | Shade IDs to treat as horizontal vane | `[]` |
| `forceVerticalShades` | Shade IDs to treat as vertical vane | `[]` |

### Reporting position while a shade moves

By default a shade reports the position you asked for as soon as you tap it, so the tile responds
immediately. The hub's reply only echoes the command, so for the few seconds the motor is running
HomeKit is ahead of the shade — and if a shade fails to move at all, nothing notices until it is
refreshed.

Set `reportTravel` to `true` to keep the tile on the shade's real position and show
opening/closing during travel. Truer, but the number does not change for several seconds after a
tap, which reads as unresponsive.

Example with host and polling:

```json
{
  "platform": "PowerView",
  "name": "PowerView",
  "host": "192.168.1.50",
  "pollShadesForUpdate": true
}
```

### Unknown shade types

If the hub reports an unknown shade type, the log may show:

```
Shade 12345 has undocumented type 66; treating as roller. Override with forceRollerShades /
forceTopBottomShades / forceHorizontalShades / forceVerticalShades if that is wrong.
```

Please [open an issue](https://github.com/sunnierseattle/homebridge-powerview-gen1-gen2/issues) with the shade model. You can override detection with the `force*` arrays above.

### Scenes

PowerView **scenes** are exposed as HomeKit switches, one per scene defined in the PowerView app.
Tapping one activates the scene and the switch resets itself — a scene is a button, not a state.

Scenes are the only way to move a group of shades **together**. The hub carries out a scene
itself, so every motor receives its command at once, the same way a physical remote does. Setting
five shades individually sends five separate commands, and they visibly stagger by about a second
end to end — that is the hub's design, not something a plugin can tune away.

Nothing appears in HomeKit until you create scenes in the PowerView app. Set `exposeScenes` to
`false` to hide them all, or list individual scenes in `excludeScenes` to hide only those, such
as scenes that exist for a physical remote. Use the name the PowerView app shows or the scene's
hub ID from the log. A scene that is already in HomeKit is removed on the next restart. An entry
that matches no scene, such as a typo or a scene since renamed in the app, is logged as a warning.

### Shade tools

The plugin's settings page in the Homebridge UI opens on a **Shade tools** panel, with the normal
settings form below it. It covers the jobs that otherwise need the PowerView app:

- **Check** asks a shade over radio where it really is, which tells you whether its radio answers
  and whether the Home app's position is real. It wakes the motor briefly.
- **Jog** wiggles a shade to prove its radio and motor respond.
- **Calibrate** runs a shade fully up and down to relearn its limits, as the PowerView app does.
  Use it when a shade stops short or reports a position it never reached. It takes one to two
  minutes, asks for a second click to confirm, and checks the shade again when it finishes.
- **Scenes on the hub** shows where each scene sends each shade, and highlights rail positions
  that are not exactly open or closed.

The page talks to the hub from the Homebridge UI's own process, at the `host` in this plugin's
saved config, using the same request handling as the plugin. Nothing runs unless you press a
button.

### Hub resilience

- Every hub request is serialised, including reading the response body. Legacy hubs answer one
  request at a time and return truncated JSON when calls overlap.
- Requests time out after 15 seconds and a dropped connection is retried, so a command is not
  silently lost. Hub-busy responses (HTTP 423) are retried too.
- When the hub is unreachable or a refresh times out, HomeKit reads return the **last known
  position** unless `strictErrors` is enabled.
- A shade missing from a single hub response is **not** removed from HomeKit. Hubs under load
  answer with short lists, and unregistering an accessory destroys its room and automations.

### Catching moves HomeKit never heard about

A shade moved with a physical remote or the PowerView app tells HomeKit nothing, and the hub
forgets positions about an hour after a move, so the Home app can show a stale position
indefinitely. `pollShadesForUpdate` only asks hub, so it cannot see these.

Set `healSweepIntervalMinutes` (for example `720`, twice a day) to ask shades on that schedule,
one at a time with `healSweepGapMs` between them. This is skipped during `quietHours`, and each
shade that turns out to be somewhere else is logged and corrected. Asking shades wakes their
motors, which is why it is off by default.

### Battery

Battery percentage appears in the Home app through a linked Battery service on each shade.
Levels ride along on ordinary hub reads.

The **battery poll is off by default**, deliberately. Forcing a fresh reading is a radio
round-trip that wakes the shade motor — audible, and it nudges the shade. The hub refreshes
battery on its own schedule anyway. Enable `batteryPolling` to force a daily reading at
`batteryPollAt`.

## Migrating from an earlier plugin

**Uninstall the old package first.** If both are installed, both claim the `PowerView` platform
name and Homebridge drops your cached shades instead of migrating them — they come back as new
tiles with no room or automations.

1. Stop Homebridge.
2. Uninstall the old plugin: `npm uninstall -g homebridge-powerview-universal` (or `homebridge-powerview-3`, `homebridge-powerview-2`)
3. Install `homebridge-powerview-gen1-gen2`.
4. Update your config: keep `"platform": "PowerView"` and add `"name": "PowerView"` if missing.
5. Remove any old **PowerView** platform entry that pointed at the v2 package, then add the platform again for v3.
6. Restart Homebridge.

This plugin was published as `homebridge-powerview-universal` until 4.7.0; the code and settings
are unchanged. With only one PowerView plugin installed, Homebridge re-associates your existing
shades to the new name automatically and logs that it did so; your rooms and automations survive.

## Shade examples

Tap an accessory to open/close; long-press for a custom position.

### Horizontal and vertical vanes

Use **Details** after a long-press to adjust tilt. For scenes: use **Closed** when setting vane tilt; use **0°** tilt when setting position.

### Top-down/bottom-up

Two controls are created per shade (bottom and top), which can be used independently or in scenes.

## Releases

Version history for installers is in [RELEASE_NOTES.md](RELEASE_NOTES.md). Detailed developer notes are in [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

## License

ISC. See [LICENSE](LICENSE) for the full text and the copyright chain.
