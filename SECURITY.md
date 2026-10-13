# Security policy

## Supported versions

lokey is pre-1.0: only the **latest release** receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on <https://github.com/eashuu/lokey/security/advisories/new>.

Include what you found, how to reproduce it, the version, and the impact you expect. You will get an acknowledgement within a few days and we will keep you updated until a fix is released. Credit is given unless you prefer otherwise.

## What is in scope

- The Electron app and its IPC surface (a web page or overlay reaching sidecar methods it should not).
- The native sidecar (named-pipe access, clipboard store, text insertion, hotkey hook, registry writes).
- The voice agent (tool abuse through model output, prompt injection from screen or web content, key handling).
- Anything that leaks the stored API key or the clipboard history.

## Known areas under review

An internal review (see [docs/REVIEW-AND-ROADMAP.md](docs/REVIEW-AND-ROADMAP.md)) lists hardening work that is already planned: stricter per-window IPC allow-lists, confirmation for model-chosen URLs, and tighter microphone ownership. Reports about these are still welcome, especially with a working proof of concept.

## Data handling in short

The Google AI Studio key is stored with Windows DPAPI (`safeStorage`) in `%LocalAppData%\Lokey\voice.key` and only used in the main process. Clipboard history is stored per user, encrypted with DPAPI (pinned items are plain by design). lokey sends nothing to its authors.
