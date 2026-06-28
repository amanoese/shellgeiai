export function createDefaultSandboxPolicy() {
  return {
    networkAccess: "off",
    filesystemScope: "workdir-only"
  };
}
