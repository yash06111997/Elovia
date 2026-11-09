import React from "react";
import { Composition } from "remotion";
import { ThirtyDay } from "./ThirtyDay";
import { Episode, FPS, HEIGHT, WIDTH, totalFrames } from "./types";
import wallSit from "./episodes/wall-sit.json";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ThirtyDay"
    component={ThirtyDay}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={totalFrames(wallSit as Episode)}
    defaultProps={{ episode: wallSit as Episode }}
    // Duration follows whichever episode is passed with --props.
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props.episode as Episode),
    })}
  />
);
