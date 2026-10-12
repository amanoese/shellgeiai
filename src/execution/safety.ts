import type { CommandPolicy, SandboxPolicy, RunnerLimits } from "../types.js";
import { analyzeShellCommand } from "../shell/analyzer.js";
import path from "node:path";
import { z } from "zod";
import { readJson } from "../shared.js";

export const defaultCommandPolicy: CommandPolicy = {
    blockedCommands: [
        { name: "rm", reason: "Blocked dangerous command: rm" },
        { name: "sudo", reason: "Blocked dangerous command: sudo" },
        { name: "su", reason: "Blocked dangerous command: su" },
        { name: "chmod", reason: "Blocked dangerous command: chmod" },
        { name: "chown", reason: "Blocked dangerous command: chown" },
        { name: "dd", reason: "Blocked dangerous command: dd" },
        { name: "mkfs", reason: "Blocked dangerous command: mkfs" },
        { name: "mount", reason: "Blocked dangerous command: mount" },
        { name: "umount", reason: "Blocked dangerous command: umount" },
        { name: "curl", reason: "Blocked network command: curl" },
        { name: "wget", reason: "Blocked network command: wget" },
        { name: "nc", reason: "Blocked network command: nc" },
        { name: "ssh", reason: "Blocked network command: ssh" },
        { name: "scp", reason: "Blocked network command: scp" },
        { name: "ftp", reason: "Blocked network command: ftp" }
    ],
    blockedRedirectionTargets: [
        { prefix: "/etc", reason: "Blocked redirection to sensitive path" },
        { prefix: "/usr", reason: "Blocked redirection to sensitive path" },
        { prefix: "/bin", reason: "Blocked redirection to sensitive path" },
        { prefix: "/sbin", reason: "Blocked redirection to sensitive path" },
        { prefix: "/var", reason: "Blocked redirection to sensitive path" },
        { prefix: "$HOME", reason: "Blocked redirection to sensitive path" },
        { prefix: "~/", reason: "Blocked redirection to sensitive path" }
    ],
    blockRecursiveBackgroundFunctions: true
};

export function createDefaultSandboxPolicy(): SandboxPolicy {
    return {
        networkAccess: "off",
        filesystemScope: "workdir-only"
    };
}

function blockedCommandReason(commandName: string, policy: CommandPolicy) {
    return policy.blockedCommands.find((item) => item.name === commandName)?.reason ?? null;
}

function normalizeRedirectDestination(destination: string) {
    return destination.replace(/^["']|["']$/g, "");
}

function isSensitiveRedirect(destination: string, target: CommandPolicy["blockedRedirectionTargets"][number]) {
    const normalized = normalizeRedirectDestination(destination);
    const nestedPrefix = target.prefix.endsWith("/") ? target.prefix : `${target.prefix}/`;
    return normalized === target.prefix || normalized.startsWith(nestedPrefix);
}

function blockedRedirectionReason(redirection: { operator: string; destination: string }, policy: CommandPolicy) {
    if (!redirection.operator.includes(">")) {
        return null;
    }
    const target = policy.blockedRedirectionTargets.find((item) => isSensitiveRedirect(redirection.destination, item));
    if (!target) {
        return null;
    }
    return `${target.reason}: ${normalizeRedirectDestination(redirection.destination)}`;
}

export async function isSafeCommand(command: string, policy: CommandPolicy = defaultCommandPolicy): Promise<{ safe: true } | { safe: false; reason: string }> {
    let features;
    try {
        features = await analyzeShellCommand(command);
    }
    catch {
        return {
            safe: false,
            reason: "Blocked unparsable shell command."
        };
    }
    for (const commandName of features.commandNames) {
        const reason = blockedCommandReason(commandName, policy);
        if (reason) {
            return { safe: false, reason };
        }
    }
    for (const redirection of features.redirections) {
        const reason = blockedRedirectionReason(redirection, policy);
        if (reason) {
            return { safe: false, reason };
        }
    }
    if (policy.blockRecursiveBackgroundFunctions) {
        const functionName = features.recursiveBackgroundFunctions[0];
        if (functionName) {
            return {
                safe: false,
                reason: `Blocked recursive background shell function: ${functionName}`
            };
        }
    }
    return { safe: true };
}

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

function resolvePolicyPath(policyPath: string) {
    return path.resolve(process.cwd(), policyPath);
}

function formatValidationError(error: z.ZodError) {
    const issue = error.issues[0];
    const key = issue?.path?.join(".") || "root";
    return `${key}: ${issue?.message ?? "Invalid policy file."}`;
}

export async function loadCommandPolicy(policyPath?: string): Promise<CommandPolicy> {
    if (!policyPath) {
        return defaultCommandPolicy;
    }
    const resolvedPath = resolvePolicyPath(policyPath);
    let parsedFile;
    try {
        parsedFile = await readJson(resolvedPath);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read command policy file '${policyPath}': ${message}`);
    }
    const result = commandPolicyFileSchema.safeParse(parsedFile);
    if (!result.success) {
        throw new Error(`Invalid command policy file '${policyPath}': ${formatValidationError(result.error)}`);
    }
    return result.data;
}

export async function loadSandboxPolicy(policyPath?: string): Promise<SandboxPolicy> {
    if (!policyPath) {
        return createDefaultSandboxPolicy();
    }
    const resolvedPath = resolvePolicyPath(policyPath);
    let parsedFile;
    try {
        parsedFile = await readJson(resolvedPath);
    }
    catch (error) {
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

export function createDefaultRunnerLimits(): RunnerLimits {
    return {
        wallClockMs: 5000,
        stdoutMaxBytes: 64 * 1024,
        stderrMaxBytes: 64 * 1024,
        memoryMaxBytes: 256 * 1024 * 1024,
        cpuCount: 1,
        processMaxCount: 64,
        networkAccess: "off"
    };
}
