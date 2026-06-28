import {
  buildKnowledgeVectors,
  prepareKnowledgeModel,
  searchKnowledge
} from "../../knowledge/commands.js";

export async function runKnowledgePrepareCommand(options) {
  const result = await prepareKnowledgeModel({ model: options.model });
  process.stdout.write(`Knowledge model prepared: ${result.model}\n`);
}

export async function runKnowledgeBuildCommand(options) {
  const result = await buildKnowledgeVectors({
    datasetPath: options.datasetPath,
    model: options.model,
    vectorsPath: options.vectorsPath
  });
  process.stdout.write(
    `Knowledge vectors built: ${result.itemCount} items -> ${result.vectorsPath}\n`
  );
}

function formatKnowledgeSearchResult(record, index) {
  const lines = [
    `${index + 1}. ${record.id} score=${record.score.toFixed(4)}`,
    `   kind: ${record.kind}`
  ];
  if (record.command) lines.push(`   command: ${record.command}`);
  if (record.option) lines.push(`   option: ${record.option}`);
  lines.push(`   text: ${record.text}`);
  if (record.source) lines.push(`   source: ${record.source}`);
  return lines.join("\n");
}

export async function runKnowledgeSearchCommand(options) {
  const result = await searchKnowledge({
    query: options.query,
    datasetPath: options.datasetPath,
    model: options.model,
    topK: options.topK,
    vectorsPath: options.vectorsPath
  });

  const lines = [
    `Knowledge search: ${result.query}`,
    `model: ${result.model}`,
    ...result.results.map(formatKnowledgeSearchResult)
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
