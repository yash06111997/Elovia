export const PRIMARY_TABS = {
  home: "Home",
  train: "Train",
  nutrition: "Nutrition",
  progress: "Progress",
  more: "More",
} as const;

export type MoreCapability = {
  label: string;
  description: string;
  route: `/${string}`;
  icon: string;
  tone: "primary" | "green" | "orange" | "yellow" | "violet";
};

export const MORE_CAPABILITY_GROUPS: ReadonlyArray<{
  title: string;
  items: readonly MoreCapability[];
}> = [
  {
    title: "Track & plan",
    items: [
      {
        label: "Record a run",
        description: "Live GPS map, pace and splits",
        route: "/run",
        icon: "navigate-outline",
        tone: "green",
      },
      {
        label: "Training programmes",
        description: "Curated plans for every level",
        route: "/plans",
        icon: "library-outline",
        tone: "primary",
      },
      {
        label: "Hydration",
        description: "Water log and daily goal",
        route: "/hydration",
        icon: "water-outline",
        tone: "primary",
      },
      {
        label: "Scan a barcode",
        description: "Look up packaged food",
        route: "/scan",
        icon: "barcode-outline",
        tone: "orange",
      },
      {
        label: "Supplements",
        description: "Reminders and adherence",
        route: "/supplements",
        icon: "medkit-outline",
        tone: "yellow",
      },
      {
        label: "My places",
        description: "Gym arrival automations",
        route: "/places",
        icon: "location-outline",
        tone: "orange",
      },
    ],
  },
  {
    title: "Coaching & community",
    items: [
      {
        label: "Ask Elovia",
        description: "Training and nutrition coach",
        route: "/coach",
        icon: "chatbubbles-outline",
        tone: "violet",
      },
      {
        label: "1-on-1 coaching",
        description: "Work with a real coach",
        route: "/coaching",
        icon: "videocam-outline",
        tone: "violet",
      },
      {
        label: "Community",
        description: "Friends, feed and challenges",
        route: "/social",
        icon: "people-outline",
        tone: "primary",
      },
      {
        label: "Achievements",
        description: "Levels, streaks and badges",
        route: "/achievements",
        icon: "trophy-outline",
        tone: "yellow",
      },
    ],
  },
] as const;
