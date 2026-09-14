# mobile-app-setup

Reference guides for setting up build flavors (dev/prod/etc.) in mobile app projects. Each framework gets its own folder with a `SKILL.md` that doubles as a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) — droppable into `~/.claude/skills/<name>/` or a project's `.claude/skills/<name>/` for reuse across sessions.

## Contents

| Folder | Covers |
|---|---|
| [`flutter/`](flutter/SKILL.md) | Flutter native flavors (Android `productFlavors` + iOS Xcode targets/schemes), `flutter_dotenv` env wiring, signing, CI, and common pitfalls. Illustrated with a fictional app, "Recipix". |

## Usage

Each `SKILL.md` is self-contained and framework-specific — identify the target project's actual framework (Flutter vs React Native/Expo vs native) before applying one, and swap the example identifiers (package names, bundle ids, keys, domains) for the real project's own.

To use a guide as a live Claude Code skill:
```bash
mkdir -p ~/.claude/skills/mobile-app-setup-flutter
cp flutter/SKILL.md ~/.claude/skills/mobile-app-setup-flutter/SKILL.md
```

## Adding a new framework

Create a new top-level folder (e.g. `react-native/`, `android-native/`) with its own `SKILL.md` following the same shape: overview, package/bundle naming, env/config handling, per-platform build config, run/build commands, CI notes, and common pitfalls.
