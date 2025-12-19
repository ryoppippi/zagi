import { describe, bench, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { resolve } from "path";
import { getFixturePath } from "../fixtures/setup";

const ZAGI_BIN = resolve(__dirname, "../../zig-out/bin/zagi");
const REPO_DIR = getFixturePath();

describe("git add benchmarks", () => {
  beforeEach(() => {
    try {
      execFileSync("git", ["reset", "HEAD", "."], { cwd: REPO_DIR });
    } catch {}
  });

  bench("zagi add (single file)", () => {
    execFileSync(ZAGI_BIN, ["add", "src/new-file.ts"], { cwd: REPO_DIR });
  });

  bench("git add (single file)", () => {
    execFileSync("git", ["add", "src/new-file.ts"], { cwd: REPO_DIR });
  });

  bench("zagi add . (all)", () => {
    execFileSync(ZAGI_BIN, ["add", "."], { cwd: REPO_DIR });
  });

  bench("git add . (all)", () => {
    execFileSync("git", ["add", "."], { cwd: REPO_DIR });
  });
});
