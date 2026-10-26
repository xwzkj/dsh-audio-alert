# dsh-audio-alert

[中文](https://github.com/xwzkj/dsh-audio-alert/blob/main/README.md) | English

Host-side alert sounds for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on Linux. The plugin runs inside the DSH host process and plays through the machine's own audio stack, so a turn can finish, fail, or stop to ask you something while the browser is closed — and you still hear it.

It is not a push service. Nothing leaves the machine: no network, no bot token, no phone. It fits a host that sits next to you with a speaker attached, such as a home server.

The five tones are synthesized in JavaScript on first play (48 kHz/16-bit/stereo); no 1.3 MB of WAV files ship in the package. The npm tarball is about 21 KB (down from 1.0 MB).

[![test](https://github.com/xwzkj/dsh-audio-alert/actions/workflows/test.yml/badge.svg)](https://github.com/xwzkj/dsh-audio-alert/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/xwzkj/dsh-audio-alert/blob/main/LICENSE)

> **AIGC disclosure.** The code, sound synthesis, tests and documentation were produced by an AI coding agent (DeepSeek Harness, model `deepseek-v4.1-flash`) under human requirements and review. Version 0.2.0 was exercised on a real machine: unit tests, real event triggers, and actual playback over Bluetooth and ALSA. The human maintainer decides what ships; the AI gives no warranty. Read the code before running it — in particular, it starts local audio-player subprocesses.

## Why host-side?

| | A typical browser-side sound plugin | dsh-audio-alert |
| --- | --- | --- |
| Browser open | required | not required |
| DSH host process running | not enough on its own | required |
| No GUI / SSH-only host | no sound | sound, if the host has an audio session |
| Configuration | often a settings panel | the profile's YAML patch |

The trade-off is deliberate: no browser UI, no network, no extra service. You get a small host plugin and a YAML file.

## What you hear

| Event | Sound | Behaviour |
| --- | --- | --- |
| Turn completed | Two rising bell notes | Soft, not shrill |
| Turn failed | Two falling low notes | Default error cue |
| Turn blocked by policy | Same tone as an error | Controlled by `events.blocked` |
| Output limit reached | Two neutral notes | Distinct from "completed" |
| **Approval waiting** | Three rising wooden notes | Repeats until answered |
| **Question / plan review waiting** | Two rising notes | Repeats until answered |

The two waiting events sound immediately, then repeat after 45 s, 90 s, 3 min, and every 5 min after that — 12 repeats at most. The repeat stops as soon as the request is resolved. Subagent turns are silent by default (`includeSubagents: true` changes that); approvals and questions raised by subagents are always silent.

## Requirements

- Linux with one of `pw-play` (PipeWire), `paplay` (PulseAudio), or `aplay` (ALSA).
- Node.js 20 or newer.
- The DSH host must run as a user that has an audio session. A headless systemd service usually needs `loginctl enable-linger <user>` and the right `XDG_RUNTIME_DIR`; the plugin fills in the usual `/run/user/<uid>` values when they are missing and the runtime directory exists, but it cannot create an audio session.

## Install

```bash
# from npm, once published
dsh plugin --profile web add dsh-audio-alert

# straight from GitHub
dsh plugin --profile web add github:xwzkj/dsh-audio-alert

# local checkout, for development
dsh plugin --profile web add link:/path/to/dsh-audio-alert
```

`dsh plugin` forwards to pnpm in the profile directory and adds the package to `dsh.profile.bundles`. Restart the host process afterwards — for a systemd unit that is usually:

```bash
sudo systemctl restart dsh-web
```

The unit name depends on your setup. No configuration is required after installation: the package's own `cordis.patch.yml` inserts the `audio-alert` row with the defaults.

## Configure

Settings live in the profile's user patch, by default:

```text
~/.dsh/profiles/<profile>/cordis.patch.yml
```

If `DSH_HOME` is set, use `$DSH_HOME/profiles/<profile>/cordis.patch.yml` instead. Add an override with the same `id` as the row the package inserted:

```yaml
- id: audio-alert
  name: dsh-audio-alert
  config:
    volume: 0.6                  # linear 0..1; ignored by aplay
    quietHours: "21:30-05:30"    # quiet window, may cross midnight
    quietFactor: 0.6             # volume multiplier inside the window
    sink: BDM3P                  # optional; a name from `wpctl status` / `pactl list short sinks`
    verbose: true                # optional: log playback decisions
```

Keep `id: audio-alert`; that is how the override finds the row. If your patch already has an `audio-alert` entry, merge the `config` keys into it instead of adding a second one. Restart the host after editing.

### All options

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `player` | `'auto'` | `auto`, `pw-play`, `paplay`, `aplay`, or an absolute path |
| `sink` | `''` | PipeWire/PulseAudio sink name; empty means the system default |
| `device` | `''` | ALSA device for `aplay`, e.g. `plughw:CARD=PCH,DEV=0` |
| `volume` | `0.6` | Linear volume, 0..1; `aplay` has no volume flag and ignores it |
| `sounds` | `{}` | Optional custom WAV overrides; empty means the built-in runtime synthesis. Relative paths resolve from the package root |
| `events` | all `true` | Per-event switches: `done`, `approval`, `question`, `error`, `maxTokens`, `blocked` |
| `approvalDelaysMs` | 45 s, 90 s, 3 m, then 5 m ×9 | Repeat delays for waiting events, in milliseconds; 12 entries total |
| `includeSubagents` | `false` | Also play turn-end sounds for subagent sessions |
| `quietHours` | `''` | Quiet window such as `"21:30-05:30"`; empty disables it |
| `quietFactor` | `0.6` | Volume multiplier inside the quiet window |
| `approvalBypassesQuiet` | `false` | Play approval, question, error and blocked at normal volume inside the quiet window; `done` and `maxTokens` still use `quietFactor` |
| `verbose` | `false` | Write playback decisions to the host's stderr |

`blocked` uses the error tone but has its own switch. Setting `events.blocked: false` silences only policy-blocked turns, not ordinary errors.

## Audio output

The plugin picks the first available player in this order:

1. `pw-play` for PipeWire;
2. `paplay` for PulseAudio;
3. `aplay` for bare ALSA.

With no `sink`, it uses the current default device. On PipeWire or PulseAudio, switch the desktop to a Bluetooth speaker and the next alert follows it — no restart.

- `sink` is matched against PipeWire's `node.name`, `node.description` and `node.nick` (substring match). On PulseAudio it is passed to `paplay --device`.
- If the named sink is missing, the plugin falls back to the default device, then to `aplay` when `device` is set.
- `device` is used by `aplay` and as a last-resort fallback if a PipeWire/Pulse player fails.
- `aplay` has no volume flag. Set the system mixer with `amixer` or `alsamixer`; `volume` is ignored on that path.

### Headless hosts

A systemd service usually starts without `XDG_RUNTIME_DIR` or `DBUS_SESSION_BUS_ADDRESS`, and `pw-play`/`paplay` then cannot reach the sound server. The plugin fills in `/run/user/<uid>` and `unix:path=/run/user/<uid>/bus` when they are absent and the runtime directory exists, but the user still needs a session:

```bash
loginctl enable-linger <user>
```

Run DSH as that user. If DSH runs as root, it will look at root's session, which normally has no audio; running the host as the desktop user is the supported setup. In a container, pass through `/run/user/<uid>` and the PipeWire/Pulse socket, or there will be no sound.

## Troubleshooting

```bash
./test-alert.sh            # render to a temp dir and play every built-in tone
./test-alert.sh 80         # set ALSA Master to 80% first (aplay machines only)
```

The script is included in the npm package. If you installed the plugin as a dependency, run it from the package directory, for example `node_modules/dsh-audio-alert/test-alert.sh`.

If there is no sound, check in this order:

1. `which pw-play paplay aplay` — is a player installed?
2. Render a WAV and play it manually: `node scripts/render-sounds.js /tmp/alerts`, then `pw-play /tmp/alerts/done.wav` (or `paplay` / `aplay`) — does the player itself work?
3. `wpctl status` (PipeWire), `pactl list short sinks` (PulseAudio), or `alsamixer` — is the output muted or at zero?
4. Set `verbose: true` and look for `[audio-alert]` lines in the host's stderr.
5. If the sink name is wrong, find it with `wpctl status` / `pactl list short sinks`, or inspect `pw-dump` for the PipeWire node name.
6. On a headless host, check `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, and `loginctl show-user <user> | grep Linger`.

If `pw-play` works in your shell but the plugin is silent, the host process probably sees a different environment. Compare `systemctl show dsh-web -p Environment` with your shell's variables.

## Security and privacy

- No network requests, telemetry, or remote services.
- The plugin starts `pw-play`, `paplay`, or `aplay` as child processes, and runs `pw-dump` when `sink` is set and `pw-play` is the selected player.
- `player` may be an absolute path, so it can start any executable you name. Only point it at a player you trust.
- It reads only its synthesis code or custom WAV paths in `sounds`; the first play writes a cache under `$XDG_CACHE_HOME/dsh-audio-alert` (default `~/.cache/dsh-audio-alert`), and it reads nothing from session messages or workspace files.
- `verbose` logs event keys and player labels, not message content.
- Review the code before installing it on a machine you care about; see the AIGC disclosure above. The plugin is MIT-licensed and has no runtime dependencies beyond Node and the system players.

## Development

These commands are for a source checkout. The npm tarball ships only the runtime files (the plugin entry, `sounds.js`, the render script and `test-alert.sh`), not the test suite.

```bash
node --test                                  # 24 tests: quiet hours, config merge, argv, manifest, WAV synthesis
node scripts/render-sounds.js /tmp/alerts    # render the five tones to WAV for listening
./test-alert.sh                              # render to a temp dir and play them
npm run check:pack                           # inspect what would be published
```

The sound design lives in `bell`, `wood` and `softLow` in `sounds.js`. Rendered WAVs are cached under `$XDG_CACHE_HOME/dsh-audio-alert` (default `~/.cache/dsh-audio-alert`); bump `SOUND_VERSION` or delete that directory after changing the synthesis, then restart the host. `test/manifest.test.js` guards the `dsh.bundle` manifest and packaged files; `test/sounds.test.js` checks the WAV header, duration, determinism and cache.

To submit this plugin to the awesome list, see [docs/awesome-dsh-plugin.md](https://github.com/xwzkj/dsh-audio-alert/blob/main/docs/awesome-dsh-plugin.md).

## License

MIT — see [LICENSE](https://github.com/xwzkj/dsh-audio-alert/blob/main/LICENSE).
