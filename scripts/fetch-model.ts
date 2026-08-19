/**
 * `pnpm model:fetch` — download the embedding model so the app works offline.
 *
 * Saving and searching memories both embed text locally, and the model is
 * fetched from the Hugging Face Hub the first time that happens. Left to
 * chance, that first time lands on whoever is offline when they try to save a
 * memory — the worst possible moment, and a confusing failure because nothing
 * else about the app needs the internet.
 *
 * So this makes priming the cache an explicit, one-line step you run once while
 * you have a connection. It is idempotent: on a warm cache it confirms and
 * exits without touching the network.
 */
import "dotenv/config";

import {
  EMBEDDING_MODEL,
  embed,
  isModelCached,
  modelCacheDir,
} from "@/server/embeddings";

async function main(): Promise<void> {
  const dir = modelCacheDir();

  if (isModelCached()) {
    console.log(`\x1b[32m✓\x1b[0m ${EMBEDDING_MODEL} is already cached.`);
    console.log(`\x1b[2m  ${dir}\x1b[0m`);
  } else {
    console.log(`Downloading ${EMBEDDING_MODEL} (~90 MB) into ${dir} ...`);
    console.log("\x1b[2m  This runs once per machine. Needs a connection.\x1b[0m");
  }

  // Run a real embedding either way: it is the only thing that proves the
  // cached files are complete and loadable, rather than a half-finished
  // download left behind by an interrupted run.
  const started = Date.now();
  const vector = await embed("AgentVault offline readiness check.");
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `\x1b[32m✓\x1b[0m Model loaded and produced a ${vector.length}-d vector in ${seconds}s.`,
  );
  console.log("\x1b[2m  Embeddings now work with no internet connection.\x1b[0m");
}

main().catch((err: unknown) => {
  console.error(`\n\x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
