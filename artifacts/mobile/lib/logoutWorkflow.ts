export type LogoutOperation = "sign_out" | "account_deletion";

export type LogoutBlockReason =
  | "authentication_required"
  | "push_cleanup"
  | "native_cleanup"
  | "push_and_native_cleanup"
  | "preparation_failed"
  | "account_deletion_failed"
  | "firebase_sign_out_failed";

export type LogoutOutcome =
  | { status: "signed_out"; operation: LogoutOperation }
  | { status: "already_signed_out"; operation: "sign_out" }
  | {
      status: "finalizing";
      operation: "account_deletion";
      reason:
        | "remote_delete_ambiguous"
        | "firebase_sign_out_failed"
        | "local_clear_failed";
      localSignOutComplete: boolean;
      message: string;
    }
  | {
      status: "blocked";
      operation: LogoutOperation;
      reason: LogoutBlockReason;
      message: string;
    };

export interface LogoutPreparation {
  pushDetached: boolean;
  nativeDetached: boolean;
  blockedMessage?: string;
}

export type BeforeSignOutOutcome =
  | { status: "confirmed" }
  | { status: "finalizing"; message: string };

function cleanupBlockReason(preparation: LogoutPreparation): LogoutBlockReason {
  if (!preparation.pushDetached && !preparation.nativeDetached) {
    return "push_and_native_cleanup";
  }
  return preparation.pushDetached ? "native_cleanup" : "push_cleanup";
}

/**
 * Complete cleanup, an optional authenticated account operation, and Firebase
 * sign-out in that order. The destructive account operation is never invoked
 * unless native privacy cleanup has already been verified.
 */
export async function runLogoutWorkflow(options: {
  operation: LogoutOperation;
  isAuthenticated: boolean;
  prepare(): Promise<LogoutPreparation>;
  beforeSignOut?(): Promise<void | BeforeSignOutOutcome>;
  signOut(): Promise<void>;
  onError?(
    error: unknown,
    phase: "prepare" | "before_sign_out" | "sign_out",
  ): void;
}): Promise<LogoutOutcome> {
  if (!options.isAuthenticated) {
    if (options.operation === "sign_out") {
      return { status: "already_signed_out", operation: "sign_out" };
    }
    return {
      status: "blocked",
      operation: options.operation,
      reason: "authentication_required",
      message: "Please sign in again before deleting your account.",
    };
  }
  if (
    options.operation === "account_deletion" &&
    typeof options.beforeSignOut !== "function"
  ) {
    return {
      status: "blocked",
      operation: options.operation,
      reason: "account_deletion_failed",
      message: "Account deletion could not start. Please try again.",
    };
  }

  let preparation: LogoutPreparation;
  try {
    preparation = await options.prepare();
  } catch (error) {
    options.onError?.(error, "prepare");
    return {
      status: "blocked",
      operation: options.operation,
      reason: "preparation_failed",
      message:
        "Elovia could not verify local privacy cleanup. You are still signed in; try again.",
    };
  }

  if (!preparation.pushDetached || !preparation.nativeDetached) {
    return {
      status: "blocked",
      operation: options.operation,
      reason: cleanupBlockReason(preparation),
      message:
        preparation.blockedMessage ??
        "Elovia could not verify local privacy cleanup. You are still signed in; try again.",
    };
  }

  let deletionFinalizingMessage: string | null = null;
  try {
    const beforeSignOut = await options.beforeSignOut?.();
    if (beforeSignOut?.status === "finalizing") {
      deletionFinalizingMessage = beforeSignOut.message;
    }
  } catch (error) {
    options.onError?.(error, "before_sign_out");
    return {
      status: "blocked",
      operation: options.operation,
      reason: "account_deletion_failed",
      message:
        "Your account could not be deleted. You are still signed in; please try again.",
    };
  }

  try {
    await options.signOut();
  } catch (error) {
    options.onError?.(error, "sign_out");
    if (options.operation === "account_deletion") {
      return {
        status: "finalizing",
        operation: "account_deletion",
        reason: "firebase_sign_out_failed",
        localSignOutComplete: false,
        message:
          "Account deletion is finalizing, but Elovia could not finish signing out on this device. Reopen the app to retry safely.",
      };
    }
    return {
      status: "blocked",
      operation: options.operation,
      reason: "firebase_sign_out_failed",
      message:
        "Elovia completed privacy cleanup but could not finish signing out. Please try again.",
    };
  }

  if (options.operation === "account_deletion" && deletionFinalizingMessage) {
    return {
      status: "finalizing",
      operation: "account_deletion",
      reason: "remote_delete_ambiguous",
      localSignOutComplete: true,
      message: deletionFinalizingMessage,
    };
  }

  return { status: "signed_out", operation: options.operation };
}

/** One provider instance owns one flight; every overlapping caller shares it. */
export class LogoutSingleFlight {
  private active: Promise<LogoutOutcome> | null = null;

  run(operation: () => Promise<LogoutOutcome>): Promise<LogoutOutcome> {
    if (this.active) return this.active;
    const active = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.active === active) this.active = null;
      });
    this.active = active;
    return active;
  }
}
