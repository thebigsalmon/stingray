import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import knex from "knex";

import { tablesGeneratorFn } from "./common/tablesGeneratorFn";

interface GenericObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export default async ({
  tablesOutDir: outDir, //
  postgresDsn,
}: {
  tablesOutDir: string;
  postgresDsn: string;
}) => {
  const knexInstance = knex<any, any[]>({
    client: "pg",
    connection: postgresDsn,
    useNullAsDefault: false,
  });

  const tables = await tablesGeneratorFn(knexInstance);

  const modelClassTypeLines = tables.map(
    (table: GenericObject) => `import {${table.modelClassType}} from "@models/${table.modelClassType}";`,
  );

  const header = `/** This code is automatically generated. DO NOT EDIT! */

import { relationType, Table } from "@thebigsalmon/stingray/cjs/db/types";

${modelClassTypeLines.join("\n")}

export const tables: Table[] =`;

  await writeFile(
    resolve(outDir, "tables.ts"),
    `${header} ${JSON.stringify(tables, null, 2)
      .replace(/"relationType.belongsToOne"/g, `relationType.belongsToOne`)
      .replace(/"relationType.hasMany"/g, `relationType.hasMany`)
      .replace(/"modelClassType": "([a-zA-Z0-9]*)"/g, '"modelClassType": $1')}`,
  );
};
