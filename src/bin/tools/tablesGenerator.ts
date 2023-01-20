import { writeFileSync } from "fs";
import { resolve } from "path";

import knex, { Knex } from "knex";

interface GenericObject {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const snakeToCamel = (value: string): string => value.replace(/(_\w)/g, (w) => w[1].toUpperCase());

const { TABLES_OUT_DIR, POSTGRES_DSN } = process.env;

if (!TABLES_OUT_DIR) {
  console.error(` [modelsGenerator] : TABLES_OUT_DIR env is required but not presented`);

  process.exit(1);
}

const outDir = resolve(TABLES_OUT_DIR);

const knexInstance = knex<any, any[]>({
  client: "pg",
  connection: POSTGRES_DSN,
  useNullAsDefault: false,
});

const relationsQuery = `
SELECT
    CAST(tc.table_schema AS varchar(255)) AS table_schema,
    CAST(tc.constraint_name AS varchar(255)) AS constraint_name,
    tbld.name AS table_name,
    CAST(kcu.column_name AS varchar(255)) AS column_name,
    CAST(ccu.table_schema AS varchar(255)) AS foreign_table_schema,
    tbld_foreign.name AS foreign_table_name,
    CAST(ccu.column_name AS varchar(255)) AS foreign_column_name
FROM information_schema.table_constraints AS tc
INNER JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
INNER JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
INNER JOIN information_schema.columns col ON tc.table_name = col.table_name AND kcu.column_name = col.column_name
INNER JOIN table_data tbld ON tbld.name = CAST(tc.table_name AS varchar(255)) AND tbld.is_ready = TRUE
INNER JOIN table_data tbld_foreign ON tbld_foreign.name = CAST(ccu.table_name AS varchar(255)) AND tbld_foreign.is_ready = TRUE
WHERE
    tc.constraint_type = 'FOREIGN KEY'
ORDER BY
    tc.table_schema,
    tbld.name,
    col.ordinal_position,
    tc.constraint_name;
`;

(async (knex: Knex): Promise<void> => {
  const tableData = await knex //
    .from("table_data")
    .where("is_ready", "=", true)
    .orderBy("name")
    .select();

  const relations = (await knex.raw(relationsQuery)).rows;

  const relationsByTableName: GenericObject = {};
  const tableByName: GenericObject = {};

  for (let i = 0; i < relations.length; i++) {
    const relation = relations[i];

    if (!relationsByTableName[relation.table_name]) {
      relationsByTableName[relation.table_name] = [];
    }

    relationsByTableName[relation.table_name].push(relation);
  }

  const resultByTableName: GenericObject = {};

  for (let i = 0; i < tableData.length; i++) {
    const table = tableData[i];

    const columnNames = Object.keys(await knexInstance(table.name).columnInfo());

    const obj = {
      name: snakeToCamel(table.name),
      tableName: table.name,
      alias: table.short,
      columns: columnNames,
      relations: [],
    };

    resultByTableName[table.name] = obj;
    tableByName[table.name] = table;
  }

  for (const [tableName, relations] of Object.entries(relationsByTableName)) {
    const foreignTableNameCount: { [key: string]: number } = {};

    for (let i = 0; i < relations.length; i++) {
      const foreignTableName = relations[i].foreign_table_name;

      if (!foreignTableNameCount[foreignTableName]) {
        foreignTableNameCount[foreignTableName] = 0;
      }

      foreignTableNameCount[foreignTableName]++;
    }

    for (let i = 0; i < relations.length; i++) {
      const relation = relations[i];

      const obj: GenericObject = {
        tableName: relation.foreign_table_name,
        relationType: "relationType.belongsToOne",
      };

      const columnName = relation.column_name as string;
      const foreignTableName = relation.foreign_table_name as string;

      const prefix = columnName.substring(0, columnName.length - 3);

      obj.name = snakeToCamel(prefix);

      const mainTableShort = tableByName[relation.table_name].short;
      const foreignTableShort = tableByName[foreignTableName].short;

      const uniquePart = prefix.substring(foreignTableName.length);
      const alias = `${foreignTableShort}${uniquePart}`;

      if (uniquePart) {
        obj.extra = {
          alias,
          prefix,
        };

        obj.condition = `${mainTableShort}.${prefix}_id = ${alias}.id and ${alias}.date_deleted is null`;
      }

      resultByTableName[tableName].relations.push(obj);

      resultByTableName[relation.foreign_table_name].relations.push({
        tableName: tableName,
        relationType: "relationType.hasMany",
        name: snakeToCamel(tableName),
      });
    }
  }

  const result = [];

  for (const [, table] of Object.entries(resultByTableName)) {
    result.push(table);
  }

  const header = `/** This code is automatically generated. DO NOT EDIT! */

import { relationType, Table } from "@lib/db/types";

export const tables: Table[] =`;

  writeFileSync(
    resolve(outDir, "tables.ts"),
    `${header} ${JSON.stringify(result, null, 2)
      .replace(/"relationType.belongsToOne"/g, `relationType.belongsToOne`)
      .replace(/"relationType.hasMany"/g, `relationType.hasMany`)}`,
  );

  process.exit(0);
})(knexInstance);
