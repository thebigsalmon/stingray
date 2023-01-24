#! /usr/bin/env node

import { Command, program } from "commander";

import methodRegistryGenerator from "./tools/methodRegistryGenerator";
import migrator from "./tools/migrator";
import modelsGenerator from "./tools/modelsGenerator";
import tablesGenerator from "./tools/tablesGenerator";
import openapiGenerator from "./tools/openapiGenerator";
import responseGenerator from "./tools/responseGenerator";
import apiSchemasGenerator from "./tools/apiSchemasGenerator";

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

program
  .command("methodRegistryGenerator")
  .description("Generates method registry file from routes dir")
  .requiredOption("--method-registry-dir <type>", "path to method registry output folder")
  .requiredOption("--routes-dir <type>", "path to routes directory")
  .action(async ({ routesDir, methodRegistryDir }) => {
    await methodRegistryGenerator({
      routesDir,
      methodRegistryDir,
    });
  });

program
  .command("modelsGenerator")
  .description("Generates models from postgres tables")
  .requiredOption("--postgres-dsn <type>", "postgres connection string")
  .requiredOption("--models-out-dir <type>", "path to models out dir")
  .option("--models-class-factory-out-dir <type>", "if presented, classFactory will be saved under this path")
  .action(
    async ({
      postgresDsn, //
      modelsOutDir,
      modelsClassFactoryOutDir,
    }) => {
      await modelsGenerator({
        postgresDsn,
        modelsOutDir,
        modelsClassFactoryOutDir,
      });

      // TODO выяснить, почему выход не происходит автоматически.
      process.exit(0);
    },
  );

program
  .command("tablesGenerator")
  .description("Generates tables file from database")
  .requiredOption("--postgres-dsn <type>", "postgres connection string")
  .requiredOption("--tables-out-dir <type>", "out directory for tables file")
  .action(async ({ tablesOutDir, postgresDsn }) => {
    await tablesGenerator({
      tablesOutDir,
      postgresDsn,
    });

    // TODO выяснить, почему выход не происходит автоматически.
    process.exit(0);
  });

program
  .command("openapiGenerator")
  .description("Generates api specification based on request and response interfaces")
  .requiredOption("--project-root-dir <type>", "path to stingray-based project")
  .action(async ({ projectRootDir }) => {
    await openapiGenerator({
      projectRootDir,
    });
  });

program
  .command("apiSchemasGenerator")
  .description("Generates response pickers schemas and registrator")
  .requiredOption("--project-root-dir <type>", "path to stingray-based project")
  .requiredOption("--out-dir <type>", "path to the generated file")
  .action(async ({ projectRootDir, outDir }) => {
    await apiSchemasGenerator({
      projectRootDir,
      outDir,
    });
  });

function makeMigratorCommand() {
  const migratorCommand = new Command("migrator");

  migratorCommand
    .command("create")
    .description("creates a new migration file respecting the migrations order")
    .requiredOption("--name <type>", "migration name")
    .requiredOption("--migrations-dir <type>", "path to migrations folder")
    .action(async ({ name, migrationsDir }) => {
      await migrator({
        command: "create",
        migrationName: name,
        migrationsDir,
      });

      // TODO выяснить, почему выход не происходит автоматически.
      process.exit(0);
    });

  migratorCommand
    .command("latest")
    .description("applies all migration from current plus one to the last one")
    .requiredOption("--postgres-dsn <type>", "postgres connection string")
    .requiredOption("--migrations-dir <type>", "path to migrations folder")
    .action(async ({ postgresDsn, migrationsDir }) => {
      await migrator({
        command: "latest",
        postgresDsn,
        migrationsDir,
      });

      // TODO выяснить, почему выход не происходит автоматически.
      process.exit(0);
    });

  migratorCommand
    .command("down")
    .description("Revoke last migration in (!) database")
    .requiredOption("--postgres-dsn <type>", "postgres connection string")
    .requiredOption("--migrations-dir <type>", "path to migrations folder")
    .action(async ({ postgresDsn, migrationsDir }) => {
      await migrator({
        command: "down",
        postgresDsn,
        migrationsDir,
      });

      // TODO выяснить, почему выход не происходит автоматически.
      process.exit(0);
    });

  return migratorCommand;
}

program.addCommand(makeMigratorCommand());

(async () => {
  await program.parseAsync();
})();
