import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  resolvePnpmInvocation,
  runWithMetroCleanup,
  stopChildProcessTree,
} = require("../../artifacts/mobile/scripts/build.js");

test("mobile build reuses the active pnpm CLI through the current Node runtime", () => {
  assert.deepEqual(
    resolvePnpmInvocation(
      { npm_execpath: "C:\\tools\\pnpm.cjs" },
      "win32",
      "C:\\node\\node.exe",
    ),
    {
      command: "C:\\node\\node.exe",
      prefixArgs: ["C:\\tools\\pnpm.cjs"],
    },
  );
});

test("mobile build has shell-safe platform fallbacks when npm_execpath is absent", () => {
  assert.deepEqual(
    resolvePnpmInvocation(
      { ComSpec: "C:\\Windows\\cmd.exe" },
      "win32",
      "node.exe",
    ),
    {
      command: "C:\\Windows\\cmd.exe",
      prefixArgs: ["/d", "/s", "/c", "pnpm.cmd"],
    },
  );
  assert.deepEqual(resolvePnpmInvocation({}, "linux", "/usr/bin/node"), {
    command: "pnpm",
    prefixArgs: [],
  });
});

test("mobile build terminates the complete Metro process tree on Windows", () => {
  const invocations = [];
  stopChildProcessTree({ pid: 4321 }, "win32", (...args) => {
    invocations.push(args);
  });

  assert.deepEqual(invocations, [
    [
      "taskkill.exe",
      ["/pid", "4321", "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    ],
  ]);
});

test("mobile build awaits Metro cleanup when its operation times out", async () => {
  const events = [];
  await assert.rejects(
    runWithMetroCleanup(
      async () => {
        events.push("operation");
        throw new Error("Metro timeout");
      },
      async () => {
        await Promise.resolve();
        events.push("cleanup");
      },
    ),
    /Metro timeout/,
  );
  assert.deepEqual(events, ["operation", "cleanup"]);
});
