import type { z } from "zod";
import type { Response, ParsedResponse, ResponseCreateParamsNonStreaming, ResponseParseParams } from "openai/resources/responses/responses";
import type OpenAI from "openai";
type RequestOptions = NonNullable<Parameters<OpenAI["responses"]["create"]>[1]>;
import type { toolSuggestionSchema, variantSchema, plannerResultSchema } from "./providers/planner.js";

export type KnowledgeMode = "off" | "planner" | "worker" | "all";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface EngineToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionCall {
  name: string;
  arguments: unknown;
}

export interface ToolCallSummary {
  name: string;
  arguments: Record<string, unknown>;
  status: "completed" | "error";
  resultCount: number;
  recordIds: string[];
}

export type EngineContinuation = Record<string, unknown>;

export interface EngineToolResult {
  callId: string;
  result: unknown;
}

export interface CommandTurn {
  type: "command";
  command: string;
  explanation?: string;
}

export interface ToolCallsTurn {
  type: "tool_calls";
  calls: EngineToolCall[];
  continuation: EngineContinuation;
}

export interface SolveAttempt {
  attemptId?: string;
  workerId?: string;
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  passed: boolean;
  timedOut?: boolean;
  explanation?: string;
  failureReason?: string;
  durationMs?: number;
  score?: JudgeScore;
  runnerFailure?: RunnerFailure | null;
  runnerCleanup?: RunnerCleanup | null;
  toolCalls?: ToolCallSummary[];
  aborted?: boolean;
  state?: WorkerPhase;
  stopReason?: string;
}

export interface WorkerTask {
  workerId: string;
  strategy: string;
  strategyProfile: { name: string, focus: string, retryHint: string, rubricFocus: string[] };
  assignedVariant?: PlanVariant;
  maxAttempts: number;
}

export interface SolveContext {
  problem: string;
  attempts: SolveAttempt[];
  workdir: string;
  workerId?: string;
  strategy?: string;
  workerTask?: WorkerTask;
}

export interface EngineResult {
  command: string;
  explanation?: string;
}

export interface ProblemSpec {
  raw: string;
  problemText: string;
  expectedOutput?: string;
  metadata?: { format: string };
}

export type ShellgeiScoreMode = "simple" | "artistry" | "robustness";

export interface ShellgeiScore {
  value: number;
  mode: ShellgeiScoreMode;
  breakdown: { conciseness: number, shellness: number, ingenuity: number, readability: number, robustness: number, artistry: number};
  notes: string[];
  penalties: string[];
}

export interface ExecutionPlan {
  mode: "single" | "parallel";
  parallelism: number;
  variants: PlanVariant[];
  workerTasks: WorkerTask[];
  knowledgeMode?: KnowledgeMode;
  planner: { provider: string, attemptedProvider: string | null, fallbackReason: string | null, promptVersion: unknown, prompt: unknown, rawResponse: unknown};
}

export interface PlannerKnowledgeHint {
  id?: string;
  command?: string;
  option?: string;
  text?: string;
  source?: string;
}

export interface KnowledgeRetriever {
  retrieveForPlanner?: (input: { problem: string, expectedOutput?: string }) => Promise<PlannerKnowledgeHint[]>;
  search?: (input: { query: string }) => Promise<PlannerKnowledgeHint[]>;
}

export interface KnowledgeEmbedder {
  embed: (text: string, options?: {signal?: AbortSignal }) => Promise<number[]>;
  embedBatch?: (texts: string[], options?: {signal?: AbortSignal }) => Promise<number[][]>;
}

export type KnowledgeEmbedderFactory = (options: { model: string }) => KnowledgeEmbedder;

export interface KnowledgeSnapshot {
  provider: "openrouter";
  model: string;
  inputProfile: string;
  dbPath: string;
  dimensions: number;
  generationId: number;
  datasetFingerprint: string;
}

export interface KnowledgeRuntime {
  retriever: KnowledgeRetriever;
  snapshot: KnowledgeSnapshot;
  dispose: () => Promise<void>;
}

export interface LlmConfig {
  provider: "openrouter" | "openai" | "custom";
  baseURL: string;
  /** Private credential; never serialize into session logs. */
  apiKey: string;
  model: string;
  plannerModel: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface EngineCapabilities {
  toolCalling: boolean;
}

export interface GenerateTurnInput {
  context: SolveContext;
  tools: ToolDefinition[];
  continuation?: EngineContinuation;
  toolResults?: EngineToolResult[];
  signal?: AbortSignal;
}

export type EngineTurn = CommandTurn | ToolCallsTurn;

export interface RunnerLimits {
  wallClockMs: number;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
  memoryMaxBytes?: number;
  cpuCount?: number;
  processMaxCount?: number;
  networkAccess?: "off" | "on";
}

export interface SandboxPolicy {
  networkAccess: "off" | "on";
  filesystemScope: string;
}

export interface RunnerFailure {
  type: string;
  message: string;
}

export interface RunnerCleanup {
  attempted: boolean;
  exitCode: number | null;
  stderr: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted?: boolean;
  durationMs?: number;
  failure?: RunnerFailure | null;
  cleanup?: RunnerCleanup | null;
  image?: string;
  containerName?: string;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  limits?: RunnerLimits;
  sandboxPolicy?: SandboxPolicy;
  writableWorkdir?: boolean;
  dockerDevicesReadonly?: string[];
  signal?: AbortSignal;
}

export interface Runner {
  name?: string;
  run: (command: string, options: RunOptions) => Promise<RunResult>;
}

export interface JudgeScoreBreakdown {
  correctness: number;
  stdoutQuality: number;
  stderrQuality: number;
  expectedOutput: number;
}

export interface JudgeScore {
  value: number;
  breakdown: JudgeScoreBreakdown;
}

export interface JudgeInput {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  expectedOutput?: string;
}

export interface JudgeDecision {
  passed: boolean;
  reason: string;
  score: JudgeScore;
}

export interface Judge {
  judge: (input: JudgeInput) => Promise<JudgeDecision>;
}

// Keep planner validation and TypeScript contracts on the same schema definitions.
export type ToolSuggestion = z.infer<typeof toolSuggestionSchema>;
export type PlanVariant = z.infer<typeof variantSchema>;
export type PlannerResult = z.infer<typeof plannerResultSchema>;

export interface EngineBase {
  name: string;
  /** Private provider settings; public logs use an explicit safe snapshot. */
  llmConfig?: LlmConfig;
  client?: LlmClient | null;
  clientFactory?: LlmClientFactory;
  fetchImpl?: typeof globalThis.fetch;
  generateCommand(context: SolveContext, options?: { signal?: AbortSignal }): Promise<EngineResult>;
}
export type Engine = EngineBase & (
  | { capabilities: { toolCalling: true }; generateTurn(input: GenerateTurnInput): Promise<EngineTurn> }
  | { capabilities?: { toolCalling: false }; generateTurn?: (input: GenerateTurnInput) => Promise<EngineTurn> }
);
export interface LlmClient {
  responses: {
    create(request: ResponseCreateParamsNonStreaming, options?: RequestOptions): PromiseLike<Response>;
    parse(request: ResponseParseParams, options?: RequestOptions): PromiseLike<ParsedResponse<unknown>>;
  };
}
export interface LlmClientOptions {
  apiKey: string;
  baseURL: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof globalThis.fetch;
}
export type LlmClientFactory = (options: LlmClientOptions) => LlmClient | PromiseLike<LlmClient>;

export interface ToolRegistration<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: z.ZodType<T>;
  execute(input: T): unknown | Promise<unknown>;
}
export type ToolExecutionResult<T = unknown> = { validatedArguments: Record<string, unknown> } & (
  | { ok: true; value: T }
  | { ok: false; error: { code: "unknown_tool" | "invalid_arguments" | "tool_execution_failed"; message: string } }
);
export interface ToolRegistry {
  register<T extends Record<string, unknown>>(tool: ToolRegistration<T>): void;
  definitions(): ToolDefinition[];
  execute(call: ToolExecutionCall): Promise<ToolExecutionResult>;
}

export type WorkerAttemptOutcome<T extends { passed: boolean; explanation?: string }> =
  | { kind: "passed"; attempt: T & { passed: true } }
  | { kind: "retry"; attempt: T & { passed: false } }
  | { kind: "stopped"; reason: string; explanation: string | undefined; attempt: (T & { passed: false }) | null };
export type WorkerPhase = "idle" | "planning" | "running" | "judging" | "stopped";
export interface WorkerState {
  workerId: string;
  phase: WorkerPhase;
  iteration: number;
  command: string;
  abortController: AbortController;
}
export interface StopOptions {
  reason: string;
  passingCandidateId?: string;
  exceptWorkerId?: string;
  force?: boolean;
}
export interface ExecutionControl {
  stopRequested: boolean;
  stopReason: string;
  passingCandidateId: string | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  graceStopTimer: ReturnType<typeof setTimeout> | null;
  workers: Map<string, WorkerState>;
  requestStop(options: StopOptions): void;
  scheduleGraceStop(options: StopOptions, delayMs: number): void;
  createWorkerState(task: WorkerTask): WorkerState;
  getStopReason(): string;
  dispose(): void;
}
export interface CandidateFinalCheck {
  passed: boolean;
  iterations: number;
  engine: string;
  reason: string | undefined;
  score?: JudgeScore | null;
  gate?: { disqualified?: boolean; stderrAllowed?: boolean; expectedOutputMatched?: boolean };
}
export interface WorkerCandidate {
  candidateId: string;
  workerId: string;
  strategy: string;
  command: string;
  output: string;
  explanation: string;
  attempts: SolveAttempt[];
  finalCheck: CandidateFinalCheck;
  shellgeiScore?: ShellgeiScore | null;
}
export interface WorkerSummary {
  workerId: string;
  strategy: string;
  strategyProfile: WorkerTask["strategyProfile"];
  attemptCount: number;
  passed: boolean;
  state: WorkerPhase;
  reason: string | undefined;
}
export interface WorkerResult {
  attempts: SolveAttempt[];
  candidate: WorkerCandidate;
  workerSummary: WorkerSummary;
}
export interface ExecutionSummary {
  attempts: SolveAttempt[];
  candidates: WorkerCandidate[];
  workerSummaries: WorkerSummary[];
  stopReason: string | null;
  passingCandidateId: string | null;
  failedWorkerCount: number;
}
export interface CommandPolicy {
  blockedCommands: { name: string; reason: string }[];
  blockedRedirectionTargets: { prefix: string; reason: string }[];
  blockRecursiveBackgroundFunctions: boolean;
}
export type SelectorName = "first-pass-wins" | "best-score-wins";
export type SolveMode = "single" | "parallel";
export interface PlannerProvider {
  name?: string;
  buildPlan(session: InitializingSolveSession): Promise<unknown>;
}
export interface ProgressSession {
  sessionId: string;
  onProgress?: (event: SolveProgressEvent) => void;
}
export interface InitializingSolveSession extends ProgressSession {
  startedAt: string;
  startedAtMs: number;
  problem: ProblemSpec;
  workdir: string;
  logsDir: string;
  engine: Engine;
  runner: Runner;
  judge: Judge;
  maxIterations: number;
  mode: SolveMode;
  parallelism: number;
  selectorName: SelectorName;
  shellgeiScoreMode: ShellgeiScoreMode;
  knowledgeMode: KnowledgeMode;
  knowledgeModel: string;
  knowledgeDatasetPath: string;
  knowledgeDbPath: string;
  knowledgeRetriever?: KnowledgeRetriever;
  knowledgeSnapshot?: KnowledgeSnapshot;
  plannerKnowledgeHints: PlannerKnowledgeHint[];
  toolRegistry?: ToolRegistry;
  timeBudgetMs?: number;
  deadlineAtMs: number | null;
  runnerLimits: RunnerLimits;
  writableWorkdir: boolean;
  dockerDevicesReadonly: string[];
  commandPolicy: CommandPolicy;
  sandboxPolicy: SandboxPolicy;
  signal: AbortSignal;
  llmConfig?: LlmConfig;
  plannerProvider?: PlannerProvider;
  dispose(): Promise<void>;
}
export interface SolveSession extends InitializingSolveSession { plan: ExecutionPlan }
export interface KnowledgeRuntimeOptions {
  datasetPath: string;
  dbPath: string;
  model: string;
  embedder?: KnowledgeEmbedder;
  embedderFactory?: KnowledgeEmbedderFactory;
  signal?: AbortSignal;
}
export interface SolveProblemOptions {
  problemInput: string;
  engine: Engine;
  runner: Runner;
  judge: Judge;
  maxIterations: number;
  requestedWorkdir?: string;
  mode?: SolveMode;
  parallelism?: number;
  selector?: SelectorName;
  timeBudgetMs?: number;
  writableWorkdir?: boolean;
  dockerDevicesReadonly?: string[];
  shellgeiScoreMode?: ShellgeiScoreMode;
  runnerLimits?: RunnerLimits;
  commandPolicy?: CommandPolicy;
  commandPolicyPath?: string;
  sandboxPolicy?: SandboxPolicy;
  sandboxPolicyPath?: string;
  knowledgeMode?: KnowledgeMode | "on";
  knowledgeModel?: string;
  knowledgeDatasetPath?: string;
  knowledgeDbPath?: string;
  knowledgeRetriever?: KnowledgeRetriever;
  knowledgeEmbedder?: KnowledgeEmbedder;
  knowledgeEmbedderFactory?: KnowledgeEmbedderFactory;
  knowledgeRuntimeFactory?: (options: KnowledgeRuntimeOptions) => Promise<KnowledgeRuntime>;
  signal?: AbortSignal;
  llmConfig?: LlmConfig;
  onProgress?: (event: SolveProgressEvent) => void;
  plannerProvider?: PlannerProvider;
}
export type SessionPhase = "initializing" | "problem-parsing" | "planning" | "executing" | "selecting" | "logging" | "completed";
export interface SessionPhaseEvent {
  type: "session-phase";
  phase: SessionPhase;
  phaseIndex: number;
  phaseCount: number;
  message?: string;
}
type WorkerProgress = { workerId: string; strategy: string };
export type SolveProgressPayload =
  | SessionPhaseEvent
  | { type: "session-started"; parallelism: number; workerCount: number }
  | (WorkerProgress & { type: "worker-started"; maxAttempts: number })
  | (WorkerProgress & { type: "worker-state"; state: WorkerPhase })
  | (WorkerProgress & { type: "attempt-started"; iteration: number; command: string })
  | (WorkerProgress & { type: "attempt-finished"; iteration: number; command: string; passed: boolean; reason: string })
  | (WorkerProgress & { type: "worker-finished"; attemptCount: number; passed: boolean; reason: string | undefined })
  | { type: "session-finished"; attemptCount: number; candidateCount: number; failedWorkerCount: number; stopReason: string | null; selectedCandidateId: string | null };
export type SolveProgressEvent = SolveProgressPayload & { sessionId: string };
