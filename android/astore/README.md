# A-Store for Android

This project builds the Android A-Store client. It uses the Android system
WebView to load the same live catalog as A-OS, so newly published and updated
apps appear without releasing a new APK.

Build the debug APK:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
./gradlew.bat assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
