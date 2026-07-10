import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { defaultCommandPolicy } from "../execution/safety/commandPolicy.js";

export const SUPPORTED_MAN_PROFILES = new Set(["shellgei", "all"]);

const shellgeiProfilePath = fileURLToPath(
  new URL("../../data/knowledge/shellgei-man-profile.json", import.meta.url)
);

function validateStringArray(profile, fieldName) {
  const values = profile[fieldName];

  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(
      `Invalid ShellGei man profile: '${fieldName}' must be an array of nonblank strings.`
    );
  }

  if (new Set(values).size !== values.length) {
    throw new Error(`Invalid ShellGei man profile: '${fieldName}' must not contain duplicates.`);
  }
}

function validateShellgeiProfile(profile) {
  if (!profile || typeof profile !== "object" || profile.name !== "shellgei") {
    throw new Error("Invalid ShellGei man profile: expected name 'shellgei'.");
  }

  validateStringArray(profile, "sections");
  validateStringArray(profile, "commands");
  validateStringArray(profile, "patternCommands");

  if (profile.commands.length < 100 || profile.commands.length > 200) {
    throw new Error("Invalid ShellGei man profile: 'commands' must contain between 100 and 200 commands.");
  }

  const selectedCommands = new Set(profile.commands);
  const missingPatternCommand = profile.patternCommands.find(
    (command) => !selectedCommands.has(command)
  );
  if (missingPatternCommand) {
    throw new Error(
      `Invalid ShellGei man profile: pattern command '${missingPatternCommand}' is not selected.`
    );
  }

  const blockedCommands = new Set(
    defaultCommandPolicy.blockedCommands.map(({ name }) => name)
  );
  const blockedCommand = profile.commands.find((command) => blockedCommands.has(command));
  if (blockedCommand) {
    throw new Error(
      `Invalid ShellGei man profile: command '${blockedCommand}' is blocked by the default command policy.`
    );
  }
}

export async function loadManKnowledgeProfile(name, { readFile = fs.readFile } = {}) {
  if (!SUPPORTED_MAN_PROFILES.has(name)) {
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

  let profile;
  try {
    profile = JSON.parse(await readFile(shellgeiProfilePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ShellGei man profile: ${error.message}`, { cause: error });
  }

  validateShellgeiProfile(profile);
  return profile;
}
