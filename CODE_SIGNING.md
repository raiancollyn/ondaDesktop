# Code signing policy

This project distributes Windows release artifacts built from this repository.
We are applying to the SignPath Foundation program.

Planned statement after approval:

> Free code signing provided by [SignPath.io](https://about.signpath.io),
> certificate by [SignPath Foundation](https://signpath.org).

Status: application pending. Until approval, release artifacts are unsigned.

## What will be signed

Only artifacts built by the GitHub Actions workflow in this repository will be
submitted for signing:

- `Onda-Setup-*.exe` — NSIS installer published on GitHub Releases;
- `Onda.exe` — Electron application executable;
- `OndaCapture.exe` — native Windows audio helper shipped inside the app.

The private key is held by SignPath in an HSM. This repository does not store a
code-signing private key or certificate.

## Build and signing process

- Builds run on GitHub Actions (`windows-latest`) from a `v*` tag.
- `native:publish` builds the self-contained `OndaCapture` helper from
  `native/OndaCapture`.
- `electron-builder` builds the NSIS installer and the application package.
- After approval, the installer and executables will be submitted to SignPath
  for signing. Every signing request requires manual approval.
- Only artifacts produced by the public workflow are eligible for signing.

## Team roles

This is currently a single-maintainer project.

- **Authors** (commit access):
  - [@raiancollyn](https://github.com/raiancollyn)
- **Reviewers**:
  - [@raiancollyn](https://github.com/raiancollyn)
  - External pull requests require review by the maintainer before merge.
- **Approvers** (approve each signing request):
  - [@raiancollyn](https://github.com/raiancollyn)

All team members use multi-factor authentication for GitHub and SignPath.

## Distribution

Official downloads:

- <https://github.com/raiancollyn/ondaDesktop/releases>
- <https://onda.dpbr.net>

## Privacy policy

The desktop application connects to the Onda service at
`https://onda.dpbr.net` and to the media server configured by that service in
order to provide the audio room the user chooses to join. It does not include
telemetry or analytics.

Screen, window and audio capture only start when the user explicitly starts a
share and selects a source. Captured media is sent only to the room the user
joined. Chat messages and room metadata are stored by the Onda service according
to the room's normal behavior. Local settings and window state are stored on the
user's computer.

The application uses third-party open-source components, including Electron,
NAudio and the LiveKit client. The LiveKit client is distributed under Apache
2.0; its license is included in the web project at
`wwwroot/js/vendor/livekit-client.LICENSE`.

The application does not transfer information to other networked systems unless
specifically requested by the user or by the person installing or operating it,
apart from the connections needed to load and operate the Onda room selected by
the user.

## Uninstallation

The NSIS installer registers a standard Windows uninstaller. Users can remove
the application from **Settings → Apps → Installed apps → Onda** or from the
Start Menu uninstall shortcut. Local application data under
`%LOCALAPPDATA%\OndaDesktop` is intentionally not deleted automatically.

## Source and license

- Source: <https://github.com/raiancollyn/ondaDesktop>
- License: MIT (see [`LICENSE`](LICENSE))
- Web client: <https://github.com/raiancollyn/projetoOnda> (MIT)
