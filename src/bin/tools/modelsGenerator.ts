import { resolve } from "path";
import { writeFileSync } from "fs";

import knex, { Knex } from "knex";

interface GenericObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const snakeToCamel = (value: string): string => value.replace(/(_\w)/g, (w) => w[1].toUpperCase());

const capitalizeFirstLetter = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const formatClassName = (tableName: string): string => capitalizeFirstLetter(snakeToCamel(tableName));

const { MODELS_OUT_DIR, MODELS_CLASS_FACTORY_OUT_DIR, POSTGRES_DSN } = process.env;

if (!MODELS_OUT_DIR) {
  console.error(` [modelsGenerator] : MODELS_OUT_DIR env is required but not presented`);

  process.exit(1);
}

if (!MODELS_CLASS_FACTORY_OUT_DIR) {
  console.error(` [modelsGenerator] : MODELS_CLASS_FACTORY_OUT_DIR env is required but not presented`);

  process.exit(1);
}

if (!POSTGRES_DSN) {
  console.error(` [modelsGenerator] : POSTGRES_DSN env is required but not presented`);

  process.exit(1);
}

const outModelsDir = resolve(MODELS_OUT_DIR);
const outClassFactoryDir = resolve(MODELS_CLASS_FACTORY_OUT_DIR);

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

  const tableDataByTableName: GenericObject = {};
  for (let i = 0; i < tableData.length; i++) {
    tableDataByTableName[tableData[i].name] = tableData[i];
  }

  const relations = (await knex.raw(relationsQuery)).rows;

  const relationsByTableName: GenericObject = {};

  for (let i = 0; i < relations.length; i++) {
    const relation = relations[i];

    if (!relationsByTableName[relation.table_name]) {
      relationsByTableName[relation.table_name] = [];
    }

    relationsByTableName[relation.table_name].push(relation);
  }

  const classFactoryTxtLines = [
    `/** This code is automatically generated. DO NOT EDIT! */

import { Knex } from "knex";

import { Model } from "@lib/db/model";
`,
  ];

  classFactoryTxtLines.push(
    `${tableData
      .map(
        (table: GenericObject) =>
          `import { ${formatClassName(table.name)} } from "@models/${formatClassName(table.name)}";`,
      )
      .join("\n")}`,
  );
  classFactoryTxtLines.push(`
export const createInstance = (modelName: string, knex: Knex | Knex.Transaction): Model => {
  switch (modelName) {`);

  classFactoryTxtLines.push(
    `${tableData
      .map(
        (table: GenericObject) =>
          `    case "${formatClassName(table.name)}":
      return new ${formatClassName(table.name)}(knex);`,
      )
      .join("\n")}`,
  );

  classFactoryTxtLines.push(
    `    default:
      throw new Error("Model cannot be found");
  }
};
`,
  );

  writeFileSync(resolve(outClassFactoryDir, "classFactoryModel.ts"), classFactoryTxtLines.join("\n"));

  for (let i = 0; i < tableData.length; i++) {
    const tableName = tableData[i].name;

    const columns = await knexInstance(tableName).columnInfo();

    const staticColumnsStrings: string[] = [];

    const fields: string[] = [];
    let hasGenericObject = false;

    const relationColumns = (relationsByTableName[tableName] ?? []).map(
      (relation: GenericObject) => relation.column_name,
    );

    for (const [key, value] of Object.entries(columns)) {
      const type = value.type;

      let fieldType = "";
      let defaultValue = "";
      switch (type) {
        case "uuid":
        case "timestamp without time zone":
        case "date":
        case "character varying":
        case "text":
          fieldType = "string";
          defaultValue = `""`;
          break;
        case "bigint":
        case "integer":
        case "numeric":
        case "smallint":
          fieldType = "number";
          defaultValue = "0";
          break;
        case "jsonb":
        case "json":
          fieldType = "GenericObject";
          defaultValue = "{}";
          hasGenericObject = true;
          break;
        case "boolean":
          fieldType = "boolean";
          defaultValue = "false";
          break;
        default:
          throw new Error(`Unknown type ${type}`);
      }

      // ID используются как строки, хотя в базе они bigint.
      if (key === "id") {
        fieldType = "string";
        defaultValue = `""`;
      }

      // Ключи по ID тоже используются как строки.
      if (relationColumns.includes(key)) {
        fieldType = "string";
        defaultValue = `""`;
      }

      const camelCaseFieldName = snakeToCamel(key);

      const fieldNamePart = `${camelCaseFieldName}${key === "id" ? "?" : ""}`;
      const fieldTypePart = `${fieldType}${value.nullable ? " | null" : ""}`;
      let fieldValuePart: string | undefined = ` = ${value.nullable ? "null" : defaultValue}`;
      if (key === "id") {
        fieldValuePart = undefined;
      }

      fields.push(`  ${fieldNamePart}: ${fieldTypePart}${fieldValuePart ?? ""};`);

      if (!tableDataByTableName[tableName]) {
        throw new Error(`Unknown table name ${tableName}`);
      }

      staticColumnsStrings.push(`      ${camelCaseFieldName}: "${tableDataByTableName[tableName].short}.${key}",`);
    }

    const className = capitalizeFirstLetter(snakeToCamel(tableName));

    const modelType = tableDataByTableName[tableName].is_file_table ? "FileModel" : "Model";

    const modelTxtLines = [
      `/** This code is automatically generated. DO NOT EDIT! */

/* eslint-disable @typescript-eslint/no-inferrable-types */

import { Knex } from "knex";

import { ${modelType} } from "@lib/db/model";
${hasGenericObject ? `import { GenericObject } from "@lib/db/types";\n` : ""}
/* ${tableDataByTableName[tableName].caption} */
export class ${className} extends ${modelType} {
  constructor(knex: Knex | Knex.Transaction) {
    super(knex, "${tableName}", "${
        tableDataByTableName[tableName].short
      }", ${className}.columns, ${className}.foreignKeys);
  }

  static id = "${tableDataByTableName[tableName].short}.id";
  static tableName = "${tableName}";
  static alias = "${tableDataByTableName[tableName].short}";`,
    ];

    modelTxtLines.push(fields.join("\n"));

    modelTxtLines.push(
      `  static get columns() {
    return {
${staticColumnsStrings.join("\n")}
    };
  }`,
    );

    modelTxtLines.push(
      `  static get foreigns(): Map<string, string> {
    return new Map([
      ${
        relationsByTableName[tableName]
          ? relationsByTableName[tableName]
              .map(
                (relation: GenericObject) =>
                  `["${snakeToCamel(relation.column_name)}", "${capitalizeFirstLetter(
                    snakeToCamel(relation.foreign_table_name),
                  )}"]`,
              )
              .join(",\n      ")
          : ""
      }
    ]);
  }`,
    );

    modelTxtLines.push(
      `  static get foreignKeys() {
    return [...this.foreigns.keys()];
  }`,
    );

    if (tableDataByTableName[tableName].is_file_table) {
      modelTxtLines.push(
        `  static get fileFolder() {
    return "${tableName}";
  }`,
      );
    }

    writeFileSync(
      resolve(outModelsDir, `${className}.ts`),
      modelTxtLines.join("\n\n") + `\n}\n\n/* eslint-enable @typescript-eslint/no-inferrable-types */\n`,
    );
  }

  process.exit(0);
})(knexInstance);
