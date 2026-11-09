// Episode schema for the "30 days" format. One JSON file per video in src/episodes/.
// Word timings are spread evenly across each beat unless `words` timings are
// supplied (for example from ElevenLabs "text-to-speech with timestamps").

export type Beat = {
  /** Seconds this beat stays on screen. */
  seconds: number;
  /** Narration / caption text for this beat. One word is shown at a time. */
  caption: string;
  /** Words to highlight in brand cyan (case-insensitive, punctuation ignored). */
  highlight?: string[];
  /** Image in public/ (character still or start frame). Ignored if `video` is set. */
  image?: string;
  /** Optional image-to-video clip in public/ (Kling / Seedance / Veo output). */
  video?: string;
  /** Second image shown side by side (Day 1 vs Day 30 comparison). */
  compareWith?: string;
  /** Day counter value at the start and end of the beat (1..30). */
  dayFrom: number;
  dayTo: number;
  /** Level badge to show (1, 2 or 3). */
  level?: 1 | 2 | 3;
  /** "cover" fills the 9:16 frame (start frames, clips); "character" places a
   *  narrow character still below the caption area. Default "cover". */
  layout?: "cover" | "character";
  /** Ken Burns zoom: "in" | "out" | "none". */
  zoom?: "in" | "out" | "none";
  /** Optional small source line for science claims, e.g. "Source: …". */
  source?: string;
};

export type Episode = {
  /** Series sticker, e.g. "30 DAYS". */
  series: string;
  /** Exercise or habit name, used on the end card. */
  challenge: string;
  beats: Beat[];
  /** End card call to action. */
  cta: string;
  /** Optional narration audio in public/ (whole video). */
  voiceover?: string;
  /** Optional music bed in public/. */
  music?: string;
  /** Always-on disclosure tag. */
  disclosure: string;
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const END_CARD_SECONDS = 3;

export const totalFrames = (ep: Episode) =>
  Math.round(
    (ep.beats.reduce((s, b) => s + b.seconds, 0) + END_CARD_SECONDS) * FPS,
  );
