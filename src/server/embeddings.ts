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
  globalForEmbeddings.__amcExtractor ??= pipeline(
    "feature-extraction",
    EMBEDDING_MODEL
  );
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
