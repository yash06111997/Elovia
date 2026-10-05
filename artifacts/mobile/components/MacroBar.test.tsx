import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: { View },
    ReduceMotion: { System: "system" },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => value,
  };
});

import { MacroBar } from "./MacroBar";

describe("MacroBar", () => {
  it("announces the recorded and target grams as progress", async () => {
    const screen = await render(
      <MacroBar label="Protein" current={42} target={150} color="#00D4FF" />,
    );

    const progress = screen.getByRole("progressbar", { name: "Protein" });
    expect(progress.props.accessibilityValue).toEqual({
      min: 0,
      max: 150,
      now: 42,
      text: "42 of 150 grams",
    });
  });

  it("announces an unset target without exposing invalid progress bounds", async () => {
    const screen = await render(
      <MacroBar label="Carbs" current={0} target={0} color="#FF6B35" />,
    );

    const progress = screen.getByRole("progressbar", { name: "Carbs" });
    expect(progress.props.accessibilityValue).toEqual({
      min: 0,
      max: 1,
      now: 0,
      text: "0 grams recorded; no target set",
    });
  });
});
