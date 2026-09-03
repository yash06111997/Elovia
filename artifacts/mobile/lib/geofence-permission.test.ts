const mockForegroundPermission = jest.fn();
const mockBackgroundPermission = jest.fn();

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: mockForegroundPermission,
  requestBackgroundPermissionsAsync: mockBackgroundPermission,
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock("./accountSyncStorage", () => ({
  captureAccountStorageSession: jest.fn(),
  readStableBackgroundAccountValue: jest.fn(),
  readStableBackgroundAccountValueWithOwner: jest.fn(),
}));

import { requestGeofencePermissions } from "./geofence";

describe("geofence permission outcomes", () => {
  beforeEach(() => {
    mockForegroundPermission.mockReset();
    mockBackgroundPermission.mockReset();
  });

  it("reports blocked when foreground permission cannot be requested again", async () => {
    mockForegroundPermission.mockResolvedValue({
      status: "denied",
      canAskAgain: false,
    });

    await expect(requestGeofencePermissions()).resolves.toBe("blocked");
    expect(mockBackgroundPermission).not.toHaveBeenCalled();
  });

  it("reports blocked when background permission cannot be requested again", async () => {
    mockForegroundPermission.mockResolvedValue({
      status: "granted",
      canAskAgain: true,
    });
    mockBackgroundPermission.mockResolvedValue({
      status: "denied",
      canAskAgain: false,
    });

    await expect(requestGeofencePermissions()).resolves.toBe("blocked");
  });

  it("keeps foreground-only distinct while the background prompt remains available", async () => {
    mockForegroundPermission.mockResolvedValue({
      status: "granted",
      canAskAgain: true,
    });
    mockBackgroundPermission.mockResolvedValue({
      status: "denied",
      canAskAgain: true,
    });

    await expect(requestGeofencePermissions()).resolves.toBe("foreground_only");
  });
});
