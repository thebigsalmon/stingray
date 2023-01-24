import { resolve } from "node:path";
import { readdir, writeFile } from "node:fs/promises";

import Knex from "knex";

export default async ({
  migrationsDir: migrationsPath,
  postgresDsn,
  command,
  migrationName,
}: {
  command: "create" | "latest" | "down";
  migrationsDir: string;
  postgresDsn?: string;
  migrationName?: string;
}) => {
  const knex = Knex({
    client: "pg",
    connection: postgresDsn,
    useNullAsDefault: false,
    migrations: {
      directory: migrationsPath,
    },
  });

  const migrationTpl = `const up = \`\`;

const down = \`\`;
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.raw(up);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.raw(down);
};
`;

  const create = async (name: string) => {
    const files = await readdir(migrationsPath);

    let filename = "";

    if (files.length === 0) {
      filename = `000001_${name}`;
    } else {
      filename = (parseInt(files[files.length - 1].split("_")[0]) + 1).toString();
      while (filename.length < 6) {
        filename = `0${filename}`;
      }
      filename = `${filename}_${name}`;
    }

    await writeFile(resolve(migrationsPath, `${filename}.js`), migrationTpl);
  };

  const latest = async () => await knex.migrate.latest();

  const down = async () => await knex.migrate.down();

  let fn: Promise<void>;

  switch (command) {
    case "create": {
      if (!migrationName) {
        throw new Error("Migration name is required for create command");
      }

      fn = create(migrationName);

      break;
    }
    case "latest": {
      if (!postgresDsn) {
        throw new Error("PostgresDSN name is required for latest command");
      }

      fn = latest();

      break;
    }
    case "down": {
      if (!postgresDsn) {
        throw new Error("PostgresDSN name is required for down command");
      }

      fn = down();

      break;
    }
    default: {
      throw new Error(` [migrator] : unknown command ${command}`);
    }
  }

  try {
    await fn;

    console.log("\x1b[32m%s\x1b[0m", ` [migrator] : operation completed`);
  } catch (e) {
    console.log("\x1b[31m%s\x1b[0m", ` [migrator] : operation ended with an error`);

    throw e;
  }
};
