import path from "node:path";
import { z } from "zod";
import { defaultCommandPolicy } from "./commandPolicy.js";
import { createDefaultSandboxPolicy } from "./sandboxPolicy.js";
import { readJson } from "../../shared/fs.js";

const commandPolicyPatternSchema = z
  .object({
    pattern: z.string().min(1, "Blocked pattern must not be empty."),
    flags: z.string().optional(),
    reason: z.string().trim().min(1, "Blocked pattern reason must not be empty.")
  })
  .strict();

const commandPolicyFileSchema = z
  .object({
    extendDefault: z.boolean().optional(),
    blockedPatterns: z.array(commandPolicyPatternSchema).default([])
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

  const compiledPatterns = result.data.blockedPatterns.map((item, index) => {
    try {
      return {
        pattern: new RegExp(item.pattern, item.flags),
        reason: item.reason
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid command policy file '${policyPath}': blockedPatterns.${index}.pattern: ${message}`
      );
    }
  });

  return {
    blockedPatterns:
      result.data.extendDefault === false
        ? compiledPatterns
        : [...defaultCommandPolicy.blockedPatterns, ...compiledPatterns]
  };
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
