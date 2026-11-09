# 03 · Style guide: how every Elo video looks, sounds and moves

Goal: someone scrolling past should know it's an Elo video **within one second, with the sound
off**, and every video should feel like part of the same show.

---

## v2 additions: the "30 days" format (these win where they conflict with older sections)

The Remotion template in `marketing/video-studio/` implements all of this; see
`characters/demo-elo-wall-sit.mp4`.

| Element | Spec |
|---|---|
| **Captions** | **One word at a time**, Inter Black (900), about 130px, centred at y≈300. White, with key words in **cyan `#00D4FF`**. Lowercase. Pops in on each word. |
| **Day counter** | Top-left pill `DAY 07`, with cyan text on charcoal. Counts up within each beat. |
| **Level badge** | Top-right pill `LV 1` / `LV 2`, charcoal text on cyan. Changes from Level 1 to 2 only at Week 4. |
| **30-day progress bar** | A thin bar at y≈1450 (above the bottom UI safe zone) with a glowing cyan fill and `day / 30`. **This replaces Swolo's big faint "Week One" lettering.** |
| **Series sticker** | Top-left pill above the day counter, `#FF6B35`, for example `30 DAYS · LEGS`. |
| **Annotation colours** | Pain or strain glow `#FF3D71` · movement arrows `#00D4FF` · posture and measurement lines `#FFD600` · "win" ticks `#00E676` · **anatomy muscles: warm orange-red, semi-transparent "x-ray" overlay** (see `characters/style-frame-wall-sit.jpg`) |
| **Comparison** | `DAY 1` (grey) vs `DAY 30` (cyan), with the Level 1 and Level 2 characters side by side. Always marked "illustrative". |
| **Disclosure** | `AI character · illustrative`, always on, bottom-left. |
| **Source line** | Small grey text under the progress bar on any beat that makes a science claim. |
| **End card** | A charcoal card with a glowing cyan bolt, "Day 1 starts today.", the challenge CTA, and "Track every rep · streaks · PRs". |
| **Voice** | The "Elovia Coach" narrator speaks in second person. Elo and Ela have no mouth, so there's no lip sync. |

---

## 1. Technical specs

| | Spec |
|---|---|
| Aspect / resolution | 9:16, 1080×1920, 30 fps |
| Length | **15–30s.** The hard cap is 35s; only the founder and recap videos run that long. India-focused guidance favours under 30s. |
| Safe zone | Keep text out of the **top ~220px** and the **bottom ~420px** (platform buttons and captions sit there), and out of the right ~140px (the like/share column). |
| Export | High-bitrate H.264, no watermark, uploaded natively to each platform. Don't repost a TikTok file to Instagram with the watermark on it. |
| First frame | Must work as a still: Elo plus the hook text, with no black or blank frame. |

---

## 2. The look

### Elo's world

- **Stylised 3D characters in semi-real environments**: Indian office pantries, wedding buffets,
  home kitchens at night, gyms, street-food stalls (US: diners, office desks, Thanksgiving tables).
- **Lighting:** warm practical lights (tube lights, fairy lights, the fridge light) plus **Elo's blue
  glow** as the second light source. Night scenes are dark, and Elo lights them.
- **Scale comedy:** shoot low and close, so Elo (15 cm) looks tiny next to giant food.
- **Grade:** slightly crushed blacks to match the charcoal UI, warm highlights, no heavy filters.

### Brand palette (matches the app, `artifacts/mobile/constants/colors.ts`)

| Role | Hex | Use in video |
|---|---|---|
| Primary (Elo, highlights) | `#00D4FF` | Elo's body, the numbers on scan cards, highlighted caption words |
| Background | `#0A0A0F` | End cards, text pills |
| Card | `#1A1A24` | Scan-card fill |
| Border | `#2A2A3A` | Scan-card border |
| Good / "win" | `#00E676` | The swap that wins, "✓" |
| Warning / "faint" | `#FF3D71` | Big numbers that make Elo faint |
| Accent | `#FF6B35` | Series title stickers |
| Text | `#FFFFFF` | All text |

**Font:** Inter, the same as the app. Bold (700) for numbers and hooks, SemiBold (600) for labels.

---

## 3. Recurring graphic elements

Build each one once as a CapCut template and reuse it in every video.

### The Scan Card (the most important asset)

```
┌──────────────────────────────┐   fill #1A1A24, 1px border #2A2A3A, radius 16
│  Samosa · 1 large piece      │   Inter SemiBold, #8A8A9E
│  ~260 kcal                   │   Inter Bold, very large, #00D4FF
│  P 5g · C 32g · F 13g        │   Inter Medium, small, white
└──────────────────────────────┘
```

- Animation: pops in (scale 0.85 → 1.0 over 150ms) on the *zzt-ding*, **holds for at least 1.2s**,
  then slides out.
- Big numbers (≥400 kcal) turn the number `#FF3D71` and trigger the Faint.
- Swaps that win get a `#00E676` border flash.
- It should look like the app's own UI, because it *is* the app's result. Viewers who then open
  Elovia see the same card.

### Series sticker
A small pill in the top-left safe area, for example `SCAN IT FIRST #3` or `WEDDING SEASON · PART 2`.
`#FF6B35` fill, Inter Bold, white text. It's on screen for the whole video. This is what makes a
series feel like a series.

### Wristband display
A tiny on-screen counter tied to Elo's wrist: a running calorie total or a protein meter. Add it in
the edit, not in the generation.

### AI disclosure tag
A permanent small text in the bottom-left safe area: **"AI character"** (IN: "AI character · main
AI hoon"). Keep it subtle but always there. See `06` for why.

### End frame
No logo slate. The video loops back to the start. **Exception:** founder or app-CTA videos can
close on a 1-second charcoal frame with the Elovia icon and one line.

---

## 4. On-screen text

| Type | Rules |
|---|---|
| **Hook text** | Up in the top third (below the safe line). **7 words or fewer.** Inter Bold, white on a `#0A0A0F` pill at 85% opacity. On screen from frame 1 to about 3s. |
| **Captions** | Always burned in; many people watch on mute. Word-by-word, 1–3 words at a time, centred just above the bottom safe zone. **Numbers highlighted in `#00D4FF`.** Proofread Hinglish by hand. |
| **Numbers** | Always "~" plus a portion ("~260 kcal · 1 large piece"). Never decimals for calories. |
| **No walls of text** | If it needs more than two lines, it belongs in a slideshow, not the video. |

---

## 5. Sound

| Layer | Rule |
|---|---|
| **Elo's voice** | Always the locked voice ID, always run through Voice Changer. The loudest layer, peaking around -6 dB. |
| **Signature sounds** | Get these made or licensed **once** and use them everywhere. They're the audio logo. *zzt-ding* (scan) · *beep-beep-beep* (faint) · *tick* (wristband) · *crackle* ("Elo out") |
| **Music** | A low bed (-24 to -28 dB) from **each platform's commercial music library** or a royalty-free library. Business accounts generally **can't** use trending copyrighted songs, and the character's voice is original audio anyway, which is an advantage: people can reuse *your* sound. |
| **Silence before the number** | A half-second beat of silence before every reveal. It's the comedic timing. |

---

## 6. Structure and pacing (the skeleton every video uses)

```
0.0–2.0s   HOOK       Elo or a villain mid-action + hook text + first line. No intro, no "hey guys".
2–8s       TENSION    The food tempts / the body complains / the guess countdown.
~5–10s     REVEAL     Scan → number. Number on screen no later than ~10s (earlier = better).
10–20s     TURN       The swap, the portion, the "log it". Elo's warmth after the roast.
last 1–2s  LOOP       A line or visual that flows back into frame 1.
```

- **Cuts every 1.5–3 seconds.** Static shots longer than 3s lose people.
- **One idea per video.** If it needs two numbers, it's a "vs" video; three or more, it's a slideshow.
- **The app appears in every video** for 1–2 real seconds (scan, log, confetti, chart). An explicit
  "download" CTA goes in at most **one video in four**.

---

## 7. Hook library (12 proven patterns, Elo versions)

| # | Pattern | Elo example |
|---|---|---|
| 1 | **Interrupt mid-action** | Elo leaps onto the samosa: "RUKO." |
| 2 | **Horror reveal** | Dark kitchen, two blue eyes open: "I'm watching." |
| 3 | **POV relatable** | "POV: your phone has trust issues" |
| 4 | **Guess challenge** | "1 naan vs 3 rotis. Guess in 3 seconds." |
| 5 | **Number first** | "1,102 calories. One wedding plate." |
| 6 | **Villain monologue** | Samosa Bhai: "Ek hi toh hai, boss." |
| 7 | **Myth on trial** | Rice behind bars: "My client is innocent." |
| 8 | **Body-part complaint** | Liver on the phone: "Haan ji, complaint file karni hai." |
| 9 | **"You're doing it wrong"** | "You're counting the food. Not the chai." |
| 10 | **Comment callback** | Your comment on screen: "You asked. I scanned." |
| 11 | **Series continuation** | "Wedding season, part 2. You survived part 1?" |
| 12 | **Notification hijack** | "Your order is on the way 🛵" → Elo: "CANCEL." |

Rotate them so no two consecutive videos use the same hook pattern.

---

## 8. Post captions, hashtags and covers

**Caption formula**: three short lines:

```
[One-line restatement of the hook or the twist]
[A question that's easy to answer in the comments]
[Disclosure line] · [3–5 hashtags]
```

Example (IN):
```
Ek samosa. 260. Chai ke saath 340. 😵
Office mein "bas ek" kaun bolta hai? Tag karo 👇
AI character · #caloriecount #indianfood #fitnessindia #officelife
```

**Hashtags:** 3–5 at most, specific, not spammy. IN: `#indianfood #caloriecount #fitnessindia
#weddingseason #desifitness`. US: `#caloriecounting #fitnesshumor #mealprep #thanksgiving`.

**Covers** (YouTube Shorts and the Instagram grid): Elo, the number and a title of three words or
fewer, for example **"SAMOSA: 260 😵"**. Keep the layout consistent so the grid reads like a show.

---

## 9. Accessibility and safety in the edit

- Captions on every video.
- **Flashes (the scan beam, the faint):** at most 3 flashes per second, and no full-screen strobing (photosensitivity).
- No body shaming in visuals: no scales, measuring tapes around bodies, or before/after silhouettes.
- No real brand logos on food or packaging. Blur them or generate generic packaging.
