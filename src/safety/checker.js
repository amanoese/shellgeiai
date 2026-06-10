import { defaultCommandPolicy } from "./commandPolicy.js";

export function isSafeCommand(command, policy = defaultCommandPolicy) {
  for (const item of policy.blockedPatterns) {
    if (item.pattern.test(command)) {
      return {
        safe: false,
        reason: item.reason
      };
    }
  }

  return { safe: true };
}
