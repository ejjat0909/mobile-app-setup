---
name: mobile-app-setup
description: Reference for setting up dev/prod(/hw) build flavors in a Flutter app — Gradle/Xcode config, dotenv wiring, run commands, CI, and common pitfalls. Illustrated with a fictional app, "Recipix". Not React Native/Expo.
metadata:
  origin: custom
  framework: flutter
---

# Mobile App Flavor Setup (Flutter) — worked example: "Recipix"

This is a generic reference for wiring up native build flavors in a Flutter app, illustrated throughout with a fictional example app called **Recipix**. Swap every `recipix`/`com.recipix.*` identifier below for your real project's own package name, bundle ids, keys, and domains — the point is the *pattern*, not these specific values.

## Trigger conditions

Load this skill when:
- Asked to add/inspect dev + prod (+ optionally a Huawei/HMS variant) build flavors in a **Flutter** app.
- The request assumes React Native/Expo but the repo turns out to be Flutter — this doc is the correct reference; RN/Expo-specific tooling (`react-native-config`, `app.config.js`, `EXPO_PUBLIC_*`) does not apply here.
- Setting up a new machine/IDE to run a Flutter app's flavors locally, or troubleshooting a flavor-specific build/signing/deep-link issue.

**Confirm the framework before applying anything below.** Flutter: `pubspec.yaml`, `lib/`, native `android/` + `ios/` folders, `.dart_tool/`, no `package.json`. Expo/RN: `package.json`, `app.json`/`app.config.js`, and `android/`/`ios/` only exist after `expo prebuild` (or never, if managed workflow). If it's the latter, this skill doesn't apply — find/write an RN-specific one instead.

---

## 1. Overview

A typical three-flavor Flutter setup, all **native flavors**, not JS/dart-only env switching:

| Flavor | Purpose | Android | iOS |
|---|---|---|---|
| `dev` | Staging | ✅ | ✅ |
| `prod` | Production | ✅ | ✅ |
| `hw` | Huawei (no GMS/Firebase, uses HMS) | ✅ | ❌ (Huawei devices don't run iOS — Android-only flavor) |

Strategy layers, all of which must move together for a given flavor:
1. **Dart entrypoint** — `lib/Main/main_{dev,prod,hw}.dart` loads that flavor's `.env` then calls a shared `mainSuper()`/`runApp()` bootstrap.
2. **Android** — Gradle `productFlavors` (real flavors, not just build types) with per-flavor `applicationId`, signing, manifest, and source set.
3. **iOS** — separate Xcode **targets** (`RunnerDev`, `RunnerProd` — Flutter's default project/target is always named `Runner`, regardless of app branding) + matching **schemes** + suffixed **build configurations**, each with its own bundle id, entitlements, and `Info.plist`.
4. **flutter_dotenv** (`^5.2.1`) loads `assets/dotenv/{flavor}/.env` as a Flutter asset at runtime (not compile-time `--dart-define`).

Always launch with **matching** `--flavor` + `-t` (target/entrypoint) — a mismatch (e.g. `--flavor prod -t lib/Main/main_dev.dart`) silently produces a prod-signed binary running dev's dotenv/API urls.

---

## 2. Package / bundle naming

Recipix example — note Android and iOS can legitimately use **different** naming schemes for the "same" flavor once a project has been through a few years of rebrands/agencies; don't assume they should be unified without checking what's live on the stores:

| Flavor | Android `applicationId` | iOS bundle id | iOS target |
|---|---|---|---|
| dev | `com.recipixstaging.recipix` | `com.recipixapp.staging` | `RunnerDev` |
| prod | `com.recipix.recipix` | `com.recipixapp.production` | `RunnerProd` |
| hw | `com.recipix.recipix` (same as prod) | — (no iOS target) | — |

Android's actual Kotlin package for `MainActivity` can also vary **independently** of `applicationId` (this is legal — `android:name` just needs to resolve to a real compiled class, it doesn't have to equal `applicationId`):

```
android/app/src/dev/kotlin/com/recipixstaging/recipix/MainActivity.kt
android/app/src/prod/kotlin/com/recipix/recipix/MainActivity.kt
android/app/src/hw/kotlin/com/recipixhw/recipix/MainActivity.kt   ← note: NOT com.recipix.recipix
```

App display name / icon:
- **Android**: `resValue("string", "app_name", ...)` in `build.gradle.kts` + `android:label="..." tools:replace="android:label"` in each flavor's `AndroidManifest.xml`. dev = "Recipix (Staging)", prod/hw = "Recipix".
- **iOS**: `INFOPLIST_KEY_CFBundleDisplayName` per build configuration in `project.pbxproj`. dev = "Recipix (Staging)", prod = "Recipix". If the project started life as the default Flutter scaffold before flavors were added, a leftover unflavored `Runner` target/scheme/`Info.plist` often survives too (e.g. displaying "Recipix (OG)") — treat it as legacy scaffold, not a real flavor (see Pitfalls).
- **App icon**: often identical across all flavors on both platforms unless someone explicitly added per-flavor `mipmap`/`AppIcon` asset catalogs — check before assuming icons differ. Seasonal/dynamic icon toggles (if present) are usually implemented via Android `activity-alias` entries per flavor, disabled by default and enabled at runtime.

---

## 3. Environment variables & dotenv

Package: **`flutter_dotenv`** (not `react-native-config`/`react-native-dotenv` — this is Flutter).

File layout:
```
assets/dotenv/dev/.env
assets/dotenv/prod/.env
assets/dotenv/hw/.env
```
declared as Flutter assets in `pubspec.yaml`:
```yaml
flutter:
  assets:
    - assets/dotenv/dev/
    - assets/dotenv/prod/
    - assets/dotenv/hw/
```

Loading — **runtime**, not build-time. Each entrypoint does:
```dart
// lib/Main/main_dev.dart
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:recipix/Main/main_super.dart';

Future<void> main() async {
  await dotenv.load(fileName: "assets/dotenv/dev/.env");
  mainSuper(env: "DEV");
}
```
(`main_prod.dart` / `main_hw.dart` are identical except the path and the `env:` string.) Because loading is a runtime asset read, the `.env` file is **bundled into the compiled app** — do not put anything in it you wouldn't ship in the APK/IPA. Access values in code via `dotenv.env['keyName']`, ideally through a single config wrapper class rather than calling `dotenv.env` directly all over the codebase.

A common pattern: each flavor's `.env` is a **single file with both staging and production values present, with the unused ones commented out**, rather than a clean single-source-of-truth per key. If that's how a repo does it, switching environments within a flavor means editing that flavor's `.env` and re-commenting the right block — worth calling out explicitly the first time you touch one, since it's easy to assume env switching is automatic.

**To add a new variable safely:**
1. Add the key to **all** `assets/dotenv/{dev,prod,hw}/.env` files (missing it in one flavor means `dotenv.env['key']` returns `null` there — dotenv does not error on a missing key).
2. Read it through `dotenv.env['yourKey']`, with an explicit fallback if the value might be absent, e.g. `dotenv.env['yourKey'] ?? ''`.
3. If it's a key native code also needs (maps key, deep-link key, social-login app id), it is **not** read from `.env` on the native side — those come from Gradle properties / manifest placeholders (Android) or `.xcconfig`/`Info.plist` (iOS). See §4/§5. Don't assume adding it to `.env` alone wires it into native manifests.
4. Never commit a real secret expecting `.gitignore` to protect it without verifying — check whether `.env`/`key.properties` are actually gitignored in that repo (see Pitfalls, §8, for a real example where they weren't).

---

## 4. Android configuration

File: `android/app/build.gradle.kts` (Kotlin DSL — some older Flutter projects still use Groovy `build.gradle`, adjust syntax accordingly).

### 4.1 `signingConfigs`
One config per flavor, loaded from `android/key.properties` (verify this file is actually gitignored in your repo before assuming it's safe to fill with real secrets):
```kotlin
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

signingConfigs {
    create("devRelease") {
        storeFile = file(keystoreProperties["storeFile"] as String)
        storePassword = keystoreProperties["storePassword"] as String
        keyAlias = keystoreProperties["keyAlias"] as String
        keyPassword = keystoreProperties["keyPassword"] as String
    }
    create("prodRelease") { /* same keys as devRelease, own keystore/alias */ }
    create("hwRelease") {
        storeFile = file(keystoreProperties["hwstoreFile"] as String)
        storePassword = keystoreProperties["hwstorePassword"] as String
        keyAlias = keystoreProperties["hwkeyAlias"] as String
        keyPassword = keystoreProperties["hwkeyPassword"] as String
    }
}
```
`android/key.properties` needs one set of `{storeFile,storePassword,keyAlias,keyPassword}` per keystore in use (8 keys total across two keystores, in this example).

### 4.2 `productFlavors`
```kotlin
flavorDimensions += "env"
productFlavors {
    create("dev") {
        applicationId = "com.recipixstaging.recipix"
        dimension = "env"
        resValue("string", "app_name", "Recipix (Staging)")
        manifestPlaceholders += mapOf("partner" to "recipixstaging")
        manifestPlaceholders.put("GOOGLE_MAPS_API_KEY", providers.gradleProperty("GOOGLE_MAPS_API_KEY").orNull ?: "")
        manifestPlaceholders.put("DEEPLINK_KEY_STAGING", providers.gradleProperty("DEEPLINK_KEY_STAGING").orNull ?: "")
        signingConfig = signingConfigs.getByName("devRelease")
        proguardFiles(getDefaultProguardFile("proguard-android.txt"), file("proguard-rules.pro"))
    }
    create("prod") {
        applicationId = "com.recipix.recipix"
        dimension = "env"
        resValue("string", "app_name", "Recipix")
        manifestPlaceholders += mapOf("partner" to "recipix")
        manifestPlaceholders.put("GOOGLE_MAPS_API_KEY", providers.gradleProperty("GOOGLE_MAPS_API_KEY").orNull ?: "")
        manifestPlaceholders.put("FACEBOOK_APP_ID", providers.gradleProperty("FACEBOOK_APP_ID").orNull ?: "")
        manifestPlaceholders.put("FB_LOGIN_PROTOCOL_SCHEME", providers.gradleProperty("FB_LOGIN_PROTOCOL_SCHEME").orNull ?: "")
        manifestPlaceholders.put("DEEPLINK_KEY_LIVE", providers.gradleProperty("DEEPLINK_KEY_LIVE").orNull ?: "")
        signingConfig = signingConfigs.getByName("prodRelease")
        proguardFiles(getDefaultProguardFile("proguard-android.txt"), file("proguard-rules.pro"))
    }
    create("hw") { /* same shape as prod, signingConfig = hwRelease */ }
}
```
Note: `applicationId` here is a **full override**, not `applicationIdSuffix` — each flavor sets the complete id (a valid alternative is `applicationIdSuffix = ".dev"` off a shared base id, if you don't need fully independent ids per flavor). There's typically no `versionNameSuffix` when version is a single `pubspec.yaml` value shared across flavors.

`GOOGLE_MAPS_API_KEY`, `FACEBOOK_APP_ID`, `FB_LOGIN_PROTOCOL_SCHEME`, `DEEPLINK_KEY_STAGING`, `DEEPLINK_KEY_LIVE` come from **`android/gradle.properties`** (Gradle-level, not Dart's `.env`) and flow into the manifest via `manifestPlaceholders` → `${PLACEHOLDER}` tokens in `AndroidManifest.xml`.

### 4.3 `sourceSets`
```kotlin
sourceSets {
    getByName("dev")  { manifest.srcFile("src/dev/AndroidManifest.xml");  java.srcDirs("src/dev/kotlin") }
    getByName("prod") { manifest.srcFile("src/prod/AndroidManifest.xml"); java.srcDirs("src/prod/kotlin") }
    getByName("hw")   { manifest.srcFile("src/hw/AndroidManifest.xml");   java.srcDirs("src/hw/kotlin") }
}
```

### 4.4 Per-flavor `AndroidManifest.xml` differences (`android/app/src/{dev,prod,hw}/AndroidManifest.xml`)
- `android:label` (app name) + `tools:replace="android:label"`.
- Fully-qualified `MainActivity` name matching that flavor's Kotlin package (§2).
- Deep-link `intent-filter`s per flavor — **different hosts/schemes per environment**, e.g. dev: `recipixstaging` scheme, `recipix.test-app.link`, staging reward-centre hosts; prod: production equivalents (`recipixapp` scheme, `recipix.app.link`, `recipix.example.com`). When adding a new deep-link domain, add it to **every** flavor's manifest with the correct per-env host, not just one.
- `activity-alias` blocks for seasonal/dynamic icons, if present (usually all `enabled="false"` by default, toggled at runtime).
- Any third-party SDK key meta-data (deep-link SDK, analytics) via the flavor's manifest placeholder.

### 4.5 Firebase / Huawei config files
```
android/app/src/dev/google-services.json
android/app/src/prod/google-services.json
android/app/src/hw/google-services.json       ← if present, confirm it's actually needed — hw is meant to run on HMS not GMS
android/app/src/hw/agconnect-services.json    ← Huawei AGConnect config
```
Placed directly under each flavor's source-set folder — the `com.google.gms.google-services` and `com.huawei.agconnect` Gradle plugins auto-discover the file matching the flavor being built. When adding a **new** flavor, download that flavor's own `google-services.json` from the Firebase console (matching its `applicationId`) and drop it in `android/app/src/<newflavor>/google-services.json`, or the build will pick up the wrong Firebase project (or fail if none exists).

### 4.6 Flavor-scoped dependencies
```kotlin
listOf("dev", "prod").forEach { flavor ->
    add("${flavor}Implementation", platform("com.google.firebase:firebase-bom:34.15.0"))
    add("${flavor}Implementation", "com.google.firebase:firebase-analytics")
    // ... play-services-*
}
add("hwImplementation", "com.huawei.hms:ads-identifier:3.4.39.302")
add("hwImplementation", "com.huawei.agconnect:agconnect-core:1.9.3.300")
// ... other HMS/AGConnect artifacts
```
This is how "hw has no Firebase/GMS, uses HMS instead" is actually enforced — `hw` simply never gets the `firebase-*`/`play-services-*` dependencies added to its variant.

---

## 5. iOS configuration

Flutter always scaffolds the iOS project as `ios/Runner.xcodeproj` with a target named `Runner` — that name is generic to every Flutter app, not brand-specific. A flavored project typically adds one native **target** per flavor (`RunnerDev`, `RunnerProd`), each with its own build-configuration list, scheme, `Info.plist`, entitlements file, and Podfile target block. The original unflavored `Runner` target/scheme often survives as legacy scaffold — don't build/run it expecting a real flavor.

### 5.1 Schemes / build configurations
| Flavor | Scheme | Target | Configs expected on that target |
|---|---|---|---|
| dev | `dev.xcscheme` (or `RunnerDev.xcscheme`) | `RunnerDev` | `Debug-dev`, `Release-dev`, `Profile-dev` |
| prod | `prod.xcscheme` (or `RunnerProd.xcscheme`) | `RunnerProd` | `Debug-prod`, `Release-prod`, `Profile-prod` |

`flutter run/build ios --flavor dev` invokes Xcode with scheme `dev` and expects `Debug-dev`/`Release-dev`/`Profile-dev` configurations to exist **on the `RunnerDev` target specifically**. This is the single most common flavor-setup mistake on iOS — see Pitfalls §8.1 for a concrete way this breaks (a scheme referencing configuration names that were never actually added to the target).

### 5.2 Bundle id / entitlements per flavor
```
ios/RunnerDev.entitlements   → application-groups: group.com.recipixapp.staging
                               associated-domains: applinks:recipixstaging, recipix.test-app.link, recipix-alternate.test-app.link,
                                                    demo.recipix.example.com, recipix-1-staging.example.net
ios/RunnerProd.entitlements → application-groups: group.com.recipixapp.production
                               associated-domains: applinks:recipixapp, recipix.app.link, recipix-alternate.app.link,
                                                    fb<FACEBOOK_APP_ID>, recipix.example.com, www.recipix.example.com
```
Each target needs its own `Info.plist` (a duplicated/renamed copy is common, e.g. `Runner copy-Info.plist` for `RunnerProd`, `Runner copy2-Info.plist` for `RunnerDev` — legacy naming from when the targets were duplicated off `Runner`). Don't "clean up" such filenames without updating the `INFOPLIST_FILE` build setting that points at them.

### 5.3 Firebase config (`GoogleService-Info.plist`)
```
ios/Config/dev/GoogleService-Info.plist   → BUNDLE_ID com.recipixapp.staging
ios/Config/prod/GoogleService-Info.plist  → BUNDLE_ID com.recipixapp.production
```
A build-phase "Run Script" on each target copies the matching `ios/Config/<flavor>/GoogleService-Info.plist` into the app bundle. Download a fresh plist from the Firebase console with a **matching `BUNDLE_ID`**, or Firebase init silently fails at runtime.

### 5.4 Podfile (`ios/Podfile`)
```ruby
platform :ios, '15.0'

project 'Runner', {
  'Debug' => :debug, 'Profile' => :release, 'Release' => :release,
  'Debug-dev' => :debug, 'Release-dev' => :release, 'Profile-dev' => :release,
  'Debug-prod' => :debug, 'Release-prod' => :release, 'Profile-prod' => :release,
}

target 'Runner' do ... end        # legacy scaffold target, if still present
target 'RunnerProd' do
  use_frameworks!
  use_modular_headers!
  inherit! :search_paths
  flutter_install_all_ios_pods File.dirname(File.realpath(__FILE__))
  # flavor-specific pods here
end
target 'RunnerDev' do ... end     # same shape as RunnerProd
```
If push notifications need rich content (image/actions), each flavor typically needs its own pair of Notification Service/Content Extension targets + matching Podfile blocks — a new flavor that needs rich push means duplicating those too, not just `RunnerDev`/`RunnerProd`.

`post_install` is the usual place to force a minimum `IPHONEOS_DEPLOYMENT_TARGET` across all pod targets and to set `GCC_PREPROCESSOR_DEFINITIONS` permission flags for `permission_handler` (camera, mic, location, contacts, calendar, photos, notifications, app-tracking-transparency) — these are global across flavors, not per-flavor; enabling a new permission means uncommenting its `PERMISSION_*=1` line here.

### 5.5 Signing / provisioning
Often done manually in Xcode per target (`RunnerDev`/`RunnerProd` → Signing & Capabilities) rather than automated. If there's no Fastlane/match setup, iOS release builds are likely a manual, non-CI process — check before assuming a `flutter build ipa` will "just work" in CI.

---

## 6. Run / build commands

```bash
# Debug run
flutter run --flavor dev  -t lib/Main/main_dev.dart
flutter run --flavor prod -t lib/Main/main_prod.dart
flutter run --flavor hw   -t lib/Main/main_hw.dart

# Release APK (Android)
flutter build apk --flavor dev  -t lib/Main/main_dev.dart  --release
flutter build apk --flavor prod -t lib/Main/main_prod.dart --release
flutter build apk --flavor hw   -t lib/Main/main_hw.dart   --release

# iOS (dev/prod only — no hw target, Huawei devices don't run iOS)
flutter build ios --flavor dev  -t lib/Main/main_dev.dart
flutter build ios --flavor prod -t lib/Main/main_prod.dart
```
There's no `yarn`/`package.json` here — this is Flutter, so there are no `yarn android:dev`-style npm scripts. The closest equivalents are usually:
- A release-build shell script (e.g. `scripts/build-dev-release.sh`) that runs `flutter build apk --flavor dev ... --release --obfuscate --split-debug-info=...` then renames the output APK to embed the version, e.g. `recipix_v_<version>(<lastBuildDigit>).apk`.
- A VS Code `preLaunchTask` script that only runs `gradlew clean` + `assemble<Flavor><Debug|Release>` when the flavor or run-mode actually **changed** since the last run (tracked in a small state file), to avoid redundant clean builds on every launch.

Gradle task names directly, if not going through `flutter`:
```bash
cd android
./gradlew assembleDevDebug / assembleDevRelease
./gradlew assembleProdDebug / assembleProdRelease
./gradlew assembleHwDebug / assembleHwRelease
```

---

## 7. CI/CD notes

A minimal Android-only release workflow looks like:
```yaml
name: Build Prod Flavor
on:
  push:
    branches: ['release/**']   # adjust to your branch convention
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.32.5' }
      - run: flutter pub get
      - name: Decode and save keystore
        run: echo "$KEYSTORE_BASE64" | base64 -d > android/app/upload-keystore.jks
        env: { KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }} }
      - name: Create key.properties
        run: |
          echo "storePassword=${{ secrets.KEYSTORE_PASSWORD }}" >> android/key.properties
          echo "keyPassword=${{ secrets.KEY_PASSWORD }}" >> android/key.properties
          echo "keyAlias=${{ secrets.KEY_ALIAS }}" >> android/key.properties
          echo "storeFile=upload-keystore.jks" >> android/key.properties
      - run: flutter build apk --flavor prod -t lib/Main/main_prod.dart
```
Things worth checking on any real repo before assuming CI parity across flavors:
- Is every flavor actually built in CI, or only one (commonly just `prod`, with `dev`/`hw` built locally/ad hoc)?
- Is there any iOS CI step at all (`flutter build ipa`, Fastlane, match, App Store Connect API key)? A `macos-latest` runner alone doesn't imply one exists.
- Are separate keystores/aliases actually used per flavor, or is one keystore's secrets reused for multiple `key.properties` entries (e.g. hw reusing the same values as the main keystore)?
- If adding a new flavor to CI: copy the job, swap `--flavor` + `-t`, and confirm the new flavor's `google-services.json`/keystore alias exist as secrets.

---

## 8. Common pitfalls

1. **iOS flavor scheme referencing build configurations that don't exist on the target.** A scheme (e.g. `prod.xcscheme`) can reference `Debug-prod`/`Release-prod`/`Profile-prod` for every action (Run/Test/Profile/Archive) while the actual target's configuration list in `project.pbxproj` never had those configurations added — only the unsuffixed `Debug`/`Release`/`Profile` (and maybe another flavor's suffixed set) exist. This is a real, easy-to-introduce mistake when a flavor's target was cloned from another and the scheme wasn't fully re-pointed. Symptom: `flutter build ios --flavor <x>` or Xcode Run/Archive fails with a missing-configuration error. Always check, for any flavor you touch: does `project.pbxproj`'s configuration list for that flavor's target actually contain the exact configuration names the scheme references? Fix in Xcode's GUI (Product → Scheme → Manage Schemes, or the target's build settings) rather than hand-editing the pbxproj, to avoid corrupting the file.
2. **Android/iOS bundle identifiers don't have to match per flavor**, and often don't in projects that have been rebranded or migrated agencies. Don't "fix" a mismatch without checking what's live on the App Store/Play Store — changing a bundle id post-launch orphans the existing listing.
3. **Verify `.env` and `key.properties` are actually gitignored** before treating them as safe for real secrets — it's common for these to be committed by accident (no `.gitignore` entry) even when the intent was to keep them local-only, in which case CI regenerating `key.properties` fresh from secrets at build time is the only thing actually protecting the signing credentials.
4. **A flavor meant to exclude a dependency (e.g. `hw` excluding Firebase) can still ship that dependency's config file** (e.g. a leftover `google-services.json` in the `hw` source set) even though the Gradle dependency itself was correctly scoped away. The file being present doesn't reactivate the SDK by itself if no `firebase-*` implementation was added for that flavor, but it's worth confirming nothing else accidentally reads it.
5. **Legacy unflavored `Runner` target/scheme.** If the project started as the default Flutter scaffold before flavors were added, the original `Runner` target/scheme/`Info.plist` often still exists alongside the real flavor targets. Don't build/run it expecting a real environment.
6. **Duplicate iOS schemes pointing at the same target** (e.g. `dev.xcscheme` and `RunnerDev.xcscheme` both targeting `RunnerDev`) are common after a rename. Either works, but editing one does not update the other — they're separate files that can silently drift.
7. **`--flavor`/`-t` must match.** Flutter does not validate that the entrypoint's `dotenv.load()` path matches the `--flavor` you passed for signing/applicationId — mixing them (e.g. `--flavor prod -t lib/Main/main_dev.dart`) builds a prod-signed binary that reads dev's `.env`/API URLs, a footgun that fails silently until someone notices the app is hitting the wrong backend.
8. **Stale Gradle/Pod cache across flavor switches.** If a `preLaunchTask` script only runs `gradlew clean` when the flavor/mode actually changed (to save time), bypassing it and invoking `flutter run --flavor X` directly right after building flavor Y can leave a stale applicationId/app name/icon — do a manual `flutter clean` if you see stale branding after switching flavors.
9. **New flavor checklist:** (a) `lib/Main/main_<flavor>.dart` + its `assets/dotenv/<flavor>/.env`, registered in `pubspec.yaml` assets; (b) Gradle `productFlavors.create("<flavor>")` + `signingConfigs.create("<flavor>Release")` + `sourceSets.getByName("<flavor>")` + `android/app/src/<flavor>/{AndroidManifest.xml,kotlin/...,google-services.json}`; (c) new Xcode target + scheme + suffixed build configs + `Info.plist` + entitlements + `ios/Config/<flavor>/GoogleService-Info.plist` + Podfile target block (iOS only if the flavor needs an iOS build at all); (d) IDE run-configuration entries; (e) a CI job if it needs automated builds.

---

## 9. Key files reference

```
lib/Main/main_dev.dart, main_prod.dart, main_hw.dart, main_super.dart
assets/dotenv/{dev,prod,hw}/.env
android/app/build.gradle.kts
android/app/src/{dev,prod,hw}/AndroidManifest.xml
android/app/src/{dev,prod,hw}/kotlin/.../MainActivity.kt
android/app/src/{dev,prod,hw}/google-services.json (+ hw/agconnect-services.json)
android/key.properties, android/gradle.properties
ios/Podfile
ios/Runner.xcodeproj/project.pbxproj
ios/Runner.xcodeproj/xcshareddata/xcschemes/{dev,prod,RunnerDev,RunnerProd,Runner}.xcscheme
ios/Runner{Dev,Prod}.entitlements
ios/Config/{dev,prod}/GoogleService-Info.plist
scripts/ (prelaunch / release-build helper shell scripts)
.vscode/launch.json, .vscode/tasks.json  (if using VS Code run configs)
.github/workflows/ (flavor build CI, if present)
```
