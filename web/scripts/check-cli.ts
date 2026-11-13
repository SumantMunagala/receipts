// Runs the agent pipeline from the command line.
// Usage: pnpm check "<tiktok-url-or-image-path>"
// Stub until Phase 1 Task 12.

const input = process.argv[2];

if (!input) {
  console.error('Usage: pnpm check "<tiktok-url-or-image-path>"');
  process.exit(1);
}

console.log(`input: ${input}`);
console.log("pipeline not built yet (Phase 1 Task 12)");
