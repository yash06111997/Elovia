import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { firebaseAuthErrorType, verifyFirebaseTokenWithPolicy } from "./firebaseTokenPolicy";

if (getApps().length === 0) {
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      initializeApp({ credential: cert(serviceAccount), projectId });
    } catch {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY, falling back to applicationDefault");
      initializeApp({ credential: applicationDefault(), projectId });
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault(), projectId });
  } else {
    console.warn(
      "Firebase Admin: No service account credentials found. " +
        "Set FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) or GOOGLE_APPLICATION_CREDENTIALS " +
        "(path to service account file) for token verification to work. " +
        "Falling back to project-only initialization.",
    );
    initializeApp({ projectId });
  }
}

const firebaseAuth = getAuth();

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

function decodedIdentityToUser(decoded: {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}): AuthUser {
  const displayName = decoded.name || "";
  const nameParts = displayName.split(" ");
  return {
    id: decoded.uid,
    email: decoded.email || null,
    firstName: nameParts[0] || null,
    lastName: nameParts.slice(1).join(" ") || null,
    profileImageUrl: decoded.picture || null,
  };
}

async function verifyFirebaseTokenForPolicy(
  idToken: string,
  allowDeletedIdentityForDeletion: boolean,
): Promise<{ user: AuthUser; deletionFallback: boolean } | null> {
  try {
    const decoded = await verifyFirebaseTokenWithPolicy(firebaseAuth, idToken, allowDeletedIdentityForDeletion);
    return {
      user: decodedIdentityToUser(decoded.identity),
      deletionFallback: decoded.deletionFallback,
    };
  } catch (err) {
    console.error("Firebase token verification failed", { errorType: firebaseAuthErrorType(err) });
    return null;
  }
}

export function verifyFirebaseToken(idToken: string): Promise<AuthUser | null> {
  return verifyFirebaseTokenForPolicy(idToken, false).then((verified) => verified?.user ?? null);
}

/** Only the idempotent DELETE /api/account retry path may call this. */
export function verifyFirebaseDeletionToken(idToken: string): Promise<{
  user: AuthUser;
  deletionFallback: boolean;
} | null> {
  return verifyFirebaseTokenForPolicy(idToken, true);
}

/** Permanently remove the identity after the app database has been erased. */
export async function deleteFirebaseUser(userId: string): Promise<void> {
  try {
    await firebaseAuth.deleteUser(userId);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "auth/user-not-found"
    ) {
      return;
    }
    throw error;
  }
}
