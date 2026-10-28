# Submitting to awesome-dsh-plugin

This is the submission file and checklist for
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
The list no longer edits READMEs by hand: one YAML file per plugin lives in
`data/plugins/`, and the READMEs are generated after merge.

## The entry

Save this as `data/plugins/xwzkj__dsh-audio-alert.yml` in your fork. The
filename is derived from the repository URL, so both must stay exactly like
this.

```yaml
url: https://github.com/xwzkj/dsh-audio-alert
name: xwzkj/dsh-audio-alert
category: notify
description:
  en: "Host-side session alerts for DSH Web on Linux: tones played through the server's audio device when a turn ends, fails, or waits for approval or an answer — no browser needed."
  zh: 'Linux 上 DSH Web 的宿主侧会话提醒：回合结束、出错或等待审批/回答时，服务器音频设备直接发声，无需打开浏览器。'
```

The English description contains `: `, so it **must** stay quoted. An
unquoted `Linux: a chime` is parsed as a nested YAML mapping and the entry
fails validation.

Do not add an `npm:` key. The list detects the npm package automatically from
the package's `repository` field, and a hand-written `npm:` key is rejected.
Do not add `icon:` or `tarball:` unless you really publish one; the npm package
is enough, and the repository installs from source without a build step.

## Checklist

- [ ] **Push the repository.** `xwzkj/dsh-audio-alert` exists but is empty.
      Push the code to `main`.
- [ ] **Add the `dsh-plugin` topic** to the repository (required). Suggested
      extra topics: `dsh`, `deepseek-harness`, `linux`, `audio`, `notification`,
      `pipewire`, `pulseaudio`, `alsa`.
- [ ] **Wait for the 1-day repo age.** GitHub created the repository at
      `2026-10-26T01:22:34Z` (09:22 Beijing time). The gate refuses submissions
      until it is at least 1 day old, so open the PR no earlier than
      **2026-10-27 09:22 Beijing time** (09:30 is safer). The check uses the
      repository's `created_at`, not the first commit.
- [ ] **Confirm the manifest.** `package.json` declares
      `dsh.bundle.patch: "./cordis.patch.yml"` and the file exists. This is the
      most common reason submissions are rejected; it is already done here.
- [ ] **Confirm the code is real and working.** This repository has the host
      plugin, five runtime-synthesized tones, 25 tests (unit, manifest and WAV
      synthesis). No build step, no dependencies.
- [ ] **Publish to npm (recommended, not required).** The name
      `dsh-audio-alert` was unclaimed on 2026-10-26. From this directory:

      ```bash
      npm login --registry=https://registry.npmjs.org/
      npm publish
      npm view dsh-audio-alert version repository.url
      ```

      `publishConfig.registry` already points at `registry.npmjs.org`, so the
      local `npmmirror` setting does not redirect the publish. The package's
      `repository` field points back at the listed repo, which is what lets the
      list link the npm package to the entry.
- [ ] **Fork awesome-dsh-plugin, add the one YAML file, open a PR.** Do not edit
      either README by hand. Do not include unrelated entry changes.
- [ ] **Push fixes to the same branch** if CI asks for something. No new PR is
      needed.

## Suggested PR text

Title:

```text
Add xwzkj/dsh-audio-alert (notify)
```

Body:

```markdown
Adds `xwzkj/dsh-audio-alert`, a host-side alert-sound plugin for Linux.

- Runs in the DSH host process and plays through PipeWire, PulseAudio or ALSA,
  so it still sounds with the browser closed.
- Turn end, error and output-limit events have their own tones; a policy-blocked turn uses the error tone.
- Approval and question waits repeat on a 45s / 90s / 3m / 5m backoff (12
  repeats at most) and stop when the request is answered.
- `package.json` declares `dsh.bundle`; the repo has working code, 25 tests
  and a GitHub Actions workflow.

Only the entry file is added. READMEs are left to the generator.
```

## Why this is not a duplicate

The `notify` category already has several sound plugins, but most are
browser-side: Web Audio in the page, or a settings panel that plays in the
browser. This one is deliberately the other shape — it starts a system player
from the host process, has no web UI, and therefore keeps working when the
browser is closed. The repeating approval/question reminder is part of that
same design. The entry description states both facts and nothing more; do not
turn the PR into a comparison or a sales pitch.

## What the gate checks

In order, per the contributing guide:

1. at most 3 new entries per PR (this PR adds one);
2. `dsh.bundle` in the repository's `package.json`;
3. repository age of at least 1 day;
4. `awesome-lint` and the site build (locale parity, separators, dates,
   screenshots).

A maintainer then reads the repository, compares the description with the code,
and may change the category. Categories are not a reason for rejection.

## Reference

- Contributing guide: <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>
- Category list: `agi` `ui` `usage` `theme` `model` `identity` `session`
  `memory` `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow`
  `git` `notify` `dev` `security` `remote` `market` `fun`
