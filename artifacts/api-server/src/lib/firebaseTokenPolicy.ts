export interface DecodedFirebaseIdentity {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface FirebaseTokenVerifier {
  verifyIdToken(
    idToken: string,
    checkRevoked?: boolean,
  ): Promise<DecodedFirebaseIdentity>;
}

export interface VerifiedFirebaseToken {
  identity: DecodedFirebaseIdentity;
  deletionFallback: boolean;
}

function firebaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

/**
 * Normal authentication always checks revocation and identity existence.
 * The narrow deletion retry fallback verifies the same signed, unexpired token
 * without the user lookup only after Firebase reports that the identity was
 * already deleted/revoked; the caller must still require an existing DB
 * tombstone and must never use this result for any other route.
 */
export async function verifyFirebaseTokenWithPolicy(
  verifier: FirebaseTokenVerifier,
  idToken: string,
  allowDeletedIdentityForDeletion: boolean,
): Promise<VerifiedFirebaseToken> {
  try {
    return {
      identity: await verifier.verifyIdToken(idToken, true),
      deletionFallback: false,
    };
  } catch (error) {
    const canRetryDeletion =
      allowDeletedIdentityForDeletion &&
      ["auth/user-not-found", "auth/id-token-revoked"].includes(
        firebaseErrorCode(error) ?? "",
      );
    if (!canRetryDeletion) throw error;
    return {
      identity: await verifier.verifyIdToken(idToken, false),
      deletionFallback: true,
    };
  }
}

export function firebaseAuthErrorType(error: unknown): string {
  return (
    firebaseErrorCode(error) ??
    (error instanceof Error ? error.name : "UnknownError")
  );
}
