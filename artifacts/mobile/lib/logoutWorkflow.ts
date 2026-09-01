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
  beforeSignOut?(): Promise<void>;
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

  try {
    await options.beforeSignOut?.();
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
    return {
      status: "blocked",
      operation: options.operation,
      reason: "firebase_sign_out_failed",
      message:
        "Elovia completed privacy cleanup but could not finish signing out. Please try again.",
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
