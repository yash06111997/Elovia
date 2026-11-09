# Elovia video studio (Remotion)

Turns an episode JSON into a finished 9:16 "30 days" Short featuring Elo or Ela. It handles
one-word captions, the Day 1→30 counter and progress bar, level badges, a Day 1 vs Day 30
comparison, the end card and the AI-disclosure tag.

It's a **standalone** Node project and isn't part of the pnpm workspace. The design rules come from
`docs/marketing/avatar-content-system/` (`02` avatar bible, `03` style guide, `08` toolchain).

## Run it

```bash
cd marketing/video-studio
npm install
npm run studio                       # live preview in the browser
npx remotion render src/index.ts ThirtyDay out/wall-sit.mp4 \
  --props='{"episode":'"$(cat src/episodes/wall-sit.json)"'}'
```

In a Claude Code **cloud** session, Remotion can't download its own browser, so point it at the
pre-installed one:

```bash
--browser-executable=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
```

## Make a new episode

1. Copy `src/episodes/wall-sit.json` to `src/episodes/<move>.json`.
2. Put the assets in `public/`:
   - character stills generated from the golden sheets (`layout: "character"`)
   - full 9:16 start frames (`layout: "cover"`)
   - image-to-video clips (`video`)
   - `voiceover` and `music` files (optional)
3. Write one `caption` per beat. It's spoken by the narrator and shown one word at a time.
   Put the key words in `highlight` (they turn cyan).
4. Set `dayFrom` / `dayTo` and `level` (1 for Day 1, 2 for Day 30). Never show Level 3 in a 30-day episode.
5. Add a `source` line on every beat that makes a science claim.
6. Render with `--props` pointing at the new JSON.

## Files

| Path | What |
|---|---|
| `src/types.ts` | Episode schema |
| `src/ThirtyDay.tsx` | The composition: captions, counter, level badge, progress bar, comparison, end card |
| `src/Root.tsx` | Registers the `ThirtyDay` composition; its duration follows the episode |
| `src/episodes/wall-sit.json` | Demo episode (rendered to `docs/marketing/avatar-content-system/characters/demo-elo-wall-sit.mp4`) |
| `public/elo/` | Elo stills cropped from the generated sheets (low-res placeholders; replace them with full-res renders) |
