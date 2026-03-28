import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
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
  } catch {
    return null;
  }
}
