import { describe, bench } from "vitest";
import { execFileSync } from "child_process";
import { resolve } from "path";

const ZAGI_BIN = resolve(__dirname, "../../zig-out/bin/zagi");
const REPO_DIR = resolve(__dirname, "../..");

// Use README.md which always exists and is tracked
const TEST_FILE = "README.md";

function reset() {
  try {
    execFileSync("git", ["reset", "HEAD", TEST_FILE], { cwd: REPO_DIR });
  } catch {}
}

describe("git add benchmarks", () => {
  bench("zagi add (single file)", () => {
    reset();
    execFileSync(ZAGI_BIN, ["add", TEST_FILE], { cwd: REPO_DIR });
  });

  bench("git add (single file)", () => {
    reset();
    execFileSync("git", ["add", TEST_FILE], { cwd: REPO_DIR });
  });
});
