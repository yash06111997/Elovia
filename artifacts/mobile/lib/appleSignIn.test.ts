jest.mock("expo-apple-authentication", () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { HEX: "hex" },
}));
jest.mock("firebase/auth", () => ({
  OAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
}));
jest.mock("./firebase", () => ({ getFirebaseAuth: jest.fn() }));

import {
  isAppleSignInCancellation,
  signInWithAppleFirebase,
} from "./appleSignIn";

describe("Apple Firebase authentication", () => {
  const randomUUID = jest.fn();
  const hashNonce = jest.fn();
  const requestCredential = jest.fn();
  const redeemFirebase = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    randomUUID
      .mockReturnValueOnce("state-123")
      .mockReturnValueOnce("nonce-a")
      .mockReturnValueOnce("nonce-b");
    hashNonce.mockResolvedValue("hashed-nonce");
    requestCredential.mockResolvedValue({
      state: "state-123",
      identityToken: "apple-identity-token",
    });
    redeemFirebase.mockResolvedValue({ uid: "apple-user" });
  });

  it("binds Apple's identity token to a fresh raw nonce before Firebase sign in", async () => {
    await expect(
      signInWithAppleFirebase({
        randomUUID,
        hashNonce,
        requestCredential,
        redeemFirebase,
      }),
    ).resolves.toEqual({ uid: "apple-user" });

    expect(hashNonce).toHaveBeenCalledWith("nonceanonceb");
    expect(requestCredential).toHaveBeenCalledWith({
      requestedScopes: [0, 1],
      state: "state-123",
      nonce: "hashed-nonce",
    });
    expect(redeemFirebase).toHaveBeenCalledWith({
      identityToken: "apple-identity-token",
      rawNonce: "nonceanonceb",
    });
  });

  it("rejects a mismatched response state before creating a Firebase credential", async () => {
    requestCredential.mockResolvedValue({
      state: "wrong-state",
      identityToken: "apple-identity-token",
    });

    await expect(
      signInWithAppleFirebase({
        randomUUID,
        hashNonce,
        requestCredential,
        redeemFirebase,
      }),
    ).rejects.toThrow("security check");
    expect(redeemFirebase).not.toHaveBeenCalled();
  });

  it("rejects a missing Apple identity token before Firebase redemption", async () => {
    requestCredential.mockResolvedValue({
      state: "state-123",
      identityToken: null,
    });

    await expect(
      signInWithAppleFirebase({
        randomUUID,
        hashNonce,
        requestCredential,
        redeemFirebase,
      }),
    ).rejects.toThrow("identity token");
    expect(redeemFirebase).not.toHaveBeenCalled();
  });

  it("recognizes only Apple's explicit user-cancellation error", () => {
    expect(isAppleSignInCancellation({ code: "ERR_REQUEST_CANCELED" })).toBe(
      true,
    );
    expect(
      isAppleSignInCancellation({ code: "auth/network-request-failed" }),
    ).toBe(false);
  });
});
