# 05 · Production pipeline

How one person can make about one Elo video a day without Elo drifting off-model.

> **Tool landscape as of 9 Nov 2026.** AI video tools change monthly. Prices and limits below
> come from vendor pages and third-party reviews gathered on that date; several are single-source.
> **Check the price on each vendor's own page before you subscribe.** Re-check this file every
> quarter. Sora 2 has already been discontinued (app closed April 2026, API September 2026), so
> don't build on it.

---

## 1. The stack

| Job | Primary | Fallback / second lane | Why |
|---|---|---|---|
| **Character design and reference sheet** | **Nano Banana Pro** (Gemini image) | FLUX.2 | Takes multiple character references and is good at clean, consistent stylised 3D. Avoid Midjourney V8 for this: character reference isn't supported in V8. |
| **Video with dialogue** | **Kling 3.0 Omni, using "Elements"** (2–4 reference images plus a bound voice sample) | **Gemini Omni 1.2 Flash** via Google Flow (cheapest, high quality, but the voice isn't locked) | Kling Elements is the only widely documented feature that locks the **look and the voice** in one reusable asset. It makes clips up to 15s with multiple shots. |
| **Voice** | **ElevenLabs**: design Elo's voice once and save the voice ID. Use **Voice Changer** on every final clip. | — | Voice Changer swaps any drifting voice for Elo's locked voice and keeps the timing, so lip sync survives. |
| **Talking-only shots (safety net)** | **Hedra Character-3** (image plus audio, gives a talking shot) | HeyGen Avatar IV (supports stylised characters) | Gives the exact same voice every time. Use it when a day's video is mostly Elo talking to camera. |
| **Edit, captions, overlays** | **CapCut** (desktop) | Descript | Auto-captions, templates for the scan card and the series title, sound-effects library. |
| **Real app footage** | Your own phone's screen recorder | — | It's real, it's free, and it's what makes people install. |

**Test before you commit (Week 0):** generate the same 5 shots in Kling and in Gemini Omni. Keep
whichever tool stays on-model more often. Kling 4.0 and Seedance 2.5 make 30-second clips with
voice references; they're worth a test in Q1 2027 once they've matured.

### Budget (rough, for 30 videos a month)

| Item | Approx. |
|---|---|
| Fixed tools: ElevenLabs (about $22), CapCut Pro (about $20), Google AI Pro (about $20), plus Hedra (about $20) if you use the fallback | **$80–100 / month** |
| Video generation, at 3–5 shots per video and about 3× the final length in takes | **$5–25 per video**, so about **$150–700 / month** |
| **Total** | **About $250–800 / month** |

Subscription credits usually work out cheaper than API list prices. Expect **3–6 attempts per usable shot**.

### Time

- First week: 3–4 hours per video while you learn the tools.
- Steady state: **1.5–2.5 hours per video**, including the script. Batching (below) brings that down.

---

## 2. Build Elo (Week 0, one day)

### Step 1: master reference sheet (Nano Banana Pro)

Paste this **character block** word for word. It goes, unchanged, into every prompt you write from here on.

```
ELO — a small (15 cm tall) stylized 3D mascot character. Rounded gumdrop-shaped body
(head and body are one shape, no neck), electric blue #00D4FF, matte soft-vinyl
designer-toy material with a subtle inner glow. One lightning-bolt-shaped crest on top
of the head, leaning forward, white-blue at the tip. Large round white eyes with simple
black pupils. Small simple dark mouth. Short stubby arms with rounded mitten hands
(no fingers). Short legs wearing white running shoes with blue soles. A black wrist
sweatband with a tiny glowing display. Clean simple shapes, no text or logos on the
body, no fur, no extra accessories.
```

Reference-sheet prompt:

```
[CHARACTER BLOCK]
Character turnaround reference sheet on a plain light-grey background, even studio
lighting: front view, three-quarter view, side view, back view. Below: six facial
expressions (neutral, smug, shocked, fainting, proud, suspicious) and three poses
(scanning with eyes glowing and a blue light beam, hands up saying "stop",
two-finger salute). Consistent proportions across all views.
```

- Generate about 10 sheets. Pick the best **3–5 images** as the **golden set** and save them as
  `elo-golden-v1/` (front, three-quarter, side, an expression sheet, the scan pose).
- **Always generate from the golden originals.** Never use a regenerated copy as a reference;
  consistency gets worse with every generation you build on.
- Make one golden set for each supporting character (Samosa Bhai, the Jamun Twins, and so on) **only
  when its first video is due**. Don't build the whole cast up front.

### Step 2: lock the voice (ElevenLabs)

Voice Design prompt (EN):

```
A small energetic cartoon character. Mid-high pitch, bright, slightly raspy.
Dry, witty, deadpan delivery with fast comedic timing. Gender-neutral.
Not squeaky, not childish. Clear diction, studio quality.
```

- Save it as **Elo-EN** and record a 20–30 second "anchor" read. Use the bank of lines in
  `02-avatar-bible.md`.
- Hinglish: first test whether the same voice ID reads Hinglish naturally on the multilingual model.
  If it sounds foreign, design **Elo-HI** with the same description plus *"natural Hinglish
  code-switching, neutral urban Indian accent"*, and match the pitch by ear.
- Write both voice IDs and their settings in the production sheet. **Never change them.**

### Step 3: reusable video assets

- **Kling:** create an **Element** called "Elo": the 2–4 golden images plus the voice anchor sample.
- **Gemini Omni / Flow:** save a reference pack with the same golden images.

---

## 3. Making one video, step by step

### A. Script (15 minutes)

Take the entry from `04-30-video-plan.md` and split it into **shots**:

- **One speaker per shot.** When Elo and Samosa Bhai argue, cut between them (shot and reverse
  shot). Two characters talking in one frame breaks lip sync.
- **One line per 5–8 second shot.** Lip sync drifts after about 6–7 seconds.
- **Medium close-ups for dialogue.** In wide shots the mouth is too small to sync.
- **No text in the generation.** Calorie cards, numbers, captions and app screens all go on in
  CapCut. AI tools still garble text.

Shot-list template:

| # | Duration | Who speaks | Line | Visual | Source |
|---|---|---|---|---|---|
| 1 | 2s | — | — | Hand reaches for samosa; Elo leaps out of phone | Kling |
| 2 | 3s | Elo | "RUKO." | MCU Elo landing on samosa | Kling (Elo Element) |
| 3 | 3s | Samosa | "Ek hi toh hai, boss." | MCU Samosa Bhai | Kling (Samosa Element) |
| 4 | 4s | Elo | "Pehle scan." + scan beam | MCU Elo, eyes glow, beam | Kling + CapCut scan card |
| … | | | | | |
| n | 1.5s | — | — | Real Elovia screen recording | Phone |

### B. Generate (45–90 minutes)

Prompt template for each shot (Kling Elements or Gemini Omni):

```
[CHARACTER BLOCK]
Scene: [location, e.g. "a busy Indian office pantry, steel tea cups, warm tube light,
evening"]. Shot: [medium close-up / low angle / over-the-shoulder]. Vertical 9:16.
Action: [one clear action, e.g. "Elo leaps from a smartphone and lands on top of a
golden samosa, arms out"].
Elo says, in a dry deadpan voice: "[ONE LINE]".
Style: stylized 3D animation, soft cinematic lighting, shallow depth of field,
Elo casts a faint blue glow on nearby surfaces. Elo is 15 cm tall relative to the food.
No text on screen.
```

- Generate 3–4 takes per shot. Keep the best one and move on; perfect is the enemy of daily.
- **Reject any take where** Elo's colour changes, the crest is missing, extra accessories appear,
  the hands have fingers, or the scale is wrong.

### C. Real footage (10 minutes)

- Screen-record the actual Elovia flow used in the video: scan, log, PR confetti, progress chart.
- **Use the number the app shows.** The script number is a placeholder from the database.
- Real hands, plates or a phone on a table are encouraged; shoot on your own phone.

### D. Edit (30–45 minutes, CapCut)

1. Lay out the shots and cut tight: a new visual every 1.5–3 seconds.
2. **Voice Changer pass:** export the dialogue audio, run it through ElevenLabs Voice Changer
   with Elo's voice ID, then put it back. Every clip gets this, even when the native audio sounds fine.
3. Add the **Scan Card** template (see `03-style-guide.md`): dark card, #00D4FF accent, Inter Bold numbers.
4. Add the signature sounds: *zzt-ding* (scan), *beep-beep-beep* (faint), *tick* (wristband).
5. Captions: auto-generate them, then **proofread every word**. Hinglish auto-captions are often wrong.
6. On-screen hook text in the first frame.
7. Check the loop: does the last frame flow into the first?
8. Export 1080×1920 with no watermark.

### E. Quality check before scheduling

Use the publishing checklist in `06-distribution-and-measurement.md`. **Every 10th video,** put a
still of Elo next to the golden sheet. If it's drifting, go back to the golden originals.

---

## 4. Weekly batch rhythm (the fastest way to keep posting daily)

| Day | Work | Time |
|---|---|---|
| **Mon** | Write and shot-list 7 scripts; review last week's numbers | 2h |
| **Tue** | Generate all Elo shots for the week | 3h |
| **Wed** | Generate supporting-cast shots and redo failed shots | 2–3h |
| **Thu** | Edit videos 1–4 | 3h |
| **Fri** | Edit videos 5–7; schedule the week; make the slideshow versions | 3h |
| **Daily, 15–30 min** | Reply to comments within the first hour after posting; collect foods for "You Asked" | 0.5h |

That's about 14 hours a week for 7 videos, plus their dubs and slideshows.

### Dubbing a 🌍 BOTH video (about 20 extra minutes)

1. Generate the shots once. For the dub, keep the mouth movement generic: avoid big, held mouth
   shapes, and cut to reaction shots while long lines play.
2. Record the English and Hinglish lines from the same voice ID(s).
3. Swap the audio and captions. Swap on-screen text and food items only where the plan says
   "food swap per market".
4. Export two files: `D16_IN.mp4` and `D16_US.mp4`.

---

## 5. File and naming conventions

```
elovia-content/
  00_bible/            elo-golden-v1/, cast/, voice-ids.txt, scan-card.capcut
  01_scripts/          D01_samosa-ambush.md …
  02_raw/              D01/shot01_take3.mp4 …
  03_app-footage/      D01_log-samosa.mov …
  04_exports/          D01_IN.mp4, D03_IN.mp4, D03_US.mp4 …
  05_slideshows/       D01_IN_slides/ …
  tracker.xlsx         (see 06-distribution-and-measurement.md)
```

Version the golden set (`elo-golden-v1`, `-v2`). If you ever change Elo's design, change it on
purpose, as a "season 2" refresh, not by drift.
