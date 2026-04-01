#!/usr/bin/env node

import { main } from "../bootstrap/runtime.js";

process.exitCode = await main(process.argv.slice(2));
