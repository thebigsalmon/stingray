import { Knex } from "knex";

import { GenericObject } from "./types";

const ignoreFields = [
  "id", //
  "dateCreation",
  "dateChanges",
  "dateDeleted",
  "usrAccCreationId",
  "usrAccChangesId",
];

export abstract class Model {
  protected knex: Knex | Knex.Transaction;
  public id?: string;
  protected tableName: string;
  protected alias: string;
  protected columns: { [key: string]: string } = {};
  protected foreignKeys: string[] = [];

  constructor(
    knex: Knex | Knex.Transaction, //
    tableName: string,
    alias: string,
    columns: GenericObject,
    foreignKeys: string[],
  ) {
    this.knex = knex;
    this.tableName = tableName;
    this.alias = alias;
    this.columns = columns;
    this.foreignKeys = foreignKeys;
  }

  private extractFieldsToObj(acceptColumns?: string[]): GenericObject {
    const obj: GenericObject = {};

    Object.keys(this.columns).forEach((c) => {
      const column = this.columns[c].substring(this.alias.length + 1);

      if (ignoreFields.includes(c)) {
        return;
      }

      // Если глобальный идентификатор передан, то нужно его записать.
      // Но если значение не указано, то игнорировать его, чтобы его присвоила СУБД.
      if (c === "guid" && !(this as GenericObject)[c]) {
        return;
      }

      // Если acceptColumns не передан, либо передан массив нулевой длины, функция его игнорирует.
      // Если же в массиве есть элементы, функция пропустит только те поля, которые есть в массиве.
      if (acceptColumns && acceptColumns.length && !acceptColumns.includes(this.columns[c])) {
        return;
      }

      obj[column] = (this as GenericObject)[c];
    });

    return obj;
  }

  async insert({ usrAccCreationId }: { usrAccCreationId: string | null }) {
    const obj = this.extractFieldsToObj();

    if (this.columns["usrAccCreationId"]) {
      obj["usr_acc_creation_id"] = usrAccCreationId;
    }
    if (this.columns["usrAccChangesId"]) {
      obj["usr_acc_changes_id"] = usrAccCreationId;
    }

    const returningColumns = ["id"];
    if (this.columns["guid"]) {
      returningColumns.push("guid");
    }
    if (this.columns["dateCreation"]) {
      returningColumns.push("date_creation");
    }
    if (this.columns["dateChanges"]) {
      returningColumns.push("date_changes");
    }

    const result = await this.knex(this.tableName) //
      .insert(obj)
      .returning(returningColumns);

    this.id = result[0].id.toString();

    if (this.columns["guid"]) {
      (this as GenericObject).guid = result[0].guid;
    }
    if (this.columns["dateCreation"]) {
      (this as GenericObject).dateCreation = result[0].date_creation;
    }
    if (this.columns["dateChanges"]) {
      (this as GenericObject).dateChanges = result[0].date_changes;
    }

    return this;
  }

  async update(
    existing: typeof this | null,
    {
      usrAccChangesId,
      columns,
    }: {
      usrAccChangesId: string | null;
      columns: string[];
    },
  ) {
    if (existing) {
      const isChanged = this.differs(existing, columns);

      if (!isChanged) return;
    }

    const obj = this.extractFieldsToObj(columns);

    const returningColumns = [];

    if (this.columns["usrAccChangesId"]) {
      obj["usr_acc_changes_id"] = usrAccChangesId;
    }
    if (this.columns["dateChanges"]) {
      obj["date_changes"] = this.knex.raw("timezone('utc'::text, now())");
      returningColumns.push("date_changes");
    }

    const count = (
      await this.knex(this.tableName) //
        .where("id", this.id)
        .count()
    )[0].count;

    if (count === 0) {
      throw new Error("record not found");
    }

    const result = await this.knex(this.tableName) //
      .where("id", "=", this.id!)
      .update(obj)
      .returning(returningColumns);

    if (this.columns["dateChanges"]) {
      (this as GenericObject).dateChanges = result[0].date_changes;
    }
  }

  async delete({ usrAccChangesId }: { usrAccChangesId: string | null }) {
    const obj = this.extractFieldsToObj(["dateDeleted"]);

    const returningColumns = ["date_deleted"];
    obj["date_deleted"] = this.knex.raw("timezone('utc'::text, now())");

    if (this.columns["usrAccChangesId"]) {
      obj["usr_acc_changes_id"] = usrAccChangesId;
    }
    if (this.columns["dateChanges"]) {
      obj["date_changes"] = this.knex.raw("timezone('utc'::text, now())");
      returningColumns.push("date_changes");
    }

    const result = await this.knex(this.tableName) //
      .where("id", this.id!)
      .update(obj)
      .returning(returningColumns);

    (this as GenericObject).dateDeleted = result[0].date_deleted;

    if (this.columns["dateChanges"]) {
      (this as GenericObject).dateChanges = result[0].date_changes;
    }
  }

  async bulkDelete({ ids, usrAccChangesId }: { ids: string[]; usrAccChangesId: string | null }) {
    await this.knex(this.tableName) //
      .whereIn("id", ids)
      .update({
        usr_acc_changes_id: usrAccChangesId,
        date_changes: this.knex.raw("timezone('utc'::text, now())"),
        date_deleted: this.knex.raw("timezone('utc'::text, now())"),
      });
  }

  async restore({ usrAccChangesId }: { usrAccChangesId: string | null }) {
    const obj = this.extractFieldsToObj(["dateDeleted"]);

    const returningColumns = ["date_deleted"];
    obj["date_deleted"] = null;

    if (this.columns["usrAccChangesId"]) {
      obj["usr_acc_changes_id"] = usrAccChangesId;
    }
    if (this.columns["dateChanges"]) {
      obj["date_changes"] = this.knex.raw("timezone('utc'::text, now())");
      returningColumns.push("date_changes");
    }

    const result = await this.knex(this.tableName) //
      .where("id", this.id!)
      .update(obj)
      .returning(returningColumns);

    (this as GenericObject).dateDeleted = result[0].date_deleted;

    if (this.columns["dateChanges"]) {
      (this as GenericObject).dateChanges = result[0].date_changes;
    }
  }

  async bulkRestore({ ids, usrAccChangesId }: { ids: string[]; usrAccChangesId: string | null }) {
    await this.knex(this.tableName) //
      .whereIn("id", ids)
      .update({
        usr_acc_changes_id: usrAccChangesId,
        date_changes: this.knex.raw("timezone('utc'::text, now())"),
        date_deleted: null,
      });
  }

  fromJSON(json: GenericObject) {
    Object.keys(this.columns).forEach((c) => {
      // eslint-disable-next-line no-prototype-builtins
      if (!json.hasOwnProperty(c)) {
        return;
      }

      (this as GenericObject)[c] = json[c];
    });

    return this;
  }

  differs(compare: typeof this, columns: string[]): boolean {
    const columnsByDdColumnName: GenericObject = {};

    const staticColumns = Object.getPrototypeOf(this).constructor.columns;

    for (const [key, value] of Object.entries(staticColumns) as string[][]) {
      columnsByDdColumnName[value] = key;
    }

    for (let i = 0; i < columns.length; i++) {
      const column = columnsByDdColumnName[columns[i]];

      // eslint-disable-next-line no-prototype-builtins
      if (!this.hasOwnProperty(column)) {
        throw new Error(`source model does not have property ${column}`);
      }

      // eslint-disable-next-line no-prototype-builtins
      if (!compare.hasOwnProperty(column)) {
        throw new Error(`compare model does not have property ${column}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (JSON.stringify((this as any)[column]) !== JSON.stringify((compare as any)[column])) {
        return true;
      }
    }

    return false;
  }

  columnByName({ columnName, withAlias }: { columnName: string; withAlias: boolean }): string {
    const columnsByDdColumnName: GenericObject = {};

    const staticColumns = Object.getPrototypeOf(this).constructor.columns;

    for (const [key, value] of Object.entries(staticColumns) as string[][]) {
      columnsByDdColumnName[key] = value;
    }

    let column = columnsByDdColumnName[columnName];

    if (!withAlias && column) {
      const aliasPart = `${this.alias}.`;

      if (column.slice(0, aliasPart.length) === aliasPart) {
        column = column.slice(aliasPart.length);
      }
    }

    return column;
  }

  getTableName(): string {
    return this.tableName;
  }

  getKnex(): Knex | Knex.Transaction {
    return this.knex;
  }

  async getModeldGuidById(): Promise<string> {
    if (!this.columns["id"]) {
      throw new Error("column id doesn't exist");
    }
    if (!this.columns["guid"]) {
      throw new Error("column guid doesn't exist");
    }

    const result = await this.knex(this.getTableName()) //
      .select("guid")
      .where("id", this.id!);

    let guid = "";
    if (result.length === 1) {
      guid = result[0].guid;
    }

    (this as GenericObject).guid = guid;

    return guid;
  }
}

export abstract class FileModel extends Model {
  public fileBase64: string | undefined;
  public mimeType: string | undefined;
  public fileChecksum: string | undefined;
  public filePath: string | undefined;
  public fileSize = 0;

  fromJSON(json: GenericObject) {
    const fileColumns = {
      ...this.columns,
      fileBase64: "",
      mimeType: "",
    };

    Object.keys(fileColumns).forEach((c) => {
      // eslint-disable-next-line no-prototype-builtins
      if (!json.hasOwnProperty(c)) {
        return;
      }

      (this as GenericObject)[c] = json[c];
    });

    return this;
  }

  static get fileFolder() {
    return "";
  }
}
