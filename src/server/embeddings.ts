import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  env as transformersEnv,
  pipeline,
  type FeatureExtractionPipeline,
} from "@xenova/transformers";

// Optional override for the model host. Production uses the default Hugging Face
// Hub; set HF_ENDPOINT (e.g. a mirror like https://hf-mirror.com) on networks
// that can't reach huggingface.co directly.
const HF_ENDPOINT = process.env.HF_ENDPOINT?.trim();
if (HF_ENDPOINT) {
  transformersEnv.remoteHost = HF_ENDPOINT;
}

/**
 * Where the ~90 MB model file lives between runs.
 *
 * transformers.js defaults this to a `.cache` directory *inside* `node_modules`,
 * which quietly makes offline support a lie: `pnpm install`, a lockfile change,
 * or a dependency bump relocates or deletes that directory, and the next save
 * with no connection fails because the model has to be re-downloaded. Pinning
 * the cache outside `node_modules` means the model is fetched once per machine
 * and survives everything the package manager does.
 *
 * Override with AMC_MODEL_CACHE_DIR to share one copy between checkouts, or to
 * bake the model into a container image at a known path.
 *
 * On a serverless host the working directory is read-only, so the repo-root
 * default cannot be created at all and every embed would fail on a directory
 * error rather than anything to do with embedding. There, the temp directory is
 * the only writable place — slower (each cold container re-downloads the model)
 * but working, and `AMC_MODEL_CACHE_DIR` still wins when there is somewhere
 * better to put it.
 */
function resolveModelCacheDir(): string {
  const override = process.env.AMC_MODEL_CACHE_DIR?.trim();
  if (override) return override;

  const preferred = path.join(process.cwd(), ".model-cache");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    return path.join(os.tmpdir(), "agentvault-model-cache");
  }
}

const MODEL_CACHE_DIR = resolveModelCacheDir();

// Captured before the override so an existing download can be reused rather
// than re-fetched — see `seedCacheFromNodeModules`.
const NODE_MODULES_CACHE_DIR = transformersEnv.cacheDir;

transformersEnv.cacheDir = MODEL_CACHE_DIR;

/** Path a given model occupies inside a cache directory. */
function modelPathIn(cacheDir: string): string {
  return path.join(cacheDir, ...EMBEDDING_MODEL.split("/"));
}

/**
 * One-time migration for installs that already downloaded the model into
 * `node_modules` under the old default. Copying is far cheaper than a 90 MB
 * re-download and, critically, it works with no connection — which is exactly
 * the situation this whole change exists to survive.
 */
function seedCacheFromNodeModules(): void {
  try {
    if (fs.existsSync(modelPathIn(MODEL_CACHE_DIR))) return;
    if (!NODE_MODULES_CACHE_DIR) return;

    const legacy = modelPathIn(NODE_MODULES_CACHE_DIR);
    if (!fs.existsSync(legacy)) return;

    fs.mkdirSync(path.dirname(modelPathIn(MODEL_CACHE_DIR)), { recursive: true });
    fs.cpSync(legacy, modelPathIn(MODEL_CACHE_DIR), { recursive: true });
  } catch {
    // A failed copy just means the model gets downloaded again when online.
    // Never let a cache optimisation break embedding.
  }
}

/** True when the model is already on disk, so `embed()` needs no network. */
export function isModelCached(): boolean {
  try {
    return fs.existsSync(modelPathIn(MODEL_CACHE_DIR));
  } catch {
    return false;
  }
}

/** Where the model is cached. Surfaced by `pnpm verify` and `pnpm model:fetch`. */
export function modelCacheDir(): string {
  return MODEL_CACHE_DIR;
}

/**
 * Local text embeddings via transformers.js.
 *
 * We run the `Xenova/all-MiniLM-L6-v2` sentence-transformer entirely in-process
 * (ONNX runtime, no network at inference time) and mean-pool + L2-normalise the
 * token embeddings to a single 384-dim unit vector. Normalised vectors make
 * cosine distance in pgvector (`<=>`) equivalent to a dot product, and let us
 * report a clean 0..1 similarity as `1 - distance`.
 *
 * The model (~90 MB) is downloaded from the Hugging Face Hub on first use and
 * cached on disk by transformers.js; subsequent runs are offline. Loading is
 * lazy and memoised (including across Next.js hot reloads via a global) so the
 * model is materialised exactly once per process, never per call.
 */

/** Name of the sentence-transformer model. */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Dimensionality of the produced vectors — must match `vector(384)` in SQL. */
export const EMBEDDING_DIM = 384;

const globalForEmbeddings = globalThis as unknown as {
  __amcExtractor?: Promise<FeatureExtractionPipeline>;
};

/**
 * Lazily load (once) and return the feature-extraction pipeline. The promise
 * itself is cached so concurrent first-callers all await the same download
 * instead of kicking off several.
 */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  globalForEmbeddings.__amcExtractor ??= (async () => {
    seedCacheFromNodeModules();
    const cold = !isModelCached();

    try {
      return await pipeline("feature-extraction", EMBEDDING_MODEL);
    } catch (err) {
      // A cold cache plus no network is the one failure a user can actually
      // act on, and transformers.js reports it as a bare fetch error that says
      // nothing about what to do. Name the cause and the fix.
      globalForEmbeddings.__amcExtractor = undefined;
      if (cold) {
        throw new Error(
          `Could not load the embedding model "${EMBEDDING_MODEL}". It is not cached ` +
            `at ${MODEL_CACHE_DIR} and could not be downloaded — this usually means no ` +
            `internet connection. Run "pnpm model:fetch" once while online; after that, ` +
            `saving and searching memories works offline. ` +
            `(Underlying error: ${err instanceof Error ? err.message : String(err)})`,
          { cause: err },
        );
      }
      throw err;
    }
  })();
  return globalForEmbeddings.__amcExtractor;
}

/**
 * Warm the model up ahead of time (e.g. at server start) so the first real
 * request doesn't pay the load/download cost. Safe to call repeatedly.
 */
export async function warmupEmbeddings(): Promise<void> {
  await getExtractor();
}

/**
 * Embed a piece of text into a 384-dim, L2-normalised vector.
 *
 * @throws if `text` is empty or the model returns an unexpected dimensionality.
 */
export async function embed(text: string): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    throw new Error("Cannot embed empty text.");
  }

  const extractor = await getExtractor();
  const output = (await extractor(input, {
    pooling: "mean",
    normalize: true,
  })) as { data: Float32Array };

  const vector = Array.from(output.data, (n) => Number(n));
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding model returned ${vector.length} dimensions, expected ${EMBEDDING_DIM}.`
    );
  }
  return vector;
}

/**
 * Serialise a vector into the textual form pgvector accepts, e.g. `[0.1,0.2]`.
 * Used with a `::vector` cast in raw SQL. Kept next to `embed` so the
 * embedding representation stays in one place.
 */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
