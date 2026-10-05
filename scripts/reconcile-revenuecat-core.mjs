export function batchSizeFromArguments(arguments_) {
  const option = arguments_.find((argument) =>
    argument.startsWith("--batch-size="),
  );
  if (!option) return 100;
  const value = Number(option.slice("--batch-size=".length));
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error("--batch-size must be an integer between 1 and 1000");
  }
  return value;
}

export function bootstrapExitCode(remaining) {
  return remaining === 0 ? 0 : 1;
}
