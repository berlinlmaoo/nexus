# NEXUS for Android

Jetpack Compose app in `app/`. Status and decisions: `docs/STATUS.md`.

## Build

Use Android Studio's JDK and the Android SDK from the environment (do not write `local.properties`):

```sh
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME=~/Library/Android/sdk \
./gradlew :app:compileDebugKotlin
```

## DEV server host (Settings › Server)

The DEV server's host is not in the repository. The build reads it from the Gradle property
`nexusDevHost` and puts it into `BuildConfig.DEV_HOST`; `NexusConfig.DEV_HOST` / `DEV_BASE` use it.

Set it once per machine, outside the repo, in `~/.gradle/gradle.properties`:

```properties
nexusDevHost=<the DEV server's host name>
```

or pass it for one build with `-PnexusDevHost=<host>`. Every checkout and worktree on that machine picks it
up. Without it the DEV choice points at the placeholder `nexus-dev.invalid`, which never resolves; Production
is unaffected. Never put the real host in `local.properties`, `gradle.properties` in this folder, or any other
committed file.

## Signing and Firebase

Both are read from files outside the repo (`~/.nexus-android-secrets/`), see `app/build.gradle.kts`.
