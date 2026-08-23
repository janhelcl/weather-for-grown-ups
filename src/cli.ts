#!/usr/bin/env node
import { createCliProgram } from "./cli/program.js";

await createCliProgram().parseAsync();
