import { Knex } from "knex";

export const snakeToCamel = (value: string): string => value.replace(/(_\w)/g, (w) => w[1].toUpperCase());

export const normalizeDirection = (d: string): string => {
  const l = d.toLowerCase();

  if (l === "desc" || l === "descend") {
    return "DESC";
  }

  if (l === "asc" || l === "ascend") {
    return "ASC";
  }

  throw new Error("Direction cannot be normalized");
};

export const getSqlTime = async (knex: Knex | Knex.Transaction): Promise<string> => {
  const sqlTime = await knex.raw("select NOW() as now");
  if (sqlTime.rows.length == 1) {
    return sqlTime.rows[0].now.toISOString();
  }

  throw new Error("SQL time cannot be extracted");
};

export const getGuidFieldNameByIdFieldName = (fieldId: string): string => {
  if (fieldId.slice(fieldId.length - 2) !== "Id") {
    throw new Error("Foreign field should be Id field");
  }

  return fieldId.slice(0, fieldId.length - 2) + "Guid";
};
