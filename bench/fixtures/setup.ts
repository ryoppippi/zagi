import { execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";

const FIXTURE_DIR = resolve(__dirname, "test-repo");
const COMMIT_COUNT = 100;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: FIXTURE_DIR, stdio: "pipe" });
}

export function setupFixtureRepo() {
  // Clean up if exists
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true });
  }

  // Create directory
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // Initialize git repo
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test User");

  // Create initial structure
  mkdirSync(resolve(FIXTURE_DIR, "src"));
  mkdirSync(resolve(FIXTURE_DIR, "tests"));
  mkdirSync(resolve(FIXTURE_DIR, "docs"));

  writeFileSync(
    resolve(FIXTURE_DIR, "README.md"),
    "# Test Repository\n\nThis is a fixture for benchmarking.\n"
  );

  writeFileSync(
    resolve(FIXTURE_DIR, "src/main.ts"),
    'export function main() {\n  console.log("hello");\n}\n'
  );

  writeFileSync(
    resolve(FIXTURE_DIR, "src/utils.ts"),
    "export function add(a: number, b: number) {\n  return a + b;\n}\n"
  );

  writeFileSync(
    resolve(FIXTURE_DIR, "tests/main.test.ts"),
    'import { main } from "../src/main";\n\ntest("main runs", () => {\n  main();\n});\n'
  );

  // Initial commit
  git("add", ".");
  git("commit", "-m", "Initial commit");

  // Generate commits with varied content
  const actions = [
    "Add",
    "Update",
    "Fix",
    "Refactor",
    "Improve",
    "Implement",
    "Remove",
    "Clean up",
  ];
  const subjects = [
    "user authentication",
    "database connection",
    "API endpoints",
    "error handling",
    "logging system",
    "caching layer",
    "input validation",
    "unit tests",
    "documentation",
    "configuration",
  ];

  for (let i = 1; i < COMMIT_COUNT; i++) {
    const action = actions[i % actions.length];
    const subject = subjects[i % subjects.length];
    const message = `${action} ${subject}`;

    // Modify a file
    const fileNum = i % 3;
    const files = ["src/main.ts", "src/utils.ts", "README.md"];
    const filePath = resolve(FIXTURE_DIR, files[fileNum]);

    const content =
      existsSync(filePath) && fileNum !== 2
        ? `// Change ${i}\n` +
          readFileSync(filePath, "utf-8") +
          `\n// End change ${i}\n`
        : `# Test Repository\n\nChange ${i}\n`;

    writeFileSync(filePath, content);
    git("add", ".");
    git("commit", "-m", message);
  }

  // Create some uncommitted changes for status tests
  writeFileSync(resolve(FIXTURE_DIR, "src/new-file.ts"), "// New file\n");
  writeFileSync(
    resolve(FIXTURE_DIR, "src/main.ts"),
    readFileSync(resolve(FIXTURE_DIR, "src/main.ts"), "utf-8") + "\n// Modified\n"
  );

  console.log(`Created fixture repo with ${COMMIT_COUNT} commits`);
  console.log(`Location: ${FIXTURE_DIR}`);
}

export function getFixturePath() {
  return FIXTURE_DIR;
}

export function ensureFixture() {
  if (!existsSync(resolve(FIXTURE_DIR, ".git"))) {
    setupFixtureRepo();
  }
  return FIXTURE_DIR;
}

// Vitest global setup hook
export default function setup() {
  ensureFixture();
}

// Run setup if called directly
if (require.main === module) {
  setupFixtureRepo();
}
