import { resolve } from "path";
import { readdir, writeFile } from "fs/promises";

import Knex from "knex";

const { POSTGRES_DSN, MIGRATIONS_DIR } = process.env;

if (!POSTGRES_DSN) {
  console.error(` [migrator] : POSTGRES_DSN env is required but not presented`);

  process.exit(1);
}

if (!MIGRATIONS_DIR) {
  console.error(` [migrator] : MIGRATIONS_DIR env is required but not presented`);

  process.exit(1);
}

const migrationsPath = resolve(MIGRATIONS_DIR);

const knex = Knex({
  client: "pg",
  connection: POSTGRES_DSN,
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

(async () => {
  const [, , command, ...rest] = process.argv;
  let fn: Promise<void>;

  switch (command) {
    case "create": {
      const [name] = rest;
      fn = create(name);

      break;
    }
    case "latest": {
      fn = latest();

      break;
    }
    case "down": {
      fn = down();

      break;
    }
    default: {
      console.error(` [migrator] : unknown command ${command}`);

      process.exit(1);
    }
  }

  try {
    await fn;

    console.log("\x1b[32m%s\x1b[0m", ` [migrator] : operation completed`);

    process.exit(0);
  } catch (e) {
    console.log("\x1b[31m%s\x1b[0m", ` [migrator] : operation ended with an error`);

    console.error(e);

    process.exit(1);
  }
})();
