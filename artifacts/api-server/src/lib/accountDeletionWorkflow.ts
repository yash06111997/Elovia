export type AccountDeletionWorkflowOutcome =
  | { status: "finalized" }
  | { status: "identity_pending"; error: unknown };

/**
 * The DB boundary runs first. Once it returns, user data is gone and the
 * durable tombstone makes identity deletion safely retryable/idempotent.
 */
export async function runAccountDeletionWorkflow(options: {
  tombstoneAndDeleteData(): Promise<void>;
  deleteIdentity(): Promise<void>;
  markFinalized(): Promise<boolean>;
}): Promise<AccountDeletionWorkflowOutcome> {
  await options.tombstoneAndDeleteData();
  try {
    await options.deleteIdentity();
    if (!(await options.markFinalized())) {
      return {
        status: "identity_pending",
        error: new Error("Account deletion tombstone could not be finalized."),
      };
    }
    return { status: "finalized" };
  } catch (error) {
    return { status: "identity_pending", error };
  }
}
