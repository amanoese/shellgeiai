export function meanPool(tokenEmbeddings) {
  if (!Array.isArray(tokenEmbeddings) || tokenEmbeddings.length === 0) return [];
  const dimension = tokenEmbeddings[0].length;
  const sums = Array.from({ length: dimension }, () => 0);
  for (const token of tokenEmbeddings) {
    for (let index = 0; index < dimension; index += 1) {
      sums[index] += token[index];
    }
  }
  return sums.map((sum) => sum / tokenEmbeddings.length);
}

export function createRuriEmbedder({ pipeline, model = "Xenova/multilingual-e5-small" } = {}) {
  let pipePromise = null;

  async function getPipeline() {
    if (!pipePromise) {
      pipePromise = (async () => {
        const loadedPipeline = pipeline ?? (await import("@huggingface/transformers")).pipeline;
        return loadedPipeline("feature-extraction", model);
      })();
    }
    return pipePromise;
  }

  return {
    async embed(text) {
      const pipe = await getPipeline();
      const output = await pipe(text);
      const values = typeof output.tolist === "function" ? output.tolist() : output;
      return meanPool(values[0] ?? values);
    }
  };
}
