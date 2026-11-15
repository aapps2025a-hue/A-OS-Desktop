# A-OS FileDrop

FileDrop sends files directly between A-OS, Windows, and macOS computers on the same local network. The receiver must approve each transfer. Completed files are checksum-verified before they appear in `Downloads/FileDrop`.

## Run from source

Python 3.10 or later is recommended. Tkinter is included with the standard Windows and macOS Python installers.

```shell
python -m filedrop.desktop_app
```

Both computers must have FileDrop enabled and be connected to the same trusted network. FileDrop uses UDP port `45871` for discovery and TCP port `45872` for transfers; the operating system may ask for firewall access the first time it runs.

## Build desktop apps

The repository workflow `.github/workflows/build-filedrop.yml` creates:

- `A-OS-FileDrop-Windows.zip`, containing the Windows `.exe`
- `A-OS-FileDrop-macOS.dmg`, ready to install on macOS
- `A-OS-FileDrop-macOS.zip`, containing the raw macOS `.app`

The packages and SHA-256 checksums are attached to the `A-OS FileDrop 1.0` GitHub release. They use the same FileDrop icon and are built by GitHub Actions because a genuine macOS `.app` and `.dmg` must be built on macOS. Release signing and notarization require Apple and Microsoft signing identities and are intentionally separate from the reproducible build.

## Security model

- FileDrop is local-network only.
- Discovery uses a short-lived random session token.
- Every incoming transfer requires approval.
- Every upload uses a separate random token.
- Filenames are sanitized and received data is written to a temporary file.
- SHA-256 verification must pass before the temporary file is renamed.

FileDrop 1.0 does not provide end-to-end encryption. Use it only on a network you trust.
