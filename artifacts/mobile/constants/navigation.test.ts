import { MORE_CAPABILITY_GROUPS, PRIMARY_TABS } from "./navigation";

describe("mobile information architecture", () => {
  it("uses the approved five primary destinations", () => {
    expect(Object.values(PRIMARY_TABS)).toEqual([
      "Home",
      "Train",
      "Nutrition",
      "Progress",
      "More",
    ]);
  });

  it("keeps every secondary product capability reachable from More", () => {
    const items = MORE_CAPABILITY_GROUPS.flatMap((group) => group.items);
    expect(items.map((item) => item.route)).toEqual(
      expect.arrayContaining([
        "/run",
        "/plans",
        "/hydration",
        "/scan",
        "/supplements",
        "/places",
        "/coach",
        "/coaching",
        "/social",
        "/achievements",
      ]),
    );
    expect(new Set(items.map((item) => item.route)).size).toBe(items.length);
  });
});
