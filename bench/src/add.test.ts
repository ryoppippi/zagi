import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { resolve } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";

const ZAGI_BIN = resolve(__dirname, "../../zig-out/bin/zagi");
const REPO_DIR = resolve(__dirname, "../..");
const TEST_FILE = resolve(REPO_DIR, "test-add-temp.txt");

interface CommandResult {
  output: string;
  duration: number;
  exitCode: number;
}

function runCommand(
  cmd: string,
  args: string[],
  expectFail = false
): CommandResult {
  const start = performance.now();
  try {
    const output = execFileSync(cmd, args, {
      cwd: REPO_DIR,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      output,
      duration: performance.now() - start,
      exitCode: 0,
    };
  } catch (e: any) {
    if (!expectFail) throw e;
    return {
      output: e.stderr || e.stdout || "",
      duration: performance.now() - start,
      exitCode: e.status || 1,
    };
  }
}

describe("zagi add", () => {
  beforeEach(() => {
    // Create a test file
    writeFileSync(TEST_FILE, "test content\n");
  });

  afterEach(() => {
    // Clean up test file and unstage
    if (existsSync(TEST_FILE)) {
      try {
        execFileSync("git", ["reset", "HEAD", TEST_FILE], { cwd: REPO_DIR });
      } catch {}
      unlinkSync(TEST_FILE);
    }
  });

  test("shows confirmation after adding file", () => {
    const result = runCommand(ZAGI_BIN, ["add", "test-add-temp.txt"]);

    expect(result.output).toContain("staged:");
    expect(result.output).toContain("A ");
    expect(result.output).toContain("test-add-temp.txt");
  });

  test("shows count of staged files", () => {
    const result = runCommand(ZAGI_BIN, ["add", "test-add-temp.txt"]);

    expect(result.output).toMatch(/staged: \d+ file/);
  });

  test("error message is concise for missing file", () => {
    const zagi = runCommand(ZAGI_BIN, ["add", "nonexistent.txt"], true);

    expect(zagi.output).toBe("error: file not found\n");
    expect(zagi.exitCode).toBe(128);
  });

  test("git add is silent on success", () => {
    const git = runCommand("git", ["add", "test-add-temp.txt"]);

    // git add produces no output on success
    expect(git.output).toBe("");
  });

  test("zagi add provides feedback while git add is silent", () => {
    // Reset first
    execFileSync("git", ["reset", "HEAD", "."], { cwd: REPO_DIR });

    const zagi = runCommand(ZAGI_BIN, ["add", "test-add-temp.txt"]);
    execFileSync("git", ["reset", "HEAD", "test-add-temp.txt"], {
      cwd: REPO_DIR,
    });
    const git = runCommand("git", ["add", "test-add-temp.txt"]);

    expect(zagi.output.length).toBeGreaterThan(0);
    expect(git.output.length).toBe(0);
  });
});

describe("performance", () => {
  beforeEach(() => {
    writeFileSync(TEST_FILE, "test content\n");
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) {
      try {
        execFileSync("git", ["reset", "HEAD", TEST_FILE], { cwd: REPO_DIR });
      } catch {}
      unlinkSync(TEST_FILE);
    }
  });

  test("zagi add is reasonably fast", () => {
    const iterations = 10;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      execFileSync("git", ["reset", "HEAD", "."], { cwd: REPO_DIR });
      const result = runCommand(ZAGI_BIN, ["add", "test-add-temp.txt"]);
      times.push(result.duration);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`\nPerformance (${iterations} iterations):`);
    console.log(`  Average: ${avg.toFixed(2)}ms`);
    console.log(`  Min: ${min.toFixed(2)}ms`);
    console.log(`  Max: ${max.toFixed(2)}ms`);

    // Should complete in under 100ms on average
    expect(avg).toBeLessThan(100);
  });
});
