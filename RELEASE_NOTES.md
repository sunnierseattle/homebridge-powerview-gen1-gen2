# Release notes

User-facing notes for **homebridge-powerview-gen1-gen2** releases. Use this file when publishing to npm or creating a [GitHub Release](https://github.com/sunnierseattle/homebridge-powerview-gen1-gen2/releases).

## How to publish a version

1. Bump `version` in [package.json](package.json).
2. Add a new **Latest** section below (copy the template).
3. Record the same changes in [CHANGELOG.md](CHANGELOG.md) (developer-oriented, can be more detailed).
4. Run `npm test`, `npm run build`, then publish or tag.
5. Copy the **Latest** section into the GitHub Release description (title: `vX.Y.Z`).

### Section template

```markdown
## Latest: X.Y.Z (YYYY-MM-DD)

### Highlights

- One-line summary for installers (1–3 bullets).

### Added

- …

### Changed

- …

### Fixed

- …

### Notes

- Upgrade / config / HomeKit caveats if any.
```

---

## Latest: 5.3.0 (2026-11-03)

### Highlights

- **Stop a moving shade on a Gen 2 hub.** Add a **Stop Shades** switch that works in the Home app
  and with Siri, which don't offer HomeKit's own stop control.
- **Tested on a Gen 2 hub** (build 1056) as well as Gen 1 (build 827).

### Added

- **Stop on Gen 2 hubs** (`stopCommand`, default `auto`). Gen 2 hubs halt a moving shade; Gen 1
  hubs ignore the stop command. So `auto` turns stop on for Gen 2 and leaves it off for Gen 1.
  Apps that show HomeKit's Hold control get it on each shade.
- **Stop Shades switch** (`stopSwitch`, off by default). Apple's Home app and Siri don't show Hold,
  so this adds one switch that stops every shade at once, one command per PowerView group. It
  turns itself back off. Tip: add it to a Home scene named "Stop Shades" so "Hey Siri, stop shades"
  works.
- **The tile shows where the shade really stopped.** After a stop, the plugin asks each shade
  twice where it halted. A shade that missed the stop (one in testing missed three of four) gets
  one more stop, and is asked again once its move is over.
- **Stop before re-targeting** (`stopBeforeRetarget`, off by default; from Omar Shahine, #3). A
  new target sent to a shade that is still moving goes out as a stop, a 2-second wait, then the new
  target. On a Gen 2 hub, redirecting a moving shade ended in the wrong place in 3 of 12 trials,
  and one shade lost track of where it was until calibrated. Stopping first was right 11 of 11
  times. A re-target costs about 4 seconds more. Only applies where stop is on.

### Fixed

- **Commands no longer wait behind position checks.** A command sent while the plugin was asking
  shades where they are used to wait for every check in line: 17 seconds after Stop Shades in
  testing. It now goes next.
- **A shade you move after a stop is not stopped again.**
- **Open, stop, close no longer comes out as close, stop.** A move sent after a stop or jog was
  merged into one sent before it, so the shade stopped instead of closing.

### Changed

- Position help text names every setting that still asks shades during quiet hours (#19).

### Notes

- **No config changes needed.** On a Gen 2 hub, stop turns on by itself; set `stopCommand` to
  `off` to keep it off. Nothing changes on Gen 1 hubs except the fixes above.

---

## 5.2.1 (2026-10-22)

### Changed

- **The Position settings are grouped** (#18). Four small headings, each with a line above it:
  **Ask hub**, **Ask shades**, **Quiet hours** and **In the Home app**.
- **Pause between shades now sits under Wait before asking.** It used to appear above Quiet hours
  when you turned on **Ask shades after a move**, far from the box you ticked. The two add up:
  shades are asked one at a time, the first after the wait and the rest with the pause between
  them. The **Ask shades after a move** description now says so.

### Notes

- **No config changes needed.** No setting names or defaults changed.

---

## 5.2.0 (2026-10-22)

### Highlights

- **See where a shade really stopped.** An optional check asks each shade where it ended up after a
  move, so a shade that stopped short shows its real position in the Home app.
- **Smoother slider drags.** An optional wait sends one move when you let go of a slider, instead of
  re-aiming the shade several times while you drag.

### Thank you

Both features are from **[@omarshahine](https://github.com/omarshahine)** (#5, #13). Thank you!

### Added

- **Ask shades after a move** (`verifyAfterMove`, #13). Off by default. After a shade is moved
  from HomeKit or a scene, the plugin waits for the move to finish and then asks the shade over
  radio where it is. If it stopped short, the Home app shows where it actually is. If you move the
  same shade several times in a row, it is asked only once, after the last move. This wakes the
  motor, even during quiet hours.
  - **Wait before asking** (`verifyDelayMs`, default 30 seconds, 5 seconds to 5 minutes). Raise it
    for large or heavy shades that take longer to travel.
- **Wait for slider to settle** (`setPositionDebounceMs`, #5). Off by default (`0`, max 5000 ms).
  The shade moves only after the slider has been still this long, so a drag sends one move.
  `1500` is a good start. Every command waits this long, including taps, Siri and automations.

### Notes

- **No config changes needed.** Both settings are off by default. They are under **Position** in
  the plugin settings.

---

## 5.1.0 (2026-10-21)

### Highlights

- **Shade tools in the plugin settings.** Check, jog or recalibrate any shade from the Homebridge
  UI, without opening the PowerView app.
- **Catch moves HomeKit never heard about.** An optional schedule asks shades where they are, so
  moves made with a physical remote or the PowerView app show up in the Home app.
- **Hide scenes you don't use, and label the rest.** Hide individual scenes from HomeKit, and
  optionally put a prefix such as "Scene: " in front of scene switch names.
- **A tidier settings dialog**, with tabs, sections and plain wording.

### Thank you

A big thank you to **[@omarshahine](https://github.com/omarshahine)**, who contributed most of this
release: the Shade tools page (#6), the scheduled shade check (#14), hiding scenes (#2), the scene
name prefix (#11) and repo housekeeping (#8). @omarshahine is bringing over the best parts of a
long-running fork as small, well-tested pull requests, and this plugin is better for it.

### Added

- **Shade tools** (#6), on its own tab in the plugin settings:
  - **Check** asks a shade over radio where it really is.
  - **Jog** wiggles it, to show that its radio and motor respond.
  - **Calibrate** runs it fully up and down to relearn its limits, with a confirmation step.
  - **Scenes on the hub** lists where each scene sends each shade and highlights positions saved
    partway open.
- **Ask shades every N minutes** (`healSweepIntervalMinutes`, #14). Off by default. Asks each shade
  in turn, at least 30 minutes apart and with a pause between shades (`healSweepGapMs`), and skips
  quiet hours.
- **Hide these scenes** (`excludeScenes`, #2). Scene names (any case) or hub IDs to keep out of
  HomeKit. A scene already in HomeKit is removed.
- **Scene name prefix** (`sceneNamePrefix`, #11). Text put in front of new scene switch names.
  Existing switches keep their names.

### Changed

- **The settings dialog is reorganized** (#15):
  - Settings and Shade tools tabs, with Settings first.
  - Position, Scenes, Battery and Advanced sections.
  - Quiet hours set with From / Until dropdowns such as "9 PM" instead of 0–23 sliders.
- **Consistent wording.** "Ask hub" means reading the position the hub has stored, which never
  wakes a motor. "Ask shades" means a radio read, which wakes the motor. Setting names,
  descriptions, log lines and the README all use these terms.

### Notes

- **No config changes needed.** Existing settings keep their keys and meaning, and the new ones
  are off or empty by default.
- **Log lines are reworded.** `Startup position sync: …` is now `Asking shades at startup: …`. If
  you search your logs for that text, update the search.
- **Shade tools adds one dependency**, `@homebridge/plugin-ui-utils`, the Homebridge team's library
  for plugin settings pages. It has no dependencies of its own.

---

## 5.0.3 (2026-10-18)

### Fixed

- A tilted horizontal-vane shade could show 0° tilt in HomeKit, depending on the order in which the
  hub listed its positions.

### Notes

- No settings change.

---

## 5.0.2 (2026-10-18)

### Highlights

- **Verified by Homebridge.** The plugin passed the Homebridge team's review, and its README now
  carries the verified badge.

### Notes

- No code or settings change. This release refreshes the README shown on npm.

---

## 5.0.1 (2026-10-02)

### Highlights

- **The plugin no longer installs process-wide error handlers.** A crash in another plugin is
  no longer caught, logged under this plugin's name, and left running in a broken state.

### Changed

- Declares HomeKit (HAP) as its transport with the `supports-hap` keyword, which the Homebridge
  UI reads.

### Notes

- No settings change. This plugin's own errors are still caught and logged where they happen.

---

## 5.0.0 (2026-09-14)

### Highlights

- **Renamed to `homebridge-powerview-gen1-gen2`.** Nothing else changes: same code, same settings.
  The old name suggested Generation 3 support, which this plugin does not have.

### Changed

- The package and GitHub repository are now `homebridge-powerview-gen1-gen2`. The old
  `homebridge-powerview-universal` package receives no further updates.

### Notes

- This does not upgrade in place. Uninstall `homebridge-powerview-universal`, then install
  `homebridge-powerview-gen1-gen2`; your `PowerView` config block works as is. Homebridge moves
  your existing shades and scenes to the new name on first start, keeping rooms and automations.
  Install both at once and the shades are dropped instead.

---

## 4.7.0 (2026-09-13)

### Highlights

- Scenes are no longer marked unsupported on restart, and talking to the hub is much faster.
- **Hold** is removed, because the hub never actually stopped a moving shade.

### Fixed

- **Scene switches are detected reliably, and startup is faster.** The hub mishandles requests
  that reuse a network connection. After a restart it could answer the scene check with an error,
  logging `Could not probe /api/scenes: Hub returned malformed JSON` and `scenes=false`, and each
  request could stall for about 4 seconds. Every request now uses its own connection. Against a
  real hub, startup went from about 25 seconds to under one.
- **Running a scene logs how many shades it moved** again.
- **Hub errors say what actually went wrong.** A failed request whose reply was not valid JSON was
  reported as "malformed JSON" instead of its HTTP status.

### Changed

- The once-per-shade log line about missing positions is now accurate. The hub remembers a shade's
  position for about an hour after it moves, then forgets it; this is normal.

### Removed

- **Hold (Hold Position).** The hub accepts the stop command and ignores it: a shade told to stop
  mid-travel kept going, while HomeKit was told it had stopped. The official PowerView app has no
  stop control either. Hold disappears from existing shades automatically on upgrade. To stop a
  shade partway, send it a new position.

### Notes

- Hold was only reachable from automations and third-party HomeKit apps, not from the Home app's
  shade tile, so most people will not notice it is gone. An automation that used it will need
  editing.
- Identify still makes the shade wiggle; that was checked on real hardware.

---

## 4.6.0 (2026-09-05)

### Added

- **If you have a Generation 3 Gateway, the log now tells you.** Gen 3 hubs speak a different API,
  so this plugin cannot talk to them at all — but it previously failed with only a `NotFound`
  error, which looks like a wrong IP address or a firewall. It now checks and says plainly that
  the hub is a Gen 3 Gateway and unsupported.

### Notes

- This does not add Gen 3 support; it only explains the failure.
- The check runs only when startup has already failed, never on a working hub.

---

## 4.5.3 (2026-09-05)

### Changed

- The plugin is now listed as **PowerView (Gen 1 & 2)** in the Homebridge UI, and its description
  says which hubs it works with. Nothing about your configuration or accessories changes — this is
  only how the plugin presents itself in search and on its settings page.

---

## 4.5.2 (2026-09-05)

### Fixed

- The plugin settings screen showed `25` as the default hub request spacing. That value makes a
  Generation 1 hub drop connections and lose shades from group moves; the real default is `100`.
  If you saved settings and picked up `25`, change it to `100`.

### Changed

- README rewritten: documents scenes, all sixteen configuration options, and what this fork
  changes relative to the plugin it forked from.

---

## 4.5.1 (2026-09-05)

### Fixed

- **Running a scene updates the shades in the Home app straight away.** Previously the positions
  did not change until you closed and reopened the app, because the hub carries out a scene itself
  and never tells the plugin which shades it moved. The plugin now reads the scene's membership,
  which records each target position, and updates HomeKit from that — without waking any motors.

---

## 4.5.0 (2026-09-05)

### Changed

- **Shade tiles respond immediately again.** 4.3.0 kept the tile on the shade's real position and
  animated it through the travel, which is more truthful but means the number sits still for up to
  16 seconds after you tap. That felt slower, so the responsive behaviour is back as the default.
- The truthful behaviour is still available as **`reportTravel`** in the plugin settings.

### Notes

- Shades were never actually slower to start moving. The command path is unchanged from the
  original plugin — same queue, same spacing, about a second for five shades either way. Only the
  moment the tile updates changed.
- With the default setting, HomeKit shows the position you asked for rather than one that was
  measured. If a shade fails to move, the tile will not reflect that until the shade is refreshed.

---

## 4.4.0 (2026-09-04)

Security hardening from a full audit. Nothing here was being exploited — these
close attack surface rather than patch a live hole.

### Fixed

- Shade names from the hub are sanitised before they reach your logs or HomeKit. A crafted name
  could previously forge log entries or inject terminal escape sequences.
- Hub responses are capped at 2MB and streamed, so a faulty or hostile hub cannot exhaust memory
  and take Homebridge down with it.
- The `host` setting is validated, so a malformed value cannot redirect requests away from the hub.
- A shade name that was never base64 is used as-is instead of being turned into gibberish.

### Notes

- **Your hub has no authentication or encryption.** Anyone on your network can control your shades
  directly, without Homebridge. No plugin can change that — keep the hub off networks you share
  with guests or untrusted devices.
- The plugin has no runtime dependencies, so it adds no third-party code to your Homebridge
  install.

---

## 4.3.2 (2026-09-04)

- Scene activation logged `(0 shade(s))` even when it moved several; the count is shown only when
  the hub reports one. Confirmed end to end against a live scene.

## 4.3.1 (2026-09-04)

First release published to npm.

### Fixed

- Activating a scene logged `(0 shade(s))` even when it moved several. The count is now shown only
  when the hub reports one.

### Notes

- Scene activation has now been confirmed end to end against a live scene on a gen1 hub, tapped
  from the Home app — the 4.3.0 caveat about it being untested no longer applies.

---

## 4.3.0 (2026-09-04)

### Highlights

- **Scenes, for shades that move together.** Any scene you define in the PowerView app now appears
  as a HomeKit switch. Activating it is one command to the hub, which moves the whole group at
  once — the same way a Pebble remote does, and something the plugin could not do by commanding
  shades one at a time.
- **The Home app stops claiming a shade has arrived before it has.** Position tiles now animate
  while the shade travels, showing opening or closing, instead of jumping to the destination the
  moment you tap.
- **Homebridge starts much faster.** The startup position sync no longer holds up launch; one
  observed startup took 82 seconds to become ready.

### Added

- `exposeScenes` (default on). Nothing appears unless you have scenes defined.

### Notes

- Scene activation follows the documented PowerView API but has not been tested against a live
  scene. If you define one and it misbehaves, that is the reason.

---

## 4.2.0 (2026-09-04)

### Highlights

- **The Home app feels faster.** Position reads are answered instantly from the last known
  position and refreshed in the background, instead of waiting on the hub. This removes the
  "plugin slows down Homebridge / read handler was slow to respond" warnings, which appeared 15
  times in a single startup on a five-shade system.
- **Reads never wake a shade motor.** The background refresh behind a read was using the RF
  round-trip that physically spins the shade; it now uses the cheap cached read, and the RF path
  is reserved for when the hub genuinely has no position.

---

## 4.1.2 (2026-09-04)

### Highlights

- **Shades can no longer vanish from HomeKit.** If the hub answered the shade-list request with a
  short list — which it does under load — the plugin removed every missing shade from HomeKit
  outright, losing its room and any automations using it. A shade now has to be missing from
  three consecutive responses before it is removed, and an empty response never removes anything.

### Notes

- If shades disappeared on an earlier version, restart Homebridge and they will be re-added. You
  may need to put them back in the right room in the Home app.

---

## 4.1.1 (2026-09-04)

Fixes a regression in 4.1.0.

### Highlights

- **Shades no longer drop out of a group move.** 4.1.0 tightened the gap between hub requests to
  25ms, which a gen1 hub cannot take while its radio is transmitting — it drops the connection,
  and the command was then lost rather than retried. Setting five shades at once could move only
  three. The spacing is back to 100ms, and a dropped connection is now retried.

### Notes

- `requestIntervalMs` remains configurable. If you retune it, test it with shades actually
  moving; cached reads will not reveal the problem.

---

## 4.1.0 (2026-09-04)

Responsiveness work on top of 4.0.0.

### Highlights

- **Shades react faster to a tap.** Commands from the Home app now jump ahead of background
  refreshes instead of queuing behind them, and the delay between hub requests drops from 100ms
  to 25ms — about 375ms off closing five shades.

### Added

- `requestIntervalMs` (default `25`) — raise it if your hub misbehaves under load.

### Notes

- This does **not** make shades move in unison. The hub takes one command per shade, so five
  shades means five round-trips and roughly 350ms of unavoidable spread. A remote looks
  synchronised because it broadcasts to all the motors at once over RF. Matching that through the
  hub needs scene support, which is not implemented yet.

---

## 4.0.0 (2026-09-04)

First release under the name **homebridge-powerview-universal**. A major version
because the package is renamed — this does not upgrade in place.

### Highlights

- **Your shades stop waking up at night.** Battery polling was an RF round-trip that spins the
  motor, ran every 6 hours from plugin start, and had no off switch — so a poll always landed
  overnight. It is now off by default, and opt-in polling runs once a day at a time you choose.
- **Positions are correct on a cold start.** Last known positions survive a restart, so shades no
  longer show as "fully closed" in the Home app while the first refresh is still in flight.
- **The Home app stops timing out.** Position reads answer instantly from cache and refresh in the
  background, instead of blocking on a hub round-trip that HomeKit gives up on.
- **Battery percentages above 90% are real numbers now**, and 20 more shade types are driven from
  the capabilities the hub reports rather than assumed to be rollers.

### Added

- `batteryPolling` (default `false`) and `batteryPollAt` (default `14:00`) — opt in to a daily
  battery measurement at a time that suits you.
- `syncPositionsOnStart` (default `true`) and `quietHours` (default 21:00–08:00) — re-sync unknown
  positions at startup, but never inside the quiet window.
- An ISC `LICENSE` file.

### Changed

- Shade behaviour comes from the hub's `capabilities` field, falling back to the documented
  26-type table. Types the plugin cannot yet drive correctly now warn once per shade instead of
  silently reporting a wrong position or tilt.
- Logs are much quieter: positions are logged only when they change, and the "invalid position"
  and low-battery warnings no longer fire on the happy path.

### Fixed

- **Tilting a blind no longer makes it report as fully closed.** Whenever the hub sent a tilt
  value, the shade's position was overwritten with 0 in the same update.
- **Restarting Homebridge no longer shows every shade as fully closed** until the first refresh
  lands.
- **Hold** now stops a moving shade instead of jogging it.
- Battery percentage is read as pack voltage, not as a percentage — previously anything above 100
  collapsed to one of four values, so 67% and 98% both showed as 90%.
- Hub requests time out after 15s instead of hanging forever, and every request is fully
  serialised — including reading the response body, which previously still overlapped the next
  request and left the hub returning truncated JSON.
- A poll now costs half the hub requests it used to.
- Shades that the hub has never polled no longer raise a false low-battery warning.

### Notes

- Requires Homebridge **1.8+** or **2.x** and Node **22** or **24**.
- **Uninstall `homebridge-powerview-3` before installing this package.** Homebridge migrates your
  cached shades to the new name automatically, but only if one plugin claims the `PowerView`
  platform name — with both installed, the cached accessories are dropped and your shades come
  back as new tiles.
- Your `config.json` needs no changes; all new options have defaults.
- PowerView **scenes** are probed at startup but still not exposed as HomeKit accessories.

---

## 3.1.2 (2026-05-18)

### Highlights

- Battery percentage now appears in the Home app via a linked HomeKit Battery service on each shade (when the hub reports battery data).
- More resilient hub communication: retries when the hub is busy, cached positions on refresh timeouts, and optional `strictErrors` for debugging.

### Added

- Linked **Battery** service per shade (`BatteryLevel` 0–100%) from hub `batteryStrength` / `batteryStatus`.
- Hub HTTP **423** retry, startup capability probes, position **cache** for failed reads/refreshes.
- Platform option **`strictErrors`** (default `false`).
- Per-shade **firmware** in Accessory Information; **low battery** warning; TDBU top-rail name from `secondaryName`.
- **Hold** and **Identify** trigger shade **jog** where the hub supports it.
- Periodic battery refresh (`updateBatteryLevel`, about every 6 hours).

### Changed

- Shade list failures during poll no longer remove existing accessories.
- `putShade` omits invalid hub position kind **4** (error) from merged updates.

### Notes

- Requires Homebridge **1.8+** or **2.x** and Node **22** or **24**.
- PowerView **scenes** are probed at startup but not exposed as HomeKit accessories yet.
- After upgrading, restart Homebridge; remove duplicate shade tiles in Home if you migrated from an older plugin id.

---

## 3.1.1 (2026-05-18)

- Linked HomeKit Battery service per shade (battery % in Home app).

## 3.1.0 (2026-05-18)

- Hub resilience, `strictErrors`, position cache, battery/firmware metadata, jog via Hold/Identify, unit tests.

## 3.0.0 (2026-05-17)

- **Breaking:** Package renamed to `homebridge-powerview-3`; Homebridge 2.x / Node 22–24; TypeScript rewrite.
- See [CHANGELOG.md](CHANGELOG.md) for migration from homebridge-powerview-2.

## Earlier versions

See [CHANGELOG.md](CHANGELOG.md) and [homebridge-powerview-2](https://github.com/owenselles/homebridge-powerview-2).
