const blockedPatterns = [
  { pattern: /(^|[^\w])(rm)(\s|$)/, reason: "Blocked dangerous command: rm" },
  { pattern: /(^|[^\w])(sudo)(\s|$)/, reason: "Blocked dangerous command: sudo" },
  { pattern: /(^|[^\w])(su)(\s|$)/, reason: "Blocked dangerous command: su" },
  { pattern: /(^|[^\w])(chmod)(\s|$)/, reason: "Blocked dangerous command: chmod" },
  { pattern: /(^|[^\w])(chown)(\s|$)/, reason: "Blocked dangerous command: chown" },
  { pattern: /(^|[^\w])(dd)(\s|$)/, reason: "Blocked dangerous command: dd" },
  { pattern: /(^|[^\w])(mkfs)(\s|$)/, reason: "Blocked dangerous command: mkfs" },
  { pattern: /(^|[^\w])(mount)(\s|$)/, reason: "Blocked dangerous command: mount" },
  { pattern: /(^|[^\w])(umount)(\s|$)/, reason: "Blocked dangerous command: umount" },
  { pattern: /(^|[^\w])(curl)(\s|$)/, reason: "Blocked network command: curl" },
  { pattern: /(^|[^\w])(wget)(\s|$)/, reason: "Blocked network command: wget" },
  { pattern: /(^|[^\w])(nc)(\s|$)/, reason: "Blocked network command: nc" },
  { pattern: /(^|[^\w])(ssh)(\s|$)/, reason: "Blocked network command: ssh" },
  { pattern: /(^|[^\w])(scp)(\s|$)/, reason: "Blocked network command: scp" },
  { pattern: /(^|[^\w])(ftp)(\s|$)/, reason: "Blocked network command: ftp" },
  { pattern: /(^|[^\w])python(\d+(\.\d+)?)?\s+-c(\s|$)/, reason: "Blocked inline interpreter: python -c" },
  { pattern: /(^|[^\w])(perl)\s+-e(\s|$)/, reason: "Blocked inline interpreter: perl -e" },
  { pattern: /(^|[^\w])(ruby)\s+-e(\s|$)/, reason: "Blocked inline interpreter: ruby -e" },
  { pattern: /(^|[^\w])(node)\s+-e(\s|$)/, reason: "Blocked inline interpreter: node -e" },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\};:/, reason: "Blocked fork bomb pattern." },
  {
    pattern: /(?:>|>>)\s*(?:\/etc|\/usr|\/bin|\/sbin|\/var|\$HOME|~\/)/,
    reason: "Blocked redirection to a sensitive path."
  }
];

export function isSafeCommand(command) {
  for (const item of blockedPatterns) {
    if (item.pattern.test(command)) {
      return {
        safe: false,
        reason: item.reason
      };
    }
  }

  return { safe: true };
}
