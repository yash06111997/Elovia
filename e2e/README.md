# Mobile end-to-end checks

## Prerequisites

- **Maestro CLI** — install with `curl -Ls "https://get.maestro.mobile.dev" | bash`, then add
  `~/.maestro/bin` to your `PATH`. Verify with `maestro --version`.
- **Java 11+** — Maestro is a JVM tool. Set `JAVA_HOME` (on this machine:
  `C:\Program Files\Java\jdk-18.0.2`) and put `%JAVA_HOME%\bin` on `PATH` before
  running Maestro.
- **agent-device** (`callstack/agent-device`, already installed globally) is the
  complementary agent-facing driver for simulators/emulators; Maestro runs the
  declarative flows below.

These Maestro flows exercise the installed Android or iOS app. They preserve the full seven-step onboarding, verify that generated value appears before the paywall, and confirm that a planned workout cannot finish without the adaptive check-in.

Run them in order against a local development build:

```sh
maestro test e2e/maestro/onboarding-preview.yaml
maestro test e2e/maestro/workout-feedback.yaml
```

The second flow intentionally reuses the plan and app state created by the first. Use a development build rather than Expo Go because Elovia's HealthKit, Health Connect and RevenueCat integrations require native modules.
