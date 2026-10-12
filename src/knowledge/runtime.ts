import type { KnowledgeRuntime, KnowledgeRuntimeOptions, KnowledgeStore, KnowledgeSearchInput, KnowledgeHit, KnowledgeEmbedder, KnowledgeRetriever, ToolRegistration } from "../types.js";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { loadKnowledgeDatasetWithFingerprint } from "./dataset.js";
import { DEFAULT_KNOWLEDGE_MODEL, DEFAULT_KNOWLEDGE_DATASET, resolveKnowledgeDbPath, EMBEDDING_INPUT_PROFILE, formatKnowledgeRecords, formatEmbeddingQuery } from "./config.js";
import { createOpenRouterEmbedder } from "../providers/embedder.js";
import { awaitWithSignal } from "../shared.js";
import { z } from "zod";

function shellQuote(value: unknown) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function assertKnowledgeModel(model: unknown): asserts model is string {
    if (typeof model !== "string" || !model.trim())
        throw new Error("Embedding model must be a nonempty string.");
}

async function unusedRebuildPath(dbPath: string) {
    for (let sequence = 1;; sequence++) {
        const candidate = `${dbPath}.rebuilt${sequence === 1 ? "" : `-${sequence}`}.sqlite`;
        try {
            await lstat(candidate);
        }
        catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
                return candidate;
            throw error;
        }
    }
}

async function recoveryHint(recovery: unknown, { datasetPath, dbPath, model }: { datasetPath: string; dbPath: string; model: string }) {
    const fresh = recovery === "fresh";
    const target = fresh ? await unusedRebuildPath(dbPath) : dbPath;
    const force = recovery === "force" ? " --force" : "";
    const identityOptions = `--dataset ${shellQuote(datasetPath)} --model ${shellQuote(model)}`;
    const rebuild = `Rebuild with: shellgeiai knowledge build --dataset ${shellQuote(datasetPath)} --db ${shellQuote(target)} --model ${shellQuote(model)}${force}`;
    if (!fresh)
        return rebuild;
    return `${rebuild}\nKeep the old database. Configure subsequent commands to use the rebuilt database:\n` +
        `shellgeiai knowledge search --db ${shellQuote(target)} ${identityOptions} 'your query'\n` +
        `shellgeiai solve --knowledge-db ${shellQuote(target)} --knowledge-dataset ${shellQuote(datasetPath)} --knowledge-model ${shellQuote(model)} --knowledge planner 'your problem'`;
}

/** Owns one read-only connection and pins its active generation for the entire solve. */
export async function createKnowledgeRuntime({ datasetPath = DEFAULT_KNOWLEDGE_DATASET, dbPath, model = DEFAULT_KNOWLEDGE_MODEL, embedder, embedderFactory = createOpenRouterEmbedder, signal }: Partial<KnowledgeRuntimeOptions> = {}): Promise<KnowledgeRuntime & { search: (input: KnowledgeSearchInput) => Promise<KnowledgeHit[]> }> {
    assertKnowledgeModel(model);
    datasetPath = path.resolve(datasetPath);
    dbPath = path.resolve(resolveKnowledgeDbPath({ dbPath, datasetPath, model }));
    signal?.throwIfAborted();
    let store: KnowledgeStore | undefined;
    try {
        const { fingerprint: datasetFingerprint } = await loadKnowledgeDatasetWithFingerprint(datasetPath);
        const { openKnowledgeStore } = await import("./store.js");
        store = openKnowledgeStore({ dbPath, readonly: true });
        const active = store.assertCompatible({ datasetPath, datasetFingerprint, model, inputProfile: EMBEDDING_INPUT_PROFILE });
        signal?.throwIfAborted();
        const retriever = createKnowledgeRetriever({ store, generationId: active.generationId,
            embedder: embedder ?? embedderFactory({ model }), signal });
        const activeStore = store;
        let disposed = false;
        return {
            retriever,
            search: retriever.searchRecords,
            snapshot: { provider: "openrouter", model, inputProfile: EMBEDDING_INPUT_PROFILE, dbPath,
                dimensions: active.dimensions, generationId: active.generationId, datasetFingerprint },
            async dispose() {
                if (!disposed) {
                    disposed = true;
                    activeStore.close();
                }
            }
        };
    }
    catch (cause) {
        store?.close();
        if (signal?.aborted)
            throw cause;
        if (!cause || typeof cause !== "object" || !("knowledgeRecovery" in cause) || !cause.knowledgeRecovery)
            throw cause;
        const hint = await recoveryHint(cause.knowledgeRecovery, { datasetPath, dbPath, model });
        throw new Error(`${"message" in cause ? cause.message : undefined}\n${hint}`, { cause });
    }
}

/** Query embeddings are cached only in this runtime; persisted vectors remain in SQLite. */
export function createKnowledgeRetriever({ store, generationId, embedder, signal }: { store: Pick<KnowledgeStore, "search">; generationId: number; embedder: KnowledgeEmbedder; signal?: AbortSignal }) {
    const queries = new Map<string, Promise<number[]>>();
    async function searchRecords({ query, topK = 5, maxPerCommand = 2 }: KnowledgeSearchInput): Promise<KnowledgeHit[]> {
        if (typeof query !== "string" || !query.trim())
            throw new Error("Knowledge search query must not be blank.");
        if (!Number.isSafeInteger(topK) || !Number.isSafeInteger(maxPerCommand))
            throw new Error("Knowledge search limits must be integers.");
        if (topK <= 0 || maxPerCommand <= 0)
            return [];
        signal?.throwIfAborted();
        const formatted = formatEmbeddingQuery(query);
        if (!queries.has(formatted)) {
            const promise = awaitWithSignal(() => embedder.embed(formatted, { signal }), signal);
            queries.set(formatted, promise);
            promise.catch(() => { if (queries.get(formatted) === promise)
                queries.delete(formatted); });
        }
        const vector = await awaitWithSignal(() => queries.get(formatted)!, signal);
        signal?.throwIfAborted();
        return store.search({ generationId, vector, topK, maxPerCommand });
    }
    return {
        searchRecords,
        async retrieveForPlanner({ problem, expectedOutput }: { problem: string; expectedOutput?: string }) {
            const query = [problem, expectedOutput ? `期待する出力: ${expectedOutput}` : ""].filter(Boolean).join("\n");
            return formatKnowledgeRecords(await searchRecords({ query, topK: 5, maxPerCommand: 1 }));
        },
        async search({ query }: { query: string }) {
            return formatKnowledgeRecords(await searchRecords({ query, topK: 5, maxPerCommand: 2 }));
        }
    };
}

export const searchKnowledgeInputSchema = z.object({ query: z.string().trim().min(1).max(500) }).strict();
export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeInputSchema>;

export function createSearchKnowledgeTool({ retriever }: { retriever: KnowledgeRetriever | undefined }) {
    type SearchKnowledgeOutput = { records: ReturnType<typeof formatKnowledgeRecords> };
    return {
        name: "search_knowledge",
        description: "Search the persisted local shell command knowledge database using an external query embedding API. The database operation is read-only.",
        inputSchema: searchKnowledgeInputSchema,
        async execute({ query }: SearchKnowledgeInput): Promise<SearchKnowledgeOutput> {
            const records = await retriever!.search!({ query });
            return {
                records: formatKnowledgeRecords(records, { limit: 5 })
            };
        },
        summarize({ records }: SearchKnowledgeOutput) {
            return { resultCount: records.length, recordIds: records.flatMap(record => record.id ? [record.id] : []) };
        }
    } satisfies ToolRegistration<SearchKnowledgeInput, SearchKnowledgeOutput>;
}
