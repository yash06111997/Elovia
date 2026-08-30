import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

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

export async function verifyFirebaseToken(idToken: string): Promise<AuthUser | null> {
  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const displayName = decoded.name || "";
    const nameParts = displayName.split(" ");
    return {
      id: decoded.uid,
      email: decoded.email || null,
      firstName: nameParts[0] || null,
      lastName: nameParts.slice(1).join(" ") || null,
      profileImageUrl: decoded.picture || null,
    };
  } catch (err) {
    console.error("verifyFirebaseToken failed:", err instanceof Error ? err.message : err);
    return null;
  }
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
