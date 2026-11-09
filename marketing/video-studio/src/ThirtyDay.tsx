import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/900.css";
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Beat, END_CARD_SECONDS, Episode, FPS } from "./types";

// Elovia palette (artifacts/mobile/constants/colors.ts)
const C = {
  bg: "#0A0A0F",
  card: "#1A1A24",
  border: "#2A2A3A",
  cyan: "#00D4FF",
  text: "#FFFFFF",
  muted: "#8A8A9E",
  red: "#FF3D71",
  green: "#00E676",
};
const FONT = "Inter, 'DejaVu Sans', Arial, sans-serif";

const clean = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/** One big word at a time, popping in. Highlighted words turn cyan. */
const WordCaption: React.FC<{ text: string; frames: number; highlight?: string[] }> = ({
  text,
  frames,
  highlight = [],
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(/\s+/).filter(Boolean);
  const per = frames / words.length;
  const i = Math.min(words.length - 1, Math.floor(frame / per));
  const local = frame - i * per;
  const pop = spring({ frame: local, fps, config: { damping: 12, stiffness: 220 } });
  const word = words[i];
  const isHi = highlight.map(clean).includes(clean(word));
  return (
    <div
      style={{
        position: "absolute",
        top: 300,
        width: "100%",
        textAlign: "center",
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: 132,
        letterSpacing: -2,
        color: isHi ? C.cyan : C.text,
        textShadow: "0 6px 30px rgba(0,0,0,0.85)",
        transform: `scale(${0.7 + 0.3 * pop})`,
        textTransform: "lowercase",
      }}
    >
      {word}
    </div>
  );
};

const Pill: React.FC<{ children: React.ReactNode; color?: string; bg?: string; style?: React.CSSProperties }> = ({
  children,
  color = C.text,
  bg = "rgba(10,10,15,0.85)",
  style,
}) => (
  <div
    style={{
      position: "absolute",
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 38,
      color,
      background: bg,
      border: `2px solid ${C.border}`,
      borderRadius: 999,
      padding: "12px 28px",
      ...style,
    }}
  >
    {children}
  </div>
);

const Visual: React.FC<{ beat: Beat; frames: number }> = ({ beat, frames }) => {
  const frame = useCurrentFrame();
  const z = beat.zoom ?? "in";
  const scale =
    z === "none" ? 1 : interpolate(frame, [0, frames], z === "in" ? [1, 1.12] : [1.12, 1], {
      extrapolateRight: "clamp",
    });
  if (beat.compareWith && beat.image) {
    // Day 1 vs Day 30 side by side
    const label = (t: string, c: string) => (
      <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: 56, color: c, textAlign: "center", marginTop: 16 }}>{t}</div>
    );
    return (
      <AbsoluteFill style={{ flexDirection: "row", justifyContent: "center", alignItems: "flex-start", gap: 40, paddingTop: 470 }}>
        <div>
          <Img src={staticFile(beat.image)} style={{ height: 860, opacity: 0.85 }} />
          {label("DAY 1", C.muted)}
        </div>
        <div>
          <Img src={staticFile(beat.compareWith)} style={{ height: 860 }} />
          {label("DAY 30", C.cyan)}
        </div>
      </AbsoluteFill>
    );
  }
  if (beat.video) {
    return (
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo src={staticFile(beat.video)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    );
  }
  if (!beat.image) return null;
  if (beat.layout === "character") {
    // Narrow character still: sits below the caption area, above the progress bar.
    return (
      <AbsoluteFill style={{ alignItems: "center" }}>
        <Img
          src={staticFile(beat.image)}
          style={{ position: "absolute", top: 440, height: 1000, transform: `scale(${scale})`, transformOrigin: "50% 100%" }}
        />
      </AbsoluteFill>
    );
  }
  // 9:16 frames fill the screen.
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `scale(${scale})` }}>
      <Img src={staticFile(beat.image)} style={{ height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  );
};

const BeatScene: React.FC<{ beat: Beat; frames: number }> = ({ beat, frames }) => {
  const frame = useCurrentFrame();
  const day = Math.round(interpolate(frame, [0, frames], [beat.dayFrom, beat.dayTo], { extrapolateRight: "clamp" }));
  const fadeIn = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <Visual beat={beat} frames={frames} />
      {/* top gradient keeps captions readable */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,10,15,0.9) 0%, rgba(10,10,15,0) 38%)" }} />
      <WordCaption text={beat.caption} frames={frames} highlight={beat.highlight} />
      <Pill style={{ top: 230, left: 60 }} color={C.cyan}>
        DAY {String(day).padStart(2, "0")}
      </Pill>
      {beat.level ? (
        <Pill style={{ top: 230, right: 180 }} bg={C.cyan} color={C.bg}>
          LV {beat.level}
        </Pill>
      ) : null}
      {/* 30-day progress bar, kept above the bottom UI safe zone */}
      <div style={{ position: "absolute", left: 80, right: 220, top: 1450, height: 14, background: C.border, borderRadius: 7 }}>
        <div style={{ width: `${(day / 30) * 100}%`, height: "100%", background: C.cyan, borderRadius: 7, boxShadow: `0 0 18px ${C.cyan}` }} />
      </div>
      {beat.source ? (
        <div style={{ position: "absolute", left: 80, right: 220, top: 1480, fontFamily: FONT, fontWeight: 500, fontSize: 26, color: C.muted }}>
          {beat.source}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ ep: Episode }> = ({ ep }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          transform: `scale(${0.9 + 0.1 * s})`,
          opacity: s,
          width: 860,
          background: C.card,
          border: `2px solid ${C.border}`,
          borderRadius: 40,
          padding: 64,
          fontFamily: FONT,
          textAlign: "center",
        }}
      >
        <svg width="110" height="150" viewBox="0 0 22 30" style={{ filter: `drop-shadow(0 0 18px ${C.cyan})` }}>
          <polygon points="13,0 2,17 10,17 7,30 20,11 12,11" fill={C.cyan} />
        </svg>
        <div style={{ fontWeight: 900, fontSize: 72, color: C.text, lineHeight: 1.1 }}>
          Day 1 starts today.
        </div>
        <div style={{ fontWeight: 700, fontSize: 44, color: C.cyan, marginTop: 28 }}>{ep.cta}</div>
        <div style={{ fontWeight: 500, fontSize: 32, color: C.muted, marginTop: 28 }}>
          Track every rep · streaks · PRs
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const ThirtyDay: React.FC<{ episode: Episode }> = ({ episode: ep }) => {
  let cursor = 0;
  const seqs = ep.beats.map((b, i) => {
    const frames = Math.round(b.seconds * FPS);
    const from = cursor;
    cursor += frames;
    return (
      <Sequence key={i} from={from} durationInFrames={frames}>
        <BeatScene beat={b} frames={frames} />
      </Sequence>
    );
  });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {seqs}
      <Sequence from={cursor} durationInFrames={END_CARD_SECONDS * FPS}>
        <EndCard ep={ep} />
      </Sequence>
      {/* always-on overlays */}
      <Pill style={{ top: 140, left: 60, fontSize: 30, padding: "8px 22px" }} bg="#FF6B35">
        {ep.series}
      </Pill>
      <div style={{ position: "absolute", left: 60, top: 1540, fontFamily: FONT, fontWeight: 500, fontSize: 26, color: C.muted }}>
        {ep.disclosure}
      </div>
      {ep.voiceover ? <Audio src={staticFile(ep.voiceover)} /> : null}
      {ep.music ? <Audio src={staticFile(ep.music)} volume={0.12} /> : null}
    </AbsoluteFill>
  );
};
