#!/usr/bin/env node

import { runCli } from "./cli/program.js";

void runCli(process.argv.slice(2));
