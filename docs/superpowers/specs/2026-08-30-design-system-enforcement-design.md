# Design system enforcement and screen decomposition

**Date:** 2026-08-30
**Block:** A (foundation) of the Elovia product transformation
**Status:** awaiting approval

---

## Problem

Elovia reads as vibe-coded. The cause is not a missing design system — `constants/design.ts`
is well-built (4pt spacing scale, a type scale that accounts for iOS auto-zooming inputs below
16px, motion tokens where exits run at ~65% of entrances, platform-correct elevation,
`MIN_TOUCH: 48` taking the larger of Apple's 44 and Material's 48).

The cause is that **screens cannot reach the system, so each one reinvents it.**

### Evidence

| Finding | Measurement |
|---|---|
| Hardcoded hex literals outside token files | **117** across `app/` and `components/` |
| Of those, literals that duplicate an existing token | `#00E676`×13, `#1A1A24`×13, `#00D4FF`×11, `#FFD600`×10, `#FF6B35`×8, `#0A0A0F`×7 |
| Untokenised violet with no defined role | `#A78BFA` × **13** |
| Largest single component | `WorkoutsScreen`, **864 lines** (`workouts.tsx` 21–885) |
| Second largest | `ProfileScreen`, **919 lines** (`profile.tsx` 73–991) |
| Reusable primitives trapped inside one screen | 14 in `profile.tsx`, 3 in `onboarding/index.tsx` |
| Primitives duplicated across screens | **0** — they are unavailable, not duplicated |
| Components typing props as `: any` | 75+ occurrences, 15 in `profile.tsx` alone |

The mechanism: `SectionCard`, `ModalSheet`, `OptionPicker`, `NavRow`, `InfoRow`, `TappableRow`
and `StatItem` exist only inside `profile.tsx`. Any other screen needing a card or a sheet
builds one from raw `View` plus inline styles, and picks its own colour while doing so. The
117 literals are a *symptom* of the missing shared vocabulary, not the disease.

### A real defect, not just untidiness

`hooks/useTheme.ts` resolves `ctx.state.colorScheme || systemScheme || "dark"`, so light mode
is reachable from both an in-app setting and the OS appearance setting. The **20** hardcoded
instances of `#1A1A24` (`Colors.dark.card`) and `#0A0A0F` (`Colors.dark.background`) do not
flip when the theme does, rendering dark panels on a light ground.

---

## Decisions

1. **Dark-only.** `Colors.light` and the in-app toggle are removed; the app forces dark
   regardless of OS setting. Elovia's identity is already dark, and the category norm
   (Strava, Whoop, Nike Run Club) is dark-first for training contexts. This deletes 20 latent
   bugs by deleting the surface, and halves design and QA cost on every screen touched later.

2. **`#A78BFA` is retokenised, not deleted.** Initial reading was that it was decorative. It
   is not: in `diet.tsx` it is the **"custom plan" accent, positioned deliberately opposite
   `Colors.accent`**, which marks the AI-generated path. The distinction it encodes —
   user-authored vs machine-authored content — is real and worth keeping, and no existing
   token covers it.

   So the role gains a token (`Semantic.manual`), and the *colour* changes. Violet over
   electric-blue-on-charcoal is the clearest AI-palette tell in the codebase; the replacement
   is chosen to sit in the existing palette while staying clearly distinguishable from
   `Colors.accent` at a glance, including for the ~8% of men with red-green colour deficiency
   (so the two must differ in more than hue).

3. **Evolution, not rewrite.** Working screens are refactored in place. No new styling system,
   no NativeWind, no component-library dependency.

---

## Architecture

### Token layer (unchanged in shape, corrected in scope)

- `constants/design.ts` — keeps `Space`, `Radius`, `Type`, `Motion`, `elevation()`,
  `MIN_TOUCH`, `Semantic`. No structural change; this file is already correct.
- `constants/colors.ts` — `Colors.light` deleted. `Colors.dark` becomes the single palette.
- `hooks/useTheme.ts` — signature preserved (`{ isDark, theme, colorScheme }`) so the 200+
  call sites need no edit, but `isDark` is now always `true` and `theme` always the dark
  palette. Keeping the hook shape is deliberate: it makes this a low-risk change and leaves
  the door open to reinstating light mode without a re-audit.

### Component layer (new)

Primitives are lifted out of `profile.tsx` and `onboarding/index.tsx` into `components/ui/`,
typed properly, and made available app-wide:

| Component | Lifted from | Purpose |
|---|---|---|
| `SectionCard` | profile | Titled content group |
| `ModalSheet` | profile | Bottom-sheet modal shell |
| `OptionPicker` | profile | Single-select from a list |
| `NavRow` | profile | Row that navigates |
| `TappableRow` | profile | Row with value + optional badge |
| `InfoRow` | profile | Read-only label/value pair |
| `StatItem` | profile | Compact metric display |
| `LabelInput` | onboarding | Labelled text field |
| `NumberStepper` | onboarding | Increment/decrement numeric field |
| `ChipRow` | onboarding | Horizontal selectable chips |

Each gets a real props interface. No `: any`.

### Screen layer

- `profile.tsx` — two distinct problems, often conflated:
  - Lines **992–1848** are already separate functions (14 sub-components including 6 modals).
    Moving them out shrinks the *file* but does not touch the screen.
  - Lines **73–991** are one 919-line `ProfileScreen` component. This is the actual problem,
    and reaching the success criteria requires splitting its body into section components
    (profile header, goals, macros, health sync, account), not just relocating the modals.
- `workouts.tsx` — the 864-line `WorkoutsScreen` is the single worst component in the app.
  **Step one is mapping its internal sections**; the split is decided from that map, by
  responsibility rather than line count. No split is attempted before the map exists.
- `onboarding/index.tsx` — **no structural change in this block.** It is already well
  decomposed into 7 step components. Its problem is that `TOTAL_STEPS = 7` gates time-to-first-
  value, which is a product decision and belongs to a later block, not a refactor.

---

## Migration strategy

Two passes that fail independently.

**Pass 1 — tokens (independently shippable)**
1. Delete `Colors.light`; simplify `useTheme`.
2. Replace the 117 literals with token references, file by file, in ascending file-size order
   so the mechanical cases build confidence before the hard ones.
3. Retire `#A78BFA`, mapping each of its 13 uses to a semantic role.
4. Typecheck after each file.

Pass 1 changes no layout and no behaviour. Every diff is a colour reference swap, verifiable
by reading.

**Pass 2 — decomposition**
5. Lift the 10 primitives into `components/ui/` with real prop types.
6. Repoint `profile.tsx` and `onboarding/index.tsx` at the extracted versions.
7. Split `profile.tsx` modals into sibling files.
8. Map and split `WorkoutsScreen`.

If Pass 2 goes wrong, Pass 1 has already shipped a working, theme-correct app.

---

## Verification

**Constraint, stated plainly:** the host is Windows. There is no iOS Simulator (macOS-only),
no Android SDK, no `adb`, no emulator, and Maestro is not installed. The `agent-device` QA loop
specified in the mission **cannot run from this machine.** This is a hard limitation, not a
preference, and no claim of on-device verification will be made without it.

What replaces it:

| Layer | Method |
|---|---|
| Type safety | `tsc --noEmit` across all three packages after every file |
| Colour migration | Grep assertion: zero hex literals outside `constants/` when Pass 1 completes |
| Behavioural equivalence | Pass 1 is colour-reference-only; a diff that changes layout is a bug |
| Visual truth | **User-driven** — specified screens, specified states, screenshots returned |
| Regression | EAS preview build installed on the user's own iOS and Android devices |

The user's two physical devices are the device harness. That is slower than an emulator but
produces real evidence rather than fabricated evidence.

---

## Risks

| Risk | Mitigation |
|---|---|
| Removing `Colors.light` breaks a call site reading it directly | **Confirmed real, not hypothetical.** `FoodSearch.tsx:31` and `NumberEditModal.tsx:42` both bypass `useTheme` and re-implement `isDark ? Colors.dark : Colors.light` inline. Both must be repointed at `useTheme` *before* the deletion. This is the same divergence pattern as the 117 literals, appearing in logic rather than colour. |
| A "token equivalent" is not actually equivalent | Only exact hex matches are auto-migrated; near-matches are listed for explicit decision |
| Splitting `WorkoutsScreen` changes behaviour | Map its internal sections before touching it; split by responsibility, one section per commit |
| Scope creep into visual redesign | Out of scope for this block. Tokens are enforced, not redefined. |

---

## Out of scope for Block A

Queued as their own spec → plan → implement cycles:

- **E — Security.** Lead already found: `expo-secure-store` is absent while AsyncStorage is
  present. Where auth tokens persist must be traced.
- **C — Market research.** Competitors, App Store and Play review mining, feature matrix.
- **H — Store readiness.** Icon, splash, permission strings, privacy disclosures, account
  deletion, restore purchases.
- **Backend audit** (mission phases 19–25) — API design, authorization enforcement, search,
  realtime/sync, background jobs, notifications, analytics, observability.
- **Onboarding length.** `TOTAL_STEPS = 7` before first value is a conversion problem worth
  its own investigation.
- **Performance.** Requires device access; blocked until a build can be profiled.

---

## Success criteria

Block A is done when:

1. `grep -rE "#[0-9A-Fa-f]{6}" app/ components/` returns **zero** results.
2. `Colors.light` no longer exists and the app renders dark regardless of OS setting.
3. `#A78BFA` appears nowhere in the codebase.
4. The 10 primitives live in `components/ui/` with typed props and no `: any`.
5. No component in `app/` exceeds ~300 lines.
6. All three packages typecheck clean.
7. An EAS preview build installs and the user confirms the previously-affected screens render
   correctly on a real device.
