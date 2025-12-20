import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { resolve } from "path";
import { writeFileSync, rmSync } from "fs";
import { createFixtureRepo } from "../fixtures/setup";

const ZAGI_BIN = resolve(__dirname, "../../zig-out/bin/zagi");
let REPO_DIR: string;

interface CommandResult {
  output: string;
  exitCode: number;
}

function runCommand(
  cmd: string,
  args: string[],
  expectFail = false
): CommandResult {
  try {
    const output = execFileSync(cmd, args, {
      cwd: REPO_DIR,
      encoding: "utf-8",
    });
    return { output, exitCode: 0 };
  } catch (e: any) {
    if (!expectFail) throw e;
    return {
      output: e.stderr || e.stdout || "",
      exitCode: e.status || 1,
    };
  }
}

function stageTestFile() {
  const testFile = resolve(REPO_DIR, "commit-test.txt");
  writeFileSync(testFile, `test content ${Date.now()}\n`);
  execFileSync("git", ["add", "commit-test.txt"], { cwd: REPO_DIR });
}

beforeEach(() => {
  REPO_DIR = createFixtureRepo();
});

afterEach(() => {
  if (REPO_DIR) {
    rmSync(REPO_DIR, { recursive: true, force: true });
  }
});

describe("zagi commit", () => {
  test("commits staged changes with message", () => {
    stageTestFile();
    const result = runCommand(ZAGI_BIN, ["commit", "-m", "Test commit"]);

    expect(result.output).toContain("committed:");
    expect(result.output).toContain("Test commit");
    expect(result.output).toMatch(/[0-9a-f]{7}/);
    expect(result.exitCode).toBe(0);
  });

  test("shows file count and stats", () => {
    stageTestFile();
    const result = runCommand(ZAGI_BIN, ["commit", "-m", "Test with stats"]);

    expect(result.output).toMatch(/\d+ file/);
    expect(result.output).toMatch(/\+\d+/);
    expect(result.output).toMatch(/-\d+/);
  });

  test("error when nothing staged", () => {
    const result = runCommand(ZAGI_BIN, ["commit", "-m", "Empty commit"], true);

    expect(result.output).toBe("error: nothing to commit\n");
    expect(result.exitCode).toBe(1);
  });

  test("shows usage when no message provided", () => {
    stageTestFile();
    const result = runCommand(ZAGI_BIN, ["commit"], true);

    expect(result.output).toContain("usage:");
    expect(result.output).toContain("-m");
    expect(result.exitCode).toBe(1);
  });

  test("supports -m flag with equals sign", () => {
    stageTestFile();
    const result = runCommand(ZAGI_BIN, ["commit", "--message=Equals format"]);

    expect(result.output).toContain("Equals format");
    expect(result.exitCode).toBe(0);
  });
});

describe("zagi commit --prompt", () => {
  test("stores prompt and shows confirmation", () => {
    stageTestFile();
    const result = runCommand(ZAGI_BIN, [
      "commit",
      "-m",
      "Add test file",
      "--prompt",
      "Create a test file for testing",
    ]);

    expect(result.output).toContain("committed:");
    expect(result.output).toContain("prompt saved");
    expect(result.exitCode).toBe(0);
  });

  test("--prompt= syntax works", () => {
    stageTestFile();
    const result = runCommand(ZAGI_BIN, [
      "commit",
      "-m",
      "Test equals syntax",
      "--prompt=This is the prompt",
    ]);

    expect(result.output).toContain("prompt saved");
    expect(result.exitCode).toBe(0);
  });

  test("prompt can be viewed with git notes", () => {
    stageTestFile();
    runCommand(ZAGI_BIN, [
      "commit",
      "-m",
      "Commit with prompt",
      "--prompt",
      "My test prompt text",
    ]);

    // Read the note using git notes command
    const noteResult = execFileSync(
      "git",
      ["notes", "--ref=prompts", "show", "HEAD"],
      { cwd: REPO_DIR, encoding: "utf-8" }
    );

    expect(noteResult).toContain("My test prompt text");
  });

  test("prompt shown with --prompts in log", () => {
    stageTestFile();
    runCommand(ZAGI_BIN, [
      "commit",
      "-m",
      "Commit for log test",
      "--prompt",
      "Prompt visible in log",
    ]);

    const logResult = runCommand(ZAGI_BIN, ["log", "-n", "1", "--prompts"]);

    expect(logResult.output).toContain("Commit for log test");
    expect(logResult.output).toContain("prompt: Prompt visible in log");
  });

  test("log without --prompts hides prompt", () => {
    stageTestFile();
    runCommand(ZAGI_BIN, [
      "commit",
      "-m",
      "Hidden prompt commit",
      "--prompt",
      "This should be hidden",
    ]);

    const logResult = runCommand(ZAGI_BIN, ["log", "-n", "1"]);

    expect(logResult.output).toContain("Hidden prompt commit");
    expect(logResult.output).not.toContain("prompt:");
    expect(logResult.output).not.toContain("This should be hidden");
  });
});

describe("ZAGI_AGENT", () => {
  function runWithEnv(
    args: string[],
    env: Record<string, string>,
    expectFail = false
  ): CommandResult {
    try {
      const output = execFileSync(ZAGI_BIN, args, {
        cwd: REPO_DIR,
        encoding: "utf-8",
        env: { ...process.env, ...env },
      });
      return { output, exitCode: 0 };
    } catch (e: any) {
      if (!expectFail) throw e;
      return {
        output: e.stdout || e.stderr || "",
        exitCode: e.status || 1,
      };
    }
  }

  test("ZAGI_AGENT requires --prompt", () => {
    stageTestFile();
    const result = runWithEnv(
      ["commit", "-m", "Agent commit"],
      { ZAGI_AGENT: "claude-code" },
      true
    );

    expect(result.output).toContain("--prompt required");
    expect(result.output).toContain("ZAGI_AGENT");
    expect(result.exitCode).toBe(1);
  });

  test("ZAGI_AGENT succeeds with --prompt", () => {
    stageTestFile();
    const result = runWithEnv(
      ["commit", "-m", "Agent commit", "--prompt", "Agent prompt"],
      { ZAGI_AGENT: "claude-code" }
    );

    expect(result.output).toContain("committed:");
    expect(result.exitCode).toBe(0);
  });
});
