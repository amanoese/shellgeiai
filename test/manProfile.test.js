import { describe, expect, it } from "vitest";

import { defaultCommandPolicy } from "../src/execution/safety/commandPolicy.js";
import {
  loadManKnowledgeProfile,
  SUPPORTED_MAN_PROFILES
} from "../src/knowledge/manProfile.js";

describe("man knowledge profiles", () => {
  it("loads the curated ShellGei profile", async () => {
    const profile = await loadManKnowledgeProfile("shellgei");
    const blockedCommands = new Set(
      defaultCommandPolicy.blockedCommands.map(({ name }) => name)
    );

    expect(profile.name).toBe("shellgei");
    expect(profile.sections).toEqual(["1"]);
    expect(profile.commands.length).toBeGreaterThanOrEqual(100);
    expect(profile.commands.length).toBeLessThanOrEqual(200);
    expect(new Set(profile.commands).size).toBe(profile.commands.length);
    expect(profile.commands.filter((command) => blockedCommands.has(command))).toEqual([]);
    expect(profile.patternCommands.every((command) => profile.commands.includes(command))).toBe(true);
  });

  it("loads the unrestricted all profile", async () => {
    await expect(loadManKnowledgeProfile("all")).resolves.toEqual({
      name: "all",
      sections: ["1", "8"],
      commands: null,
      patternCommands: null
    });
  });

  it("exposes supported profiles and rejects an unknown profile", async () => {
    expect(SUPPORTED_MAN_PROFILES).toEqual(new Set(["shellgei", "all"]));
    await expect(loadManKnowledgeProfile("unknown")).rejects.toThrow(
      "Unknown man knowledge profile 'unknown'. Use shellgei or all."
    );
  });
});
