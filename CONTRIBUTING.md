# Contributing to lokey

Thanks for helping! lokey is a small project with a friendly bar: working code, a clear description and a screenshot or log when it matters.

## Ways to help

- **Report a bug**: open an issue with the *Bug report* template. Attach the last ~30 lines of `%LocalAppData%\Lokey\main.log` (and `host.log` for native problems) and say what you did, expected and saw.
- **Suggest or build a feature**: open a *Feature request* first for anything big so we can agree on the shape.
- **Small, high-value PRs**: new assistant tools, spirit skins and actions, translations, accessibility fixes, tests, docs.
- Look for the **good first issue** label, and for items in [docs/REVIEW-AND-ROADMAP.md](docs/REVIEW-AND-ROADMAP.md).

## Set up

You need Windows 10/11 (64-bit), Node.js 22+, pnpm 11 and the .NET 8 SDK.

```powershell
git clone https://github.com/<you>/lokey.git
cd lokey
pnpm run bootstrap     # app dependencies + native sidecar
pnpm dev               # run with hot reload
pnpm verify            # typecheck + build + sidecar build (what CI runs)
```

Layout, process model and the protocol are explained in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); day-to-day workflow and the QA modes in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Ground rules

1. **Keep it typed.** `pnpm typecheck` and `dotnet build` (zero warnings) must pass. New sidecar methods go in `app/src/shared/protocol.ts` first, then the C# `Dispatcher` registration, then the renderer.
2. **Tests that do not touch the user's machine.** Use the built-in modes (`--bench`, `--uitest`, `--lab`, `--demo`, `--selfcheck`, sidecar `--selftest`). Never write a test that sends real mouse or keyboard input, steals focus or changes system settings.
3. **Safety first for the assistant.** New tools must be reversible and visible, validate their arguments and never act on text that came from a web page or screenshot without confirmation. See the tool list in `app/src/main/agent/tools.ts`.
4. **Match the surrounding code**: naming, comment density and idiom. Comments explain *why*, not *what*.
5. **No personal data in the repo or in screenshots.** README art is generated from fake data (`bash scripts/readme-art.sh`).
6. **Do not add third-party assets** (logos, artwork, copy, fonts) without a compatible licence; add them to [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Pull requests

- Branch from `main`, keep PRs focused, and describe *what* and *why*. Screenshots or a short clip help for UI changes.
- Commit messages: a short imperative summary line, then a paragraph on the reason if it is not obvious.
- CI must be green. A maintainer will review; expect small requests, not rewrites.

## Licence

By contributing you agree that your contributions are licensed under the project's [GPL-3.0](LICENSE) licence.
