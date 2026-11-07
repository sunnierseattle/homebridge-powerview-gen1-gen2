# Changelog

All notable changes to this project are documented in this file.

## [5.4.0] - 2026-11-07

### Added

- Shade tools has a **Signal** button and column: it surveys a shade over radio
  (`GET /api/shades/{id}?survey=true`, not in the vendor docs) and shows the strongest link in dBm,
  or **No answer**. About 6 seconds per shade; the shade doesn't move. A Gen 2 hub (build 1056)
  answers; a Gen 1 hub (build 827) ignores the parameter.

- Shade tools has a **Hub** card with a status light control: Off, On, and brightness 1–100%.
  Off sets every colour channel and brightness to 0, because a Gen 2 hub keeps the light on at
  brightness 0 while a colour is set. On keeps the hub's current colour, or blue if it was off.
  Uses `PUT /api/userdata`, which the vendor docs don't list; on a Gen 2 hub (build 1056) it
  changes only the light and survives a power cut. Hidden when the hub reports no light setting.

### Changed

- Shade tools: **Check** is renamed **Position**, after the column it updates; read-only buttons
  (Position, Signal) now come before the ones that move the shade (Jog, Calibrate). The log line
  reads `position read sent to shade …` (was `check sent to shade …`). The **Power** column is now
  **Battery** and shows just the percentage, with **Low** only when the hub reports a low battery.
- Shade tools layout: the four row buttons stay on one line, and all buttons are more compact.
  The raw hub position value moved from beside the percentage into a tooltip. Row messages clear
  after 5 seconds (a message for a request still running waits for its result), and the calibrate
  confirmation window is 5 seconds (was 8). The **Radio timed out** label under the battery is
  gone: it came from a hub flag that lingers long after the read that set it; a Position read
  that times out still says so.
- Dependency refresh: `@homebridge/plugin-ui-utils` 2.2.7 (runtime); vitest and
  `@vitest/coverage-v8` 5.1.0, eslint 10.14.0, typescript-eslint 8.72.1, rimraf 6.1.4 (dev).
- Build with TypeScript 6.0 (was 5.9). The compiled `.js` and `.d.ts` are byte-identical to 5.9's;
  no tsconfig change was needed. 7.0 waits for typescript-eslint, which needs a compiler API 7.0 lacks.
- Test files are now type-checked: `npm run typecheck` (`tsconfig.test.json`) runs in CI. Dev
  dependencies homebridge 2.5.0 and hap-nodejs 2.3.0 now share one hap-nodejs copy; two copies
  (homebridge pinned 2.2.2, tests imported 2.2.3) caused 83 of the 90 type errors in tests.
- `minimatch` is forced to 11 through an npm override, clearing Dependabot alert #18 (dev only).
- New tests pin that a single-shade read uses only `shade` and ignores the `shadeData` list of
  every other shade that Gen 1 hub build 827 also returns.
- Settings form rewritten for clarity. New sections: **Positions**, **Moving and stopping** (travel,
  slider wait, stop, Stop Shades, stop before changing course; three of these were in Advanced),
  Scenes, Battery, Advanced. Shorter descriptions and plainer titles: for example "Strict errors" is
  now "Show hub errors", "Offer stop" is "Add stop to HomeKit", and "Hide these scenes" is "Hidden
  scenes", so its button reads "Add hidden scenes". Setting keys are unchanged, so existing configs
  keep working. README sections follow the same order, with the fork history moved below
  Configuration.
- "Add stop to HomeKit" offers three choices: Auto (on for Gen 2 hubs), On, Off. It and the quiet-hours
  dropdowns no longer show a "None" choice, which the settings UI added because the fields were
  optional; a missing value still means the default.
- Number settings are all plain fields; three with a minimum and maximum showed as sliders.
- The battery refresh time is picked from a 12 AM–11 PM dropdown, like the quiet hours, instead of
  typed as `HH:MM`. It saves `HH:00`. A time with minutes set in config.json still runs and Save keeps
  it; the dropdown just shows it blank.
- Positions layout: group headings are small and uppercase so they stand apart from settings, the two
  waits share a row, short fields (name and hub address side by side, the minutes, millisecond and stop settings, the
  scene name prefix) are half width, the repeated "Ask hub" description is gone, and the gap above From/Until is
  closed. Moving and stopping (MOVING, STOPPING) and Advanced (HUB, SHADE TYPE OVERRIDES) use the
  same small headings, and quiet hours has one too.
- Shade tools opens with the shades and the scenes both shown, and the longer help text is gone. In
  Scenes on the hub, Activate stays at the right of each scene, shades are listed in the same order in
  every scene, and the note is in plain words.

### Added

- **Quiet hours checkbox** (`quietHours.enabled`, default on). Clear it to turn quiet hours off; From
  and Until hide while it is off, and come back as 9 PM to 8 AM when it is ticked again.
  If quiet hours were turned off the older way (the same hour twice, or `quietHours: false`), the settings
  page opens with the box cleared, so saving keeps them off.
- The battery refresh time hides while the daily refresh is off, and comes back as 2 PM when it is
  ticked again.

### Fixed

- A setting that hid when another was turned off lost its value: the settings form clears hidden
  fields, so turning off "Ask shades after a move", the battery refresh, scenes or stop and saving dropped
  "Wait before asking", "Pause between shades", the refresh time, hidden scenes, the scene name
  prefix or the Stop Shades switch. These now always show.
- Quiet hours text named only two settings as still waking shades during quiet hours. It now says
  only what quiet hours do (no asking at startup or on a schedule); each setting that still wakes
  shades says so itself, and the README lists every exception, including checks after a stop, Shade
  tools checks and reads of a shade with no known position.
- `reportTravel` text said the tile shows the real position while moving; it is an estimate.
- `stopBeforeRetarget` pointed to "Stop command", a title that did not exist.
- `host` text now says blank uses `powerview-hub.local`.
- Shade tools showed the raw key `pollShadesForUpdate`; it now uses the setting's title.

## [5.3.0] - 2026-11-03

### Added

- **`stopBeforeRetarget`** (default `false`, from PR #3 by Omar Shahine): a different target for a shade
  still inside its estimated travel is sent as `motion: stop`, a `STOP_SETTLE_MS` (2s) wait, then the
  new target; commands during the wait fold into the last one. Only where `stopEnabled`. On build 1056,
  plain mid-travel re-targets went wrong 3 of 12 times (Front Left 30→100 then 20 ended at 0; Front
  Middle ignored the 20 and finished opening; after a burst 100/0/100/0/50 Front Left read 5% while
  wide open, and closes did nothing until a calibrate). Stop first: 11 of 11 right on Front Middle and
  Front Right, one more unanswered, confirmed by eye. A user stop (`cancelPendingMotion`) clears the
  shade's motion record and drops a re-target still waiting, which answers HomeKit with success.
- **Stop (`HoldPosition`) is back on Gen 2 hubs, as `stopCommand`** (`auto` | `on` | `off`, default
  `auto`). `auto` resolves through `resolveStopCommand` to on for `generationHint === 'gen2'` and off
  for `gen1` and `unknown`. Measured on 2026-11-03: a build 1056 hub halted Front Left (shade
  firmware 2.2.2754) and Front Middle (1.5.1771) about 5.6s into an open, and they stayed there; the
  same shades on build 827 went all the way. Cached accessories are configured before the hub is
  probed, so `applyStopSupport` runs again from `updateHubInfo`. It wires both the bottom and top
  Window Covering services, since stop halts the whole shade.
- **Apple's Home app and Siri do not offer `HoldPosition`** (no stop button; Siri: "Your Front left
  can't do that", Home app on iOS, 2026-11-03). So **`stopSwitch`** (default `false`) adds one
  stateless Switch accessory, Stop Shades (context `stopSwitch: true`), registered by
  `syncStopSwitch` after the probe only when `stopEnabled`, and unregistered when either turns off.
  It sends one `PUT /api/shades?groupId=` `{"shade":{"motion":"stop"}}` per group
  (`PowerViewHub.stopGroup`, groups taken from the shade list) and `motion: "stop"` to any shade with
  no group. On build 1056 a group stop answered in 1.6s with all five shade ids, where five single
  stops take about 1.6s each.
- `PowerViewPlatform.stopShade` sends `motion: "stop"` (`PowerViewHub.stopShade`) and never applies
  the reply: on build 1056 it echoes the move's target (65535 after a stop at 14%), and so does a
  cached read right after it. It first drops the shade's pending debounced values, travel timers,
  verify and earlier stop check, and marks it STOPPED with target = current. `STOP_SETTLE_MS`
  (2000) later, `confirmStop` reads it twice with `refresh=true`. Readings within
  `STOP_SETTLED_TOLERANCE` (655, 1%) are applied. Two readings that differ mean it is still moving:
  stop is sent once more and the check repeats; after that it is read once more
  `STOP_FINAL_READ_MS` (45000) later. Why two reads: Left (17438) missed 3 of 4 stops, and one read
  3s after a missed stop showed it midway (43471) while it went on to close. A timed-out reply is
  never applied and never counts as moving: the shade is read a third time, and without two answers
  it waits for the 45s read. On build 1056 a read of a moving shade took 6–7s or hit the 15s
  timeout, and a single timeout had sent Right a needless second stop.
- **A new move or scene ends a shade's stop check** (`abandonStopCheck`, a per-shade counter
  checked after every read). Before, opening Front Middle 12s after Stop Shades let its check read
  the shade moving, take that for a missed stop and halt it again: it ended at 0% instead of 100%.

### Fixed

- **A command no longer waits behind queued RF reads.** Shade reads and writes shared one FIFO
  queue, so after Stop Shades queued ten reads (about 3s each on build 1056), a close sent from
  HomeKit reached the hub 17–18s later. `queueRequest` now puts a write after the request at the
  head (which may be on the wire) and any writes already waiting, but ahead of waiting reads. On
  build 1056 the same sequence went out 1.2s and 2.8s after the tap, and a move sent straight after
  an RF read was acted on 6 of 6 times.
- **A move queued after a stop or jog is no longer merged into one queued before it.**
  `putShade` merged a new position into any waiting PUT for the shade, so open → stop → close went
  out as close → stop: the shade stopped instead of closing. A queued motion is now a barrier.

### Changed

- The `generationHintFromFirmware` comment said Gen 2 hubs report `mainProcessor.name` "PowerView
  Hub". A build 1056 hub reports "PV Hub2.0" (which `generationHintFromHubName` already matches).
- Position help text names every setting that still asks shades during quiet hours, and both
  settings Pause between shades applies to (#19). Text and tests only.
- README gains a **Tested on** section: which hub builds and shade firmware each part was checked
  against.

## [5.2.1] - 2026-10-22

### Changed

- **Position settings grouped** (#18). The section's items are split by `help` items into Ask hub,
  Ask shades, Quiet hours and In the Home app; every heading after the first starts with `<hr>`.
  `healSweepGapMs` moves to directly after `verifyDelayMs`, since the verify reads go through the
  same RF queue and the pause adds to the wait. `verifyAfterMove`'s description says so. No keys
  or defaults change.

## [5.2.0] - 2026-10-22

Thanks to [@omarshahine](https://github.com/omarshahine) for #5 and #13.

### Added

- **`verifyAfterMove`** (#13, @omarshahine). Off by default. Each shade moved from HomeKit or a
  scene gets one RF read (`updateShade`) `verifyDelayMs` (default 30000, 5000–300000) after its
  last command; every command reschedules the shade's single pending read, so a burst costs one RF
  wake. A mismatch with the target is logged at info, an RF timeout at warn. Pending reads are
  dropped on shutdown. Runs during `quietHours`.
- **`setPositionDebounceMs`** (#5, @omarshahine). Off by default (`0`, capped at 5000).
  `setPosition` answers HomeKit at once and sends only the last value per shade/position after the
  slider has rested that long. Invalid values still fail immediately; pending values are dropped on
  shutdown. The old setter is now `commitPosition`, unchanged.

### Changed

- Dropped `nodemon` and the `watch` script; bumped `typescript-eslint` to 8.72.0 (#17). Dev only.

## [5.1.0] - 2026-10-21

Thanks to [@omarshahine](https://github.com/omarshahine) for #2, #6, #8, #11 and #14.

### Added

- **Shade tools page in the Homebridge UI** (#6, @omarshahine). Check (an RF refresh of one
  shade), Jog, and Calibrate (`motion: "calibrate"`, with an in-page two-click confirmation because
  Config UI X sandboxes the iframe without `allow-modals`, and a re-check two minutes later). A
  Scenes on the hub panel lists each scene's member positions, highlights rails saved partway
  open, and can activate a scene. Logic lives in `src/shadeTools.ts` and goes through
  `PowerViewHub`, so it reuses host validation, timeouts, retries and request spacing; the host
  comes from `config.json` on the server, never from the page. Adds the first runtime
  dependency, `@homebridge/plugin-ui-utils`, which has no dependencies or install scripts.
- **`healSweepIntervalMinutes`** (#14, @omarshahine). Off by default (`0`). Asks every shade over
  RF on that interval, one at a time with `healSweepGapMs` (default 4000, minimum 1000) between
  them, never more often than every 30 minutes, skipped during `quietHours`, and the next interval
  runs from the end of a sweep so sweeps cannot overlap. Corrections are logged at info; a shade
  that does not answer at warn. Shutdown stops a sweep partway.
- **`excludeScenes`** (#2, @omarshahine). Scene names (case-insensitive) or numeric hub IDs to keep
  out of HomeKit. An already-published scene that is then excluded is removed on the next scene
  refresh, through the existing removal sweep and its empty-response guard. Blank, non-string and
  non-integer entries are ignored.
- **`sceneNamePrefix`** (#11, @omarshahine). Text put in front of each new scene switch's name.
  Cached switches are not renamed, so a name changed in the Home app is kept. Default `""`.

### Changed

- **Settings dialog reorganized** (#15). Settings and Shade tools tabs: Config UI X always draws
  the schema form below the custom UI, so the tools tab calls `hideSchemaForm()`. Shades load
  only when that tab first opens. The form now has a `form` layout: name and host, then
  collapsible Position, Scenes, Battery and Advanced sections, with `labelHtmlClass` and
  `labelHelpBlockClass` so list titles and section descriptions match field labels and help text.
  `refreshShades` moves from Advanced to Position. Quiet hours uses From / Until select widgets
  with 12-hour labels; the stored value is still `{ start, end }` integers.
- **"Ask hub" and "ask shades" wording.** Titles, descriptions and the README use "ask hub" for
  cached hub reads and "ask shades" for RF reads. Log lines follow:
  `Startup position sync: …` → `Asking shades at startup: …`, and `Heal sweep: …` →
  `Asking shades on schedule: …`. Setting keys are unchanged.
- `quietHours` descriptions now say it covers the scheduled shade check as well as startup.

### Removed

- `.DS_Store` is no longer tracked, and is ignored (#8, @omarshahine).

## [5.0.3] - 2026-10-18

### Fixed

- A tilted horizontal-vane shade reported 0° tilt when the hub listed the vane position before the
  bottom rail, because applying the bottom rail resets the tilt. The bottom rail is now applied
  first, whatever order the hub uses.

## [5.0.2] - 2026-10-18

### Changed

- README shows the *Verified by Homebridge* badge
  ([homebridge/plugins#1253](https://github.com/homebridge/plugins/issues/1253)). No code change.

## [5.0.1] - 2026-10-02

### Removed

- **Process-wide `unhandledRejection` and `uncaughtException` handlers.** Every plugin shares the
  Homebridge process, so these caught other plugins' crashes too, logged them under this plugin's
  name, and kept the bridge running in an undefined state. Every fire-and-forget promise in the
  plugin already ends in its own `catch`, so none of its own errors depended on them.

### Changed

- `supports-hap` keyword in `package.json`, declaring the transport for the Homebridge UI and
  verification checks.
- CI lints, builds and tests on Node 22 and 24, the lines `engines.node` claims.

### Fixed

- A startup test failed when run between 21:00 and 08:00 local time, because the default quiet
  hours skip the sync it measures. It now pins the clock to noon.

## [5.0.0] - 2026-09-14

### Changed

- **Package renamed to `homebridge-powerview-gen1-gen2`,** and the GitHub repository with it
  (the old URL redirects). `PLUGIN_NAME`, repository, bugs and homepage links follow. No code
  change. "Universal" implied Generation 3 gateway support, which is not planned. A major version
  because a rename does not upgrade in place; Homebridge 2.4.0's `bridgeService` re-associates
  cached accessories whose plugin is missing to the plugin that registers the same dynamic
  platform name (`PowerView`), as long as only one plugin registers it.

## [4.7.0] - 2026-09-13

### Fixed

- **Scenes were marked unsupported on every restart, and each hub request could stall about 4s.**
  Both came from reusing HTTP connections. A build 827 hub keeps the previous request's id on a
  kept-alive connection, so `GET /api/scenes` sent after `GET /api/shades/26835` on the same socket
  is answered as `/api/scenes/26835`: HTTP 404 with the unparseable body
  `{"scene": "error":{"code":"INVALID_SCENE_ID"}}`. A restart with cached shades reads them just
  before the capability probe, so the probe logged `Hub returned malformed JSON for …/api/scenes`
  and set `scenes=false`. Every request now sends `Connection: close`. Against the real hub a
  first-run startup went from 24.5s to 0.6s.
- **A failed request reports its HTTP status even when the body is not JSON.** The body was parsed
  first, so that 404 surfaced as "malformed JSON".
- **Scene activation logs how many shades moved again.** The hub nests the moved shades under
  `scene` (`{"scene":{"shadeIds":[...]}}`), but `activateScene` read a top-level `shadeIds`, found
  nothing, and always logged the bare `Scene <id> activated`. 4.3.1 put that down to a gen1 hub
  omitting the field; that was wrong. A capture of the official PowerView app against a build 827
  hub on 2026-09-13 shows the field present, nested.

### Changed

- The once-per-shade log line no longer says the hub "returns no positions on cached reads". It
  does, for about an hour after a move, scene or refresh, and then drops them; the message now
  says so.

### Removed

- **Hold (`HoldPosition`) is gone, because the hub never honoured it.** It sent `motion: "stop"`,
  which a build 827 hub answers with HTTP 200 and then ignores: a shade told to stop 6s into
  travel closed all the way, and the same with `id` in the body kept opening. The plugin then
  cached the move's target as if the shade had stopped. Accessories cached by older versions have
  the characteristic removed on startup. The official PowerView app has no stop control either.

## [4.6.0] - 2026-09-05

### Added

- **A Generation 3 Gateway is now named as the problem.** Gen 3 serves a different API entirely,
  so every `/api/` path this plugin uses returns 404 and startup failed with a bare `NotFound` —
  nothing to suggest the hub was the wrong generation rather than misconfigured or unreachable.
  When startup fails with `NotFound`, the plugin probes the documented Gen 3 endpoints and, if one
  answers with JSON, says so explicitly.

### Notes

- The probe is deliberately timid, because a false positive is worse than no message: a 3s
  timeout, no retries, and a JSON content type required, so an unrelated web server or captive
  portal on that address is not mistaken for a gateway. It only ever runs after a `NotFound`
  startup failure, never on a working hub.
- **The Gen 3 endpoints come from documentation, not observation** — there was no Gen 3 gateway to
  test against. What is verified is the false-positive side: the probe was run against a real
  Generation 1 hub (build 827) and correctly claimed nothing.
- This does not add Gen 3 support. That would need a second hub client with its own endpoints and
  position encoding.

## [4.5.3] - 2026-09-05

### Changed

- **The plugin now states which hubs it supports where people actually look.** The Homebridge UI
  shows `displayName` and `description`, and neither mentioned hub generations — so someone with a
  Generation 3 Gateway could install it and get nothing but `Failed to start PowerView platform:
  NotFound`. Now `PowerView (Gen 1 & 2)`, with a description naming the generations and the
  features.

### Notes

- The npm package name is unchanged. "universal" does overpromise, but renaming would strand the
  published versions, force every install to be removed and re-added, and change `PLUGIN_NAME`
  again — which is what drops cached accessories and loses their rooms and automations. It would
  also age badly if Generation 3 support were ever added. `displayName` is presentational only, so
  this carries none of that.

## [4.5.2] - 2026-09-05

### Fixed

- **`requestIntervalMs` advertised the wrong default.** The UI schema said `25`, the value that
  caused a gen1 hub to drop connections and lose two of five shades from a group move in 4.1.0.
  The code default went back to `100` in 4.1.1 but the schema was not updated, so anyone accepting
  the value the UI showed would have reproduced the fault.

### Changed

- README brought up to date. Several claims had become false: it said scenes were "probed at
  startup for future use but not exposed as HomeKit accessories yet", that battery levels refresh
  "about every 6 hours", and that Hold jogs the shade. It also documented four of the sixteen
  configuration options, and quoted a log message the plugin no longer emits. Adds a "What this
  fork changes" section and documents scenes.

## [4.5.1] - 2026-09-05

### Fixed

- **HomeKit now reflects a scene as soon as it runs.** The hub expands a scene itself and its
  reply names no shades, so nothing told the plugin where they went — the Home app kept showing
  the old positions until something else happened to refresh each shade, which in practice meant
  closing and reopening it. The scene's membership carries each target position, so activation now
  reads it and updates the shades directly: one cheap request, no RF and no motor wake. *(Corrected
  in 4.7.0: the reply does name the shades, under `scene.shadeIds`, but not their positions.)*

### Changed

- The position-applying half of `updateShadeValues` is now `applyHubPositions`. A scene knows its
  members' positions but nothing about their batteries, and `updateAccessoryInformation` removes
  the Battery service when handed a shade with no battery fields.

## [4.5.0] - 2026-09-05

### Changed

- **A shade reports the commanded position as soon as you tap it, again.** 4.3.0 made the tile
  hold the shade's real position and animate `INCREASING`/`DECREASING` through an estimated
  travel. That is truer, but the number does not move for up to 16 seconds and reads as
  unresponsive. The responsive behaviour is the default once more.
- The travel animation is kept behind **`reportTravel`** (default `false`). It is the honest
  option, and the one to turn on if a shade failing to move silently is worse for you than a tile
  that runs ahead of it.
- Setting a position logs the hub's reply again, restoring the completion line that 4.3.0 removed.

### Notes

- With `reportTravel` off, a move that never physically happens — obstruction, flat battery, RF
  never landing — is not noticed until something refreshes that shade, because the position
  reported to HomeKit comes from the hub echoing the command rather than from a measurement.
- Timing was compared against the original 3.1.3 for a five-shade set: the dispatch path is
  unchanged, same queue and same 100ms spacing, ~950ms for five writes in both. The difference
  people feel is entirely in when the tile updates, not in when the motors start.

## [4.4.0] - 2026-09-04

Security hardening, from an audit of the whole plugin. No known vulnerability was
being exploited; these close attack surface and failure modes rather than fix a
live compromise. The plugin has **no runtime dependencies**, so it carries no
supply-chain surface, and `npm audit` reports zero for both runtime and dev.

### Fixed

- **Shade names can no longer forge log entries.** Names arrive base64-encoded from the hub and
  are printed with `%s` and used as HomeKit display names, unfiltered. A name containing a newline
  fabricated whole log lines; one containing ANSI escapes could rewrite the terminal of whoever
  read the log. Control characters (C0, DEL, C1) are now stripped and names capped at 64
  characters.
- **A name that was never base64 is no longer mangled.** `Buffer.from(x, 'base64')` never throws —
  it silently discards invalid characters — so the old `try/catch` was unreachable and a plain
  name came back as mojibake. The encoding is now checked before decoding.
- **Hub responses are capped at 2MB and read as a stream.** `res.json()` buffered whatever the hub
  sent with no ceiling, so an oversized body could exhaust memory and take the whole Homebridge
  process down, every other plugin with it. The request timeout does not help: it bounds a stalled
  socket, not a fast enormous one. An over-large `content-length` is refused without reading.
- **Malformed JSON is reported as malformed**, not as an unreachable hub. New `MalformedBody` and
  `ResponseTooLarge` error codes.
- **The configured `host` is validated.** It is interpolated into `http://${host}${path}`, so a
  value carrying a path, query, fragment, embedded credentials or a scheme sent every request
  somewhere other than the hub. Only a hostname or IP with an optional port is accepted; anything
  else is refused with a warning and the default used.

### Changed

- The publish workflow declares `permissions: contents: read`, instead of taking the repository
  default for `GITHUB_TOKEN`.
- Test doubles for hub responses are real `Response` objects, so body streaming and size limits
  behave as they do in production rather than being faked.

### Notes

- **The hub itself has no authentication and no TLS.** Anyone on your network can command your
  shades without going near Homebridge. The plugin inherits this and cannot fix it; keep the hub
  off guest or IoT-accessible networks if you segment them.
- A request can still stall others for up to 45s (15s timeout x 3 attempts, all serialised). That
  is a deliberate trade for not losing a command on a dropped connection. Reads are unaffected —
  they answer from cache.

## [4.3.2] - 2026-09-04

### Fixed

- Lint error in the test suite that failed the release build (`no-unused-vars`). No runtime change.

## [4.3.1] - 2026-09-04

### Fixed

- **Scene activation no longer reports a shade count it does not have.** `activateScene` defaulted
  a missing `shadeIds` to an empty list, so a gen1 hub — which answers an activation without that
  field — produced `Scene 4102 activated (0 shade(s))` while five shades were visibly moving. The
  count is now logged only when the hub supplies one. *(Corrected in 4.7.0: the hub does send
  `shadeIds`, nested under `scene`.)*

### Notes

- Scene activation is no longer unverified: it was confirmed end to end against a live scene on a
  gen1 hub (build 827), activated from the HomeKit switch, moving five shades to the scene's
  position.

## [4.3.0] - 2026-09-04

### Added

- **Hub scenes are exposed as HomeKit switches** (`exposeScenes`, default on). Activating one is a
  single hub call that the hub expands itself, so every motor gets its RF command at once. Driving
  the same shades individually costs one serialised write each and they visibly stagger — this is
  why a Pebble remote closes a group in unison and the plugin could not. Nothing appears unless
  scenes are defined in the PowerView app. Switches are stateless: they fire and reset.
- Scene accessories survive restarts, and are never removed on an empty scene list — the same
  rule that stopped a partial response destroying shade accessories in 4.1.2.

### Changed

- **Shades are reported as moving rather than arrived.** `setPosition` fed the hub's PUT reply
  into `CurrentPosition`, and that reply echoes the target, so a shade with seconds of travel left
  read as already there; `PositionState` was hardcoded to `STOPPED`, the only value it ever took.
  `TargetPosition` is now the commanded value, `CurrentPosition` stays where the shade is, and the
  state reports `INCREASING`/`DECREASING` until the estimated travel elapses. A re-target
  mid-travel cancels the previous arrival, which would otherwise land later and park the shade at
  a position it had been steered away from.
- **Startup no longer waits on the position sync.** It does an RF read per shade the hub has no
  position for — five motors and 82 seconds from init to ready in one observed startup. It now
  runs behind launch and abandons itself on shutdown.

### Notes

- Arrival is estimated from `SHADE_FULL_TRAVEL_MS` (20s for the full range) rather than polled.
  Confirming it would mean an RF round-trip that wakes the motor again the instant it stopped. Any
  later refresh corrects the value.
- Scene **activation** is implemented against the documented PowerView v2 API but has not been
  verified against a live scene, because the hub it was developed on has none defined.

## [4.2.0] - 2026-09-04

### Changed

- **HomeKit position reads no longer wait on the hub.** The non-blocking work in 1061351 removed
  only the RF refresh from the read path; every read still awaited a cached hub round-trip. Those
  are serialised, so opening the Home app — which reads every characteristic of every shade at
  once — queued them and the later ones exceeded HomeKit's budget, logging "read handler was slow
  to respond" (15 in one startup on a five-shade system). A read with a cached position now
  answers immediately and refreshes behind the answer. `refreshShades` and `strictErrors` both opt
  into hitting the hub and keep the blocking path.
- **Background refreshes no longer wake the motor.** `scheduleBackgroundRefresh` always passed
  `refresh=true`, an RF round-trip that spins the shade and takes seconds. That is now reserved
  for the case it was meant for — the hub having no position at all. Servicing an ordinary read
  uses the cheap cached read, rate limited to one per shade per
  `BACKGROUND_REFRESH_INTERVAL_MS` (10s) so a burst of reads cannot stack up.

## [4.1.2] - 2026-09-04

### Fixed

- **A partial hub response no longer destroys HomeKit accessories.** `updateShades()`
  unregistered any accessory missing from a *single* `/api/shades` response. Upstream guarded
  against the list request outright failing, but not against it coming back short — and a gen1
  hub under load does answer short. Observed live: three of five shades were unregistered in one
  poll, taking their rooms and automations with them, and "close all" then moved only the two
  that survived. A shade must now be absent from `SHADE_REMOVAL_THRESHOLD` (3) consecutive lists
  before its accessory is removed, each miss is logged, and an empty list never prunes anything.

## [4.1.1] - 2026-09-04

### Fixed

- **A dropped connection no longer loses the command outright.** Only HTTP 423 was retried, so a
  bare `fetch failed` — which is what a gen1 hub gives you when it drops a TCP connection while
  its radio is transmitting — threw immediately and the shade never moved. Transient network
  failures now retry three times, 500ms apart.

### Changed

- **`requestIntervalMs` returns to a 100ms default**, reverting the 25ms introduced in 4.1.0. The
  probe behind that number ran cached reads, which never engage the hub's radio; writes do. In
  practice a five-shade group move at 25ms lost two shades to dropped connections. The option
  stays, so the spacing can still be retuned — against writes, not just reads.

## [4.1.0] - 2026-09-04

### Added

- `requestIntervalMs` (default `25`), exposed in the Homebridge UI schema. Spacing between
  serialised hub requests, so a hub that struggles under load can be given more room without a
  code change.

### Changed

- **HomeKit writes now overtake background reads.** The request queue was strictly FIFO, so a
  shade command issued while a refresh was in flight waited for that refresh and for every read
  queued ahead of it. Writes now run first, FIFO within a priority, still one request at a time
  because the hub cannot do better.
- **Request spacing drops from 100ms to 25ms.** Measured, not guessed: 30 serialised reads
  against a gen1 hub on build 827 at 100/50/25/10/0ms spacing returned 30/30 valid responses in
  every condition — no bad status, no malformed JSON, no timeouts — with response times flat at
  ~70ms. 25ms keeps headroom rather than removing the guard.
- The spacing delay no longer runs after the final request, only between requests.

### Notes

- This takes roughly 375ms off a five-shade group move, but does not make shades move in unison.
  Five sequential round-trips are ~350ms of irreducible spread. Only a hub scene, which is one
  call the hub expands itself, can move a group together — scene support is not implemented yet.

## [4.0.0] - 2026-09-04

First release under the name **homebridge-powerview-universal**. Consolidates the
`3.1.4-local.1` … `3.1.4-local.8` working versions, none of which were published.
All hub behaviour below was verified against a PowerView hub on firmware build 827.

Major rather than minor: the npm package is renamed, so this does not upgrade in
place — the old package must be uninstalled and this one installed. `PLUGIN_NAME`
changes with it, which migrates the cached accessories. Battery polling also
changes from on-by-default to off-by-default.

### Added

- `batteryPolling` (boolean, default `false`) and `batteryPollAt` (`"HH:MM"`, default `14:00`)
  config options, both exposed in the Homebridge UI schema.
- `syncPositionsOnStart` (boolean, default `true`) and `quietHours` (default 21:00–08:00).
  Homebridge can restart unattended, so the startup position sync is skipped inside the quiet
  window rather than being free to wake every motor at 03:00.
- `PowerViewHub.stopShade()`; `jogShade` and `stopShade` now share one `motionRequest` path.
- An ISC `LICENSE` file, naming the full copyright chain from 2018 onward.

### Changed

- **Battery polling is now opt-in and off by default.** It previously ran every 6 hours on a
  timer anchored to plugin start, with no config option. `updateBatteryLevel=true` is an RF
  round-trip that wakes the shade motor — 3.73s against 0.08s for a cached read, audible, and it
  nudges the shade. On a 6-hour period at least one poll always landed overnight regardless of
  restart time; observed waking a household at 05:54 (5 shades). The hub already refreshes
  battery weekly on its own, which is what makes off-by-default correct rather than merely quiet.
- Polling, when enabled, runs **once per day at a configurable local time** instead of on an
  interval. The next deadline is recomputed from the current time after every run, so the poll
  stays pinned to the same wall-clock time across DST changes. Runs are logged at `info`; the old
  poll logged nothing on success, which is why the shade movement could not be attributed.
- **Shade behaviour is resolved from ShadeCapabilities, not from a hand-picked type list.** The
  old `SHADE_TYPE_IDS` knew 6 shade types; the PowerView Hub REST API v2 appendix
  (jlaur/hdpowerview-doc v1.0.4) documents **26**, mapped onto 10 capability classes. That left
  20 types falling through to "unknown type, assuming roller", and for 17 of them roller is
  wrong. Capability now comes from the hub's own `capabilities` field when it reports one, and
  from the documented type table otherwise — older hubs, including build 827, omit the field.
- **Unsupported capabilities are stated rather than silently mistreated.** Capability 6 runs its
  primary rail *reversed*, 2 and 5 tilt through 180 degrees rather than the 90 the tilt maths
  assumes, and 8/9 have overlapped panels. These are still driven as rollers, but now warn once
  per shade that position or tilt may be wrong instead of reporting a confident wrong number.
  Implementing their maths needs hardware to verify against, so it is not guessed at here.
- **Every hub request is serialised through one promise chain** with `REQUEST_INTERVAL_MS`
  spacing. Legacy hubs answer one request at a time, but only shade requests went through the
  existing queue — capability probes and `/api/shades` called `fetchJson` directly and raced it,
  which made the hub time out and return truncated JSON mid-response.
- **HomeKit position reads answer from cache immediately** and refresh in the background, deduped
  per shade. The old blocking refresh inside the read handler routinely exceeded HomeKit's read
  budget and logged "read handler didn't respond at all". `strictErrors` keeps the old blocking
  behaviour, since that option exists to surface hub failures.
- Positions are logged only when they change, and the message says what it is. `Set for <id>`
  fired at `info` on every read — four identical lines in twelve seconds during one restart — and
  read like a write when it was a read.
- Errors preserve the underlying failure as `cause`, and timeouts are distinguished from
  unreachable hosts instead of every failure reporting as Unreachable.
- `PositionMap` is defined once in `shadeUtils.ts` instead of being redeclared in `platform.ts`.
- **A poll costs half the hub requests it did.** `/api/shades` already returns each shade, but the
  loop then called `getShade(id)` for every one, so N shades meant 2N serialised requests per
  cycle. The per-shade fetch now runs only when the list entry carried no positions.
- Package renamed to `homebridge-powerview-universal`; repository, bugs, and homepage links now
  point at this fork rather than upstream's tracker.

### Fixed

- **Hub requests still overlapped after being serialised.** `serialize()` wrapped only the
  `fetch()` call, and `fetch()` settles when response headers arrive, not when the body is
  consumed — so `response.json()` ran after the chain had already advanced, streaming one
  request's body while the next request was already in flight. That is the overlap that makes a
  legacy hub time out and return truncated JSON. The body is now read inside the serialised
  section.
- **A tilt report no longer forces the shade to read as fully closed.** Both vanes branches
  called `applyCoveringPosition(service, 0)`, so `posKind1` set the real position and `posKind2`
  immediately overwrote it with 0 in the same loop. Every tilt-capable shade reported itself
  closed while the cache held the true value.
- **Restarts no longer report a shade as fully closed.** `configure()` seeded `CurrentPosition`
  to 0 unconditionally, running on every restart immediately after the cache was restored — so
  the persisted position was overwritten before HomeKit could read it. It now seeds from the
  cache for both rails.
- **The shade poll no longer survives shutdown.** Its `setTimeout` handle was never stored, so
  the shutdown listener could not clear it; with `pollShadesForUpdate` enabled, shutdown left a
  30s loop hitting the hub and holding the event loop open.
- **A position set for a removed shade reports an error instead of crashing.** `setPosition` read
  `this.accessories[shadeId].context` unguarded, before its `try`, so the throw escaped the
  HomeKit handler as an unhandled rejection.
- **Every reported position kind is read.** The loop terminated at the first absent `posKind` and
  silently dropped every kind after a gap.
- **An unusable position value is skipped rather than cached as `NaN`.** HAP rejected the
  characteristic write, but the `NaN` still reached the position map, where it defeats
  `positionMapsEqual` — `NaN !== NaN` — so every subsequent read rewrote the accessory cache file.
- **Requests could hang forever.** Node's `fetch` has no default timeout and the hub serialises
  every call through one queue, so a half-open socket stalled all later requests indefinitely.
  Every hub request now carries a 15s `AbortController` timeout.
- **A throw during shade URL construction wedged the queue**, leaving pending HomeKit requests
  unresolved. The URL is built inside the `try` and the queue advances in a `finally`.
- **Battery percentage was wrong above 100.** `batteryStrength` is tenths of a volt against an
  18.0V nominal pack (matching aiopvapi), not a 0–100 percentage. Any Gen 1/2 reading above 100
  fell through to a four-value `batteryStatus` lookup, so a pack at 67% and one at 98% both
  reported 90%.
- **`batteryStrength` 0 is treated as unknown rather than empty.** The hub reports 0 for shades it
  has not polled, which raised a false low-battery warning.
- **`StatusLowBattery` is no longer set on `AccessoryInformation`**, where it is not a valid
  characteristic and logged a warning per shade per refresh.
- **Hub generation is derived from the firmware revision.** Both Gen 1 and Gen 2 report
  `mainProcessor.name` as "PowerView Hub", so the name never matched.
- **`Invalid position value received` no longer fires on the happy path.** This hub returns no
  `positions` object at all on a cached read — positions exist only after a `refresh=true` read or
  a set — so the key was absent on *every* HomeKit position read and the warning fired 77 times in
  one day. Absent is now `debug` plus a once-per-shade `info`; only a key present with unusable
  data still warns, and the message includes the value.
- **Last known positions persist across restarts**, written to accessory context via
  `api.updatePlatformAccessories()` and restored (validated) in `configureAccessory`. A cold cache
  no longer falls through to `resolvePositionValue()`'s `0`, which reads as "fully closed" in the
  Home app until the background refresh lands, and sticks if that refresh times out. Writes are
  guarded by `positionMapsEqual` so an ordinary read that changes nothing does not rewrite the
  cache file.
- **Positions are re-synced once at startup** for shades the hub has no position for. Persisting
  the cache meant `value == null` was never true, so `scheduleBackgroundRefresh` never fired and a
  stale position could be served indefinitely.
- **HoldPosition jogged the shade instead of stopping it.** HomeKit's `HoldPosition` was wired to
  `jogShade`, so asking a shade to stop made it wiggle. It now sends `motion: "stop"`, and is no
  longer gated on `jogSupported`, which was the wrong capability. *(Removed in 4.7.0: the hub
  ignores `motion: "stop"`.)*
- **`PLUGIN_NAME` now matches the package name.** It still read `homebridge-powerview-3` after the
  rename, so Homebridge could not resolve the plugin when registering accessories and logged a
  warning for every shade.
- `probeEndpoint` is given an absolute URL so it cannot throw if it is ever used.

### Removed

- `SHADE_TYPE_IDS`. It listed type 16, which appears nowhere in the published table, and omitted
  the actual vertical shades (54, 55, 56).

### Notes

- Disabling the battery poll does not remove battery reporting: `batteryStrength` /
  `batteryStatus` ride along on ordinary hub reads and still update the HomeKit Battery service.
  The poll only forces a fresh measurement from the shade.
- On first start under the new package name, Homebridge re-associates cached accessories from
  `homebridge-powerview-3` to `homebridge-powerview-universal` automatically and logs that it did
  so. Uninstall the old package first — if both are installed, both claim the `PowerView` platform
  name and cached accessories are dropped instead.

## [3.1.2] - 2026-05-18

### Added

- [RELEASE_NOTES.md](RELEASE_NOTES.md) for publish/GitHub release copy (see Latest section when tagging)

## [3.1.1] - 2026-05-18

### Added

- Linked HomeKit **Battery** service per shade with `BatteryLevel` (0–100%) so battery appears in the Home app, not only the low-battery flag on Accessory Information

## [3.1.0] - 2026-05-18

### Added

- Structured hub HTTP handling with retry on HTTP 423 (hub busy / maintenance)
- Startup capability probe for `/api/fwversion`, `/api/scenes`, and `/api/scenecollections` (logged; scenes not exposed in HomeKit yet)
- Position cache: refresh timeouts and transient read failures return last known values (unless `strictErrors` is enabled)
- `strictErrors` platform option for fail-fast HomeKit reads (debugging)
- Per-shade `FirmwareRevision` and `StatusLowBattery` in Accessory Information when the hub reports them
- Periodic battery refresh via `updateBatteryLevel` (every 6 hours)
- Top/bottom shade top-rail display name from hub `secondaryName`
- **Hold** (Hold Position) and **Identify** wired to hub jog motion where supported
- Vitest unit tests for HTTP classification, position parsing, and battery helpers

### Changed

- `putShade` queue merge skips invalid position kind 4 (hub position error) from PUT bodies
- Shade list failures during poll no longer remove existing accessories

## [3.0.0] - 2026-05-17

### Added

- Homebridge **2.x** support (ESM plugin, Node.js 22/24)
- TypeScript source, `config.schema.json` for Homebridge UI settings
- `AccessoryInformation` service on each shade (manufacturer, hub firmware model)

### Changed

- **Breaking:** npm package renamed to `homebridge-powerview-3`
- **Breaking:** plugin identifier for accessory cache is now `homebridge-powerview-3` (was `homebridge-powerview`)
- Replaced deprecated `request` with native `fetch`
- Replaced `getServiceByUUIDAndSubType` with `getServiceById` (Homebridge 2 API)
- Removed use of removed `accessory.reachable` property
- Modern `api.registerPlatform(PLATFORM_NAME, PowerViewPlatform)` registration
- Hub HTTP client uses Promises/async throughout

### Fixed

- `putShade` queue merge incorrectly deleted bottom position (`delete position[...]` → `delete positions[...]`)
- `jogShade` callback referenced undefined `position` variable
- `removeService` called when top Window Covering service did not exist

### Migration from homebridge-powerview-2

1. Uninstall `homebridge-powerview-2`, install `homebridge-powerview-3`.
2. Keep `"platform": "PowerView"` in `config.json`; add `"name": "PowerView"` if using the config UI schema.
3. Restart Homebridge. Remove duplicate shade accessories from the Home app if the cache identifier change left orphans.

Requires Homebridge **^1.8.0 || ^2.0.0** and Node **^22.12.0 || ^24.0.0**.

## [1.0.9] and earlier

See [homebridge-powerview-2](https://github.com/owenselles/homebridge-powerview-2) history.
