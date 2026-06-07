"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalRunner = void 0;
const node_child_process_1 = require("node:child_process");
class LocalRunner {
    async run(command, options) {
        return await new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)("/bin/bash", ["--noprofile", "--norc", "-lc", command], {
                cwd: options.cwd,
                env: {
                    PATH: process.env.PATH ?? "",
                    LANG: process.env.LANG ?? "C.UTF-8"
                },
                stdio: ["ignore", "pipe", "pipe"]
            });
            let stdout = "";
            let stderr = "";
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill("SIGKILL");
            }, options.timeoutMs);
            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            child.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                resolve({
                    stdout,
                    stderr,
                    exitCode: code,
                    timedOut
                });
            });
        });
    }
}
exports.LocalRunner = LocalRunner;
