#! /usr/bin/env node

import { program } from "commander";

import responseGenerator from "./tools/responseGenerator";

program //
  .name("stingray")
  .description("CLI to stngray library")
  .version("0.0.1");

program
  .command("responseGenerator")
  .description("Generates .pick.ts files for routes based on .api.ts files")
  .requiredOption("--project-root-dir <type>", "path to stingray-based project")
  .requiredOption("--routes-dir <type>", "path to routes directory")
  .option("--target-route <type>", "single route name which will be processed, other routes will be ignored")
  .action(
    async ({
      projectRootDir, //
      routesDir,
      targetRoute,
    }) => {
      await responseGenerator({
        projectRootDir, //
        routesDir,
        targetRoute,
      });
    },
  );

(async () => {
  await program.parseAsync();
})();
