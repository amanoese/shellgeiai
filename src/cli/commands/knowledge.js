import { buildKnowledgeVectors, prepareKnowledgeModel } from "../../knowledge/commands.js";

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
