# Exercise catalogue and demo provenance

The checked-in snapshot imports metadata from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) and [wger](https://github.com/wger-project/wger), alongside Elovia's curated entries with stable IDs. Importer: `node scripts/import-exercises.mjs`.

- Imported snapshot: 1,732 unique-name entries, 876 Free Exercise DB and 856 wger entries after exact normalized-name merge.
- Combined mobile catalogue: 1,832 entries after merging with 166 curated entries by normalized name, including 69 video entries and 873 entries with images. Curated exercise IDs remain stable.
- Free Exercise DB revision pinned in image/source URLs: f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5.
- Metadata/instructions are bundled for offline browsing. Remote photos/videos require a connection. No remote API key is needed to browse the catalogue.
- 46 imported entries have reusable wger video clips. Only whitelisted CC BY, CC BY-SA or public-domain media are accepted; each includes its author, source and license link. Attribution is shown in the exercise detail.
- The owner chose **no paid provider**. Eighteen clips from [YMove's explicitly free pack](https://ymove.app/free-exercise-videos) add demos to 23 previously clipless entries, including common curated lifts. The publisher allows free commercial in-app use without an account, but prohibits standalone media resale/redistribution. Only public free-clip URLs and attribution are bundled, not downloaded videos. Existing wger demos remain unchanged. Refresh script: `node scripts/import-free-demos.mjs`; it checks license text and video streaming headers before generating the metadata snapshot.
- Matches are explicit exercise IDs, not fuzzy similarities. Front squats, Romanian deadlifts, cable lateral raises and unmatched variants do not inherit different-movement clips. Dedicated pec-deck/leg-extension/hack-squat equipment is corrected to machine, and the curated dumbbell goblet squat requires dumbbells. Header checks passed on 2026-10-05; native playback and form review still need a device.
- Demo playback is user initiated, muted, and resets at ten seconds; shorter clips loop at their natural end. Photos and written instructions are explicitly labeled when video is unavailable. Some source videos use HEVC/MOV, so playback compatibility requires native device testing.
- wger does not provide difficulty or compound/isolation ratings. Those entries are labeled unrated/unspecified and excluded from automatic local training plans, but remain searchable and manually selectable. Unknown equipment is never assumed equipment-free.
- Primary/secondary muscle and equipment filtering can be combined; names, muscles and equipment can be sorted. The owned-equipment filter requires all listed equipment.

## Remaining content gate

This is **not** video coverage for every exercise. No paid provider will be purchased. Full coverage remains dependent on free commercial-use clips for the remaining exact movements or owner-recorded, reviewed original clips. Do not scrape subscription-provider videos, relabel photos as videos, synthesize unverified form demonstrations, or publish a "video for every exercise" claim.

Rejected sources: `arhxam/free-exercise-db-with-videos` says its videos were bought from an unknown Instagram seller and it cannot establish ownership; its MIT code/metadata license is not a commercial video grant. `flow-exercise-dataset` offers unreviewed SVG illustrations rather than validated human demo videos. RepDB's free tier provides static poses, while animation access is not a free production grant. These were not imported as commercial exercise videos.
