import type { ManKnowledgeProfile } from "../types.js";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defaultCommandPolicy } from "../execution/safety.js";

export const MAN_PROFILE_NAMES = ["shellgei", "all"] as const;
const supportedManProfiles: readonly string[] = Object.freeze(MAN_PROFILE_NAMES);

export const SUPPORTED_MAN_PROFILES = new Set(supportedManProfiles);

const shellgeiProfilePath = fileURLToPath(new URL("../../data/knowledge/shellgei-man-profile.json", import.meta.url));

function validateStringArray(profile: Record<string, unknown>, fieldName: string): string[] {
    const values = profile[fieldName];
    if (!Array.isArray(values) || !values.every((value: unknown): value is string => typeof value === "string" && Boolean(value.trim()))) {
        throw new Error(`Invalid ShellGei man profile: '${fieldName}' must be an array of nonblank strings.`);
    }
    if (values.some((value) => value !== value.trim())) {
        throw new Error(`Invalid ShellGei man profile: '${fieldName}' must contain canonical strings without surrounding whitespace.`);
    }
    if (new Set(values).size !== values.length) {
        throw new Error(`Invalid ShellGei man profile: '${fieldName}' must not contain duplicates.`);
    }
    return values;
}

function validateShellgeiProfile(profile: unknown): asserts profile is Extract<ManKnowledgeProfile, { name: "shellgei" }> {
    if (!profile || typeof profile !== "object" || !("name" in profile) || profile.name !== "shellgei") {
        throw new Error("Invalid ShellGei man profile: expected name 'shellgei'.");
    }
    const fields = profile as Record<string, unknown>;
    validateStringArray(fields, "sections");
    const commands = validateStringArray(fields, "commands");
    const patternCommands = validateStringArray(fields, "patternCommands");
    if (commands.length < 100 || commands.length > 200) {
        throw new Error("Invalid ShellGei man profile: 'commands' must contain between 100 and 200 commands.");
    }
    const selectedCommands = new Set(commands);
    const missingPatternCommand = patternCommands.find((command) => !selectedCommands.has(command));
    if (missingPatternCommand) {
        throw new Error(`Invalid ShellGei man profile: pattern command '${missingPatternCommand}' is not selected.`);
    }
    const blockedCommands = new Set(defaultCommandPolicy.blockedCommands.map(({ name }) => name));
    const blockedCommand = commands.find((command) => blockedCommands.has(command));
    if (blockedCommand) {
        throw new Error(`Invalid ShellGei man profile: command '${blockedCommand}' is blocked by the default command policy.`);
    }
}

export async function loadManKnowledgeProfile(name: string = "shellgei", { readFile = fs.readFile }: { readFile?: (path: string, encoding: "utf8") => Promise<string> } = {}): Promise<ManKnowledgeProfile> {
    if (!supportedManProfiles.includes(name)) {
        throw new Error(`Unknown man knowledge profile '${name}'. Use shellgei or all.`);
    }
    if (name === "all") {
        return {
            name: "all",
            sections: ["1", "8"],
            commands: null,
            patternCommands: null
        };
    }
    let profile: unknown;
    try {
        profile = JSON.parse(await readFile(shellgeiProfilePath, "utf8"));
    }
    catch (error) {
        throw new Error(`Unable to read ShellGei man profile: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    validateShellgeiProfile(profile);
    return profile;
}
