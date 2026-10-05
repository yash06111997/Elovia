# Exercise catalogue and demo provenance

The checked-in snapshot imports metadata from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) and [wger](https://github.com/wger-project/wger), alongside Elovia's curated entries with stable IDs. Importer: `node scripts/import-exercises.mjs`.

- Imported snapshot: 1,732 unique-name entries, 876 Free Exercise DB and 856 wger entries after exact normalized-name merge.
- Combined mobile catalogue: 1,832 entries after merging with 166 curated entries by normalized name, including 46 video entries and 873 entries with images. Curated exercise IDs remain stable.
- Free Exercise DB revision pinned in image/source URLs: f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5.
- Metadata/instructions are bundled for offline browsing. Remote photos/videos require a connection. No remote API key is needed to browse the catalogue.
- 46 imported entries have reusable wger video clips. Only whitelisted CC BY, CC BY-SA or public-domain media are accepted; each includes its author, source and license link. Attribution is shown in the exercise detail.
- Demo playback is user initiated, muted, and resets at ten seconds; shorter clips loop at their natural end. Photos and written instructions are explicitly labeled when video is unavailable. Some source videos use HEVC/MOV, so playback compatibility requires native device testing.
- wger does not provide difficulty or compound/isolation ratings. Those entries are labeled unrated/unspecified and excluded from automatic local training plans, but remain searchable and manually selectable. Unknown equipment is never assumed equipment-free.
- Primary/secondary muscle and equipment filtering can be combined; names, muscles and equipment can be sorted. The owned-equipment filter requires all listed equipment.

## Remaining content gate

The owner has no licensed provider or owned demo clips. This is **not** video coverage for every exercise. Do not scrape subscription-provider videos, relabel photos as videos, synthesize unverified form demonstrations, or publish a "video for every exercise" claim. Complete coverage requires obtaining a licensed provider or filming/validating original clips. No paid media service has been purchased.
