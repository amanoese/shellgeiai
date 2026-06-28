const recordVectorCacheByEmbedder = new WeakMap();

function cosineSimilarity(left, right) {
  if (left.length !== right.length) {
    throw new Error("Cannot compare embedding vectors with different dimensions.");
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }

  for (const value of left) {
    leftMagnitude += value * value;
  }

  for (const value of right) {
    rightMagnitude += value * value;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

async function embedRecord({ record, embedder }) {
  if (Array.isArray(record.vector)) {
    return record.vector;
  }
  let recordVectorCache = recordVectorCacheByEmbedder.get(embedder);
  if (!recordVectorCache) {
    recordVectorCache = new Map();
    recordVectorCacheByEmbedder.set(embedder, recordVectorCache);
  }

  const cacheKey = `${record.id}\0${record.text}`;
  if (!recordVectorCache.has(cacheKey)) {
    recordVectorCache.set(cacheKey, await embedder.embed(`検索文書: ${record.text}`));
  }

  return recordVectorCache.get(cacheKey);
}

export async function searchKnowledgeRecords({
  query,
  records,
  embedder,
  topK = 10,
  maxPerCommand = 2
}) {
  const queryVector = await embedder.embed(query);
  if (topK <= 0) {
    return [];
  }

  const scoredRecords = [];

  for (const record of records) {
    const recordVector = await embedRecord({ record, embedder });
    scoredRecords.push({
      ...record,
      score: cosineSimilarity(queryVector, recordVector)
    });
  }

  scoredRecords.sort((left, right) => right.score - left.score);

  const selectedRecords = [];
  const commandCounts = new Map();

  for (const record of scoredRecords) {
    if (selectedRecords.length >= topK) {
      break;
    }

    const commandKey = record.command || record.id;
    const commandCount = commandCounts.get(commandKey) ?? 0;
    if (commandCount >= maxPerCommand) {
      continue;
    }

    selectedRecords.push(record);
    commandCounts.set(commandKey, commandCount + 1);
  }

  return selectedRecords;
}
