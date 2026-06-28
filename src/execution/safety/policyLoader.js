import path from "node:path";
import { z } from "zod";
import { defaultCommandPolicy } from "./commandPolicy.js";
import { createDefaultSandboxPolicy } from "./sandboxPolicy.js";
import { readJson } from "../../shared/fs.js";

const blockedCommandSchema = z
  .object({
    name: z.string().trim().min(1, "Blocked command name must not be empty."),
    reason: z.string().trim().min(1, "Blocked command reason must not be empty.")
  })
  .strict();

const blockedRedirectionTargetSchema = z
  .object({
    prefix: z.string().trim().min(1, "Blocked redirection prefix must not be empty."),
    reason: z.string().trim().min(1, "Blocked redirection reason must not be empty.")
  })
  .strict();

const commandPolicyFileSchema = z
  .object({
    blockedCommands: z.array(blockedCommandSchema).default([]),
    blockedRedirectionTargets: z.array(blockedRedirectionTargetSchema).default([]),
    blockRecursiveBackgroundFunctions: z.boolean().default(true)
  })
  .strict();

const sandboxPolicyFileSchema = z
  .object({
    networkAccess: z.enum(["off", "on"]).optional(),
    filesystemScope: z.string().trim().min(1).optional()
  })
  .strict();

function resolvePolicyPath(policyPath) {
  return path.resolve(process.cwd(), policyPath);
}

function formatValidationError(error) {
  const issue = error.issues[0];
  const key = issue?.path?.join(".") || "root";
  return `${key}: ${issue?.message ?? "Invalid policy file."}`;
}

export async function loadCommandPolicy(policyPath) {
  if (!policyPath) {
    return defaultCommandPolicy;
  }

  const resolvedPath = resolvePolicyPath(policyPath);
  let parsedFile;
  try {
    parsedFile = await readJson(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read command policy file '${policyPath}': ${message}`);
  }

  const result = commandPolicyFileSchema.safeParse(parsedFile);
  if (!result.success) {
    throw new Error(`Invalid command policy file '${policyPath}': ${formatValidationError(result.error)}`);
  }

  return result.data;
}

export async function loadSandboxPolicy(policyPath) {
  if (!policyPath) {
    return createDefaultSandboxPolicy();
  }

  const resolvedPath = resolvePolicyPath(policyPath);
  let parsedFile;
  try {
    parsedFile = await readJson(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read sandbox policy file '${policyPath}': ${message}`);
  }

  const result = sandboxPolicyFileSchema.safeParse(parsedFile);
  if (!result.success) {
    throw new Error(`Invalid sandbox policy file '${policyPath}': ${formatValidationError(result.error)}`);
  }

  return {
    ...createDefaultSandboxPolicy(),
    ...result.data
  };
}
