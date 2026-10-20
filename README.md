# A-OS Desktop

A-OS Desktop is the best OS for computers you have ever used. It is web-based,
like a web OS for computers, and built to be better.

A-OS Desktop is a html-based computer interface with local files, apps,
widgets, account profiles, device sharing, security tools, and a customizable
desktop. 

<img width="782" height="440" alt="image" src="https://github.com/user-attachments/assets/b94cf876-c5e7-46c0-9d2a-415f75e289e3" />

## New Stuff

We have added some new options and fixed patches in V3.1. As well as
making it a better experience and making a `.iso`
## Run locally

Serve the `public` folder with any static web server. For example:

```powershell
python -m http.server 5000 --directory public
```

Then open `http://127.0.0.1:5000/`.

Opening `public/index.html` directly with a `file:` URL is not supported because
browser security rules block parts of the module and storage system.

## A-Store

- `public/store.html` is the standalone A-Store for browsers and Windows app installation.
- `public/store-dev.html` opens A-Store Dev directly.
- `public/downloads/A-Store-Android.apk` is the local Android build artifact.
- The public APK is distributed from the `astore-android-v1.0.0` GitHub release because Firebase's Spark plan blocks executable uploads.
- `android/astore/app` contains the Android A-Store client.
- `android/astore/storeapp` is the native host used to build a separate APK for each catalog app.
- `.github/workflows/build-astore-apps.yml` scans the catalog every five minutes, builds signed APKs, and publishes them in the `astore-apps` GitHub release.

A-Store Dev can import a folder containing `index.html`, edit HTML, CSS,
JavaScript, JSON, and local backend routes, attach a logo and preview media,
scan the package, and publish or update it through the shared Firestore catalog.
Publishing requires an A-Applications account. New apps appear in the catalog
immediately but retain a reputation warning until they qualify for the active
top-1,000 list. The home promotion area contains only administrator-selected
one-week show-off apps or highly downloaded apps.

On Android, A-Store installs each catalog item as a separate application with a
stable package identity. Updating an app keeps that identity and its Android
data. The signing key is stored only in GitHub Actions secrets; it is not part
of this repository.

Build the Android package with Android Studio or:

```powershell
cd android/astore
./gradlew assembleDebug
```

To test one generated app locally:

```powershell
node scripts/build-astore-apks.mjs --debug --only a-ai --output dist/astore-apks
```

## Assets

Runtime assets live in these folders:

- `public/assets/icons`
- `public/assets/icons/aos-originals` (recovered editable vector designs)
- `public/assets/emojis/aos-3d` (the active A-OS Originals emoji pack)
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

## Bootable ISO

The open-source Debian Live configuration is in `iso`. GitHub Actions builds a
real ISO-hybrid image that starts the packaged A-OS interface directly and
serves this exact `public` folder locally, including the same A-OS boot GIF.
The generated ISO and SHA-256 checksum are published in the `iso-v3.0.0`
GitHub release. The release is blocked unless both the USB image and a generated
installed UEFI disk boot to the packaged A-OS HTML in QEMU.

## License

The A-OS software is MIT licensed. Third-party media keeps its original license;
where required, attribution is stored next to the asset. The local Samsung audio
file is intentionally excluded from the public repository.

