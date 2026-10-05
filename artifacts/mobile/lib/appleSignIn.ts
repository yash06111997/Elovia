import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import {
  OAuthProvider,
  signInWithCredential,
  type User as FirebaseUser,
} from "firebase/auth";

import { getFirebaseAuth } from "./firebase";

interface AppleCredentialResult {
  state: string | null;
  identityToken: string | null;
}

interface AppleSignInDependencies {
  randomUUID: () => string;
  hashNonce: (rawNonce: string) => Promise<string>;
  requestCredential: (input: {
    requestedScopes: AppleAuthentication.AppleAuthenticationScope[];
    state: string;
    nonce: string;
  }) => Promise<AppleCredentialResult>;
  redeemFirebase: (input: {
    identityToken: string;
    rawNonce: string;
  }) => Promise<FirebaseUser>;
}

function productionDependencies(): AppleSignInDependencies {
  return {
    randomUUID: () => Crypto.randomUUID(),
    hashNonce: (rawNonce) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, {
        encoding: Crypto.CryptoEncoding.HEX,
      }),
    requestCredential: (input) => AppleAuthentication.signInAsync(input),
    async redeemFirebase({ identityToken, rawNonce }) {
      const firebaseAuth = await getFirebaseAuth();
      const provider = new OAuthProvider("apple.com");
      const credential = provider.credential({
        idToken: identityToken,
        rawNonce,
      });
      const result = await signInWithCredential(firebaseAuth, credential);
      return result.user;
    },
  };
}

export function isAppleSignInCancellation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ERR_REQUEST_CANCELED",
  );
}

/**
 * Uses Apple's native credential sheet and binds the returned identity token
 * to this exact Firebase attempt with a SHA-256 nonce.
 */
export async function signInWithAppleFirebase(
  dependencies: AppleSignInDependencies = productionDependencies(),
): Promise<FirebaseUser> {
  const state = dependencies.randomUUID();
  const rawNonce = `${dependencies.randomUUID()}${dependencies.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const hashedNonce = await dependencies.hashNonce(rawNonce);

  const appleCredential = await dependencies.requestCredential({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    state,
    nonce: hashedNonce,
  });

  if (!appleCredential.state || appleCredential.state !== state) {
    throw new Error("Apple sign-in security check failed. Please try again.");
  }
  if (!appleCredential.identityToken) {
    throw new Error(
      "Apple did not return a valid identity token. Please try again.",
    );
  }

  return dependencies.redeemFirebase({
    identityToken: appleCredential.identityToken,
    rawNonce,
  });
}
