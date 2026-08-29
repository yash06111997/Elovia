import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Pressable as RNPressable,
  type PressableProps,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Motion, PRESS_SCALE, MIN_TOUCH, DISABLED_OPACITY } from "@/constants/design";

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

/**
 * Whether the user has asked the OS to reduce motion.
 *
 * Read once and kept in sync with the system setting. Respecting this is an
 * accessibility requirement, not a nicety: motion-triggered vertigo is a real
 * condition, and a spring on every tap is exactly the sort of thing that
 * triggers it.
 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduce(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => setReduce(enabled),
    );

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return reduce;
}

export interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** How far it shrinks while held. */
  scaleTo?: number;
  /** Fire a light haptic on press-in. */
  haptic?: boolean;
  children?: React.ReactNode;
}

/**
 * A tappable surface that responds physically.
 *
 * The stock RN Pressable gives no feedback at all unless you write it
 * yourself, which is why the app currently feels flat: every card is
 * technically tappable but nothing acknowledges the touch. A subtle spring
 * scale is the single highest-leverage polish change available here.
 */
export function PressableScale({
  style,
  scaleTo = PRESS_SCALE,
  haptic = false,
  disabled,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useReduceMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[
        style,
        animatedStyle,
        disabled ? { opacity: DISABLED_OPACITY } : null,
      ]}
      onPressIn={(event) => {
        if (!reduceMotion) {
          scale.value = withSpring(scaleTo, Motion.spring);
        }
        if (haptic) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = reduceMotion ? 1 : withSpring(1, Motion.spring);
        onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

export interface FadeInProps {
  children: React.ReactNode;
  /** Index within a list, used to stagger entrances. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Staggered entrance for list items.
 *
 * Items appearing 40ms apart reads as the list assembling itself; all at once
 * reads as a flash. Capped at 8 items because beyond that the last item is
 * waiting long enough to feel broken rather than considered.
 */
export function FadeInView({ children, index = 0, style }: FadeInProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }

    const delay = Math.min(index, 8) * Motion.stagger;
    const timer = setTimeout(() => {
      opacity.value = withTiming(1, { duration: Motion.normal });
      translateY.value = withSpring(0, Motion.spring);
    }, delay);

    return () => clearTimeout(timer);
  }, [index, reduceMotion, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/** Ensures a control meets the minimum touch target without changing its look. */
export const minTouchTarget: ViewStyle = {
  minWidth: MIN_TOUCH,
  minHeight: MIN_TOUCH,
  alignItems: "center",
  justifyContent: "center",
};

export { useReduceMotion };
