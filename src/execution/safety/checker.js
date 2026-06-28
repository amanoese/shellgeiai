import { analyzeShellCommand } from "../../solve/scoring/commandAnalyzer.js";
import { defaultCommandPolicy } from "./commandPolicy.js";

function blockedCommandReason(commandName, policy) {
  return policy.blockedCommands.find((item) => item.name === commandName)?.reason ?? null;
}

function normalizeRedirectDestination(destination) {
  return destination.replace(/^["']|["']$/g, "");
}

function isSensitiveRedirect(destination, target) {
  const normalized = normalizeRedirectDestination(destination);
  const nestedPrefix = target.prefix.endsWith("/") ? target.prefix : `${target.prefix}/`;
  return normalized === target.prefix || normalized.startsWith(nestedPrefix);
}

function blockedRedirectionReason(redirection, policy) {
  if (!redirection.operator.includes(">")) {
    return null;
  }

  const target = policy.blockedRedirectionTargets.find((item) => isSensitiveRedirect(redirection.destination, item));
  if (!target) {
    return null;
  }

  return `${target.reason}: ${normalizeRedirectDestination(redirection.destination)}`;
}

export async function isSafeCommand(command, policy = defaultCommandPolicy) {
  let features;
  try {
    features = await analyzeShellCommand(command);
  } catch {
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
