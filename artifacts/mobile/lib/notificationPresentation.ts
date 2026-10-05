import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirebaseAuth } from "./firebase";
import {
  PushCleanupStore,
  shouldPresentEloviaNotification,
} from "./pushCleanup";
import { isPushPresentationBlocked } from "./push";
import { notificationOwnerMarker } from "./notificationOwner";

const cleanupState = new PushCleanupStore(AsyncStorage);

export async function shouldPresentNotification(
  data: Record<string, unknown>,
): Promise<boolean> {
  let currentUserId: string | null = null;
  try {
    currentUserId = (await getFirebaseAuth()).currentUser?.uid ?? null;
  } catch {
    currentUserId = null;
  }
  return shouldPresentEloviaNotification(
    data,
    currentUserId,
    await cleanupState.read(),
    currentUserId ? isPushPresentationBlocked(currentUserId) : false,
    await notificationOwnerMarker(currentUserId),
  );
}
