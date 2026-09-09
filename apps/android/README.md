# Bunny Studios for Android (Amazon Fire HD 10)

A native Android app whose whole screen is a WebView showing the studio served by the NAS.
The web app is the product, so design and behaviour are identical to the browser and every
`npm run release` updates the tablet with no new APK. The wrapper adds what a browser tab
lacks on a Fire tablet:

- An icon, a splash, and landscape-only orientation (plan D14).
- Native dialogs for the web app's `confirm()` (the bin flows), which a bare WebView would
  silently answer "no" to.
- The back button navigates the web app's history and exits from the first page.
- An offline screen, in the teen's words, with **Try again** and **Change address**.
- The studio address is baked in at build time and changeable in the app (long-press the
  splash, or the offline screen's button), so a move to a production address needs no rebuild.
- Cleartext HTTP allowed for the LAN, and user-installed certificates trusted for a later
  self-signed HTTPS setup on the NAS.

Why not a Trusted Web Activity or a store listing: Fire OS has no Google Play services and no
Chrome, and a TWA needs both. A WebView is what Fire OS provides, and sideloading is the
normal way onto a Fire tablet.

## Building

Needs JDK 17 and the Android SDK (platform 34, build-tools 34). `deploy/release.mjs` builds
the APK automatically when `ANDROID_HOME` and `JAVA_HOME` are set (see `deploy/release.env.example`),
and copies it to `apps/web/public/downloads/bunny-studios.apk` so the running server offers
it at `/downloads/bunny-studios.apk`.

By hand:

```bash
cd apps/android
./gradlew assembleRelease -PserverUrl=http://192.168.1.73:3001
# -> app/build/outputs/apk/release/app-release.apk
```

Signing: set `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD` and optionally
`ANDROID_KEY_ALIAS` (default `bunny`) to sign with a real key. Without them the build is
signed with the debug key, which installs but cannot later be updated in place by a properly
signed build; make the keystore once and keep it out of the repo:

```bash
keytool -genkeypair -v -keystore deploy/android/bunny-release.jks -alias bunny \
  -keyalg RSA -keysize 2048 -validity 10000 -storepass '<password>' -dname 'CN=Bunny Studios'
```

The version code and name come from the root `package.json`, so the APK version always
matches the server release it was built with.

## Installing on the Fire HD 10

1. Settings > Security & Privacy > **Apps from Unknown Sources** > allow for Silk Browser.
2. In Silk, open `http://192.168.1.73:3001/downloads/bunny-studios.apk`, download, open, install.
3. The app appears on the home screen as **Bunny Studios**. First launch loads the studio.

Or with ADB (Settings > Device Options > Developer Options > ADB debugging):

```bash
adb install -r apps/android/app/build/outputs/apk/release/app-release.apk
```

Updating the app later: install the new APK the same way; sign-in and settings persist.

## Scaling

The Fire HD 10 is 1920×1200 at about 224 dpi, which Android reports as roughly 1280×800 dp in
landscape. The web app's layout is built for a 1024×768 tablet and up, with relative units
and flex/grid, so it fills the screen without adjustment. The WebView pins `textZoom` to 100
so the tablet's accessibility font size does not distort the cards, and pinch-zoom is off
because the board is drag-and-drop.
