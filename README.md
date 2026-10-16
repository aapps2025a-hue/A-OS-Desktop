# A-OS Desktop

A-OS Desktop is a browser-based computer interface with local files, apps,
widgets, account profiles, device sharing, security tools, and a customizable
desktop. This repository contains the same static build used by the Firebase
Hosting release.

## Run locally

Serve the `public` folder with any static web server. For example:

```powershell
python -m http.server 5000 --directory public
```

Then open `http://127.0.0.1:5000/`.

Opening `public/index.html` directly with a `file:` URL is not supported because
browser security rules block parts of the module and storage system.

## Assets

Runtime assets live in these folders:

- `public/assets/icons`
- `public/assets/backgrounds`
- `public/assets/media`
- `public/assets/cursors`
- `public/assets/os`

The boot animation is `public/assets/os/A-OS Boot.gif`. You can replace it with
another GIF using the same filename. The asset generator only creates files
that are missing, so it will never overwrite a replacement:

```powershell
python scripts/generate-a-os-assets.py
```

## Publish

Firebase Hosting:

```powershell
firebase deploy --only hosting --project a-os-desktop
```

GitHub Pages publishes automatically whenever the `main` branch is pushed.
The Pages workflow prepares a copy of `public` with project-relative asset URLs;
it does not modify the Firebase build.

## License

The A-OS software is MIT licensed. Third-party media keeps its original license;
where required, attribution is stored next to the asset. The local Samsung audio
file is intentionally excluded from the public repository.

