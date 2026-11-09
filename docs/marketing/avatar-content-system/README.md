# Elovia × Elo and Ela: AI-avatar short-form content system

A complete, repeatable system for promoting Elovia with recurring AI characters on Instagram Reels,
YouTube Shorts and TikTok, including a working video template you can drive from Claude Code or
Codex. Researched 9 Nov 2026.

## TL;DR

1. **The account you're competing with is Swolo (@swolotips)**: about 293K Instagram, 147K TikTok,
   21M views. A faceless teal hulk, "What happens if you do X every day for 30 days", anatomy
   cutaways, one big word on screen at a time. **They're building their own 30-day-challenge app**,
   so they're a direct competitor. Their winners are weird-but-simple moves (arms out 131K, tib raises
   49K, wall angels 30K); their weak spots are food, women, personality and India. See `07`.
2. **The avatar to go with: Elo and Ela**, a male and female stylised duo in Elovia electric blue on
   charcoal. They're faceless (anyone can project onto them) and **start at Level 1 with an ordinary
   body**, levelling up as the 30 days go on. That's the relatability Swolo's always-huge hulk can't
   give. Ela is **toned, not bulky.**
3. **Other avatars, all designed and rendered** (`02`, `characters/`):
   - **Raja**, the muscular lion: a hype character, for about 1 in 10 episodes.
   - **Oliver (British) and Mila (Russian)**, realistic humans: paid A/B tests only, always labelled as AI.
4. **The plan:** 30 episodes, 16 Nov to 15 Dec. Elo 12, Ela 11, duo 3, Raja 3, founder 1.
   - Swolo's proven format, plus Level 1→2 honesty, a food and habit lane, India specials
     (murga pose, uthak-baithak, Surya Namaskar), try-it-now tests, and the real app in every video.
5. **Made in Claude Code:** `marketing/video-studio/` is a Remotion template that turns an episode JSON
   into a finished 9:16 Short. **A demo has already been rendered:** `characters/demo-elo-wall-sit.mp4`.
6. **To generate full episodes you still need:** the Remotion plugin (or skills), **one** generation
   provider (fal, or the Creative Claw plugin) for image-to-video, and **ElevenLabs** for the
   narrator. All three work in Codex too. See `08`.

## Files

| File | What's in it |
|---|---|
| [`07-swolo-teardown.md`](07-swolo-teardown.md) | **Start here.** Swolo's format, numbers, layer-by-layer teardown, and where Elovia beats them |
| [`02-avatar-bible.md`](02-avatar-bible.md) | **Character sheets** for Elo, Ela, Raja, Oliver and Mila: specs, level-up system, expressions, poses, voice, copy-paste prompt blocks, consistency checklist, scorecard |
| [`characters/`](characters/) | Rendered sheets (turnarounds and expressions), the Level 1/2/3 lineup, a style frame, and the demo MP4 |
| [`04-30-video-plan.md`](04-30-video-plan.md) | The 30 episodes, each with hook, weekly beats, anatomy, honest payoff, app moment, source to verify and comment bait |
| [`08-animation-toolchain.md`](08-animation-toolchain.md) | Every plugin, skill and MCP needed in Claude Code and Codex, plus the end-to-end episode pipeline |
| [`../../../marketing/video-studio/`](../../../marketing/video-studio/) | The Remotion template (captions, day counter, level badge, progress bar, comparison, end card) |
| [`03-style-guide.md`](03-style-guide.md) | Look, palette, captions, annotation colours, sound, hook library |
| [`01-what-is-working-now.md`](01-what-is-working-now.md) | Wider market scan: what AI-character formats work and fade, and the rules |
| [`05-production-pipeline.md`](05-production-pipeline.md) | Tool stack, costs, weekly batch rhythm, dubbing |
| [`06-distribution-and-measurement.md`](06-distribution-and-measurement.md) | Accounts, AI labels, KPIs, review points, attribution, compliance gate |

## Start this week (Week 0: 10–15 Nov)

- [ ] Claim the handles and set up both profiles, **including Instagram's "AI-generated profile" label** (`06` §1)
- [x] Golden sheets regenerated with shoes and more muscle definition (v2.1, 9 Nov)
- [ ] Optional: regenerate the Level 1/2/3 lineup to match the more-defined Level 3 bodies (`02` §2.3)
- [ ] Lock the narrator voice in ElevenLabs (EN, then Hinglish)
- [ ] Install the Remotion plugin, plus fal *or* Creative Claw, plus ElevenLabs (`08` §2)
- [ ] Produce D01–D07 with the template before posting D01 (`04`)
- [ ] Decide the CTA: **pre-launch ("Comment ELO") vs a live store link** (`06` §1)
- [ ] Verify every source line in the plan before it's published

## Ground rules (non-negotiable)

- **Honest 30 days:** Level 1 → 2 only, marked "illustrative". Level 3 never appears as a 30-day result.
- Calorie numbers come from **the Elovia app**, with "~" and the portion. **The AI photo scan is Pro**; never call it free.
- **Label everything as AI.** Characters are never doctors, customers or testimonials. Real app footage in every video.
- Don't copy Swolo's palette, character silhouette, watermark or titles word for word. The *format* is a genre; their *art direction* is theirs.
