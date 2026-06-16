#!/usr/bin/env node

import { runCli } from "./cli/index.js";

void runCli(process.argv.slice(2));
