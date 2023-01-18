export interface GenericObject {
  [key: string]: any;
}

export type ComparisonOperations = "<=" | ">=" | "<" | ">" | "=";

export enum relationType {
  hasOne = "hasOne",
  belongsToOne = "belongsToOne",
  hasMany = "hasMany",
}

export enum relationsSyncState {
  inserted = "inserted",
  updated = "updated",
  untouched = "untouched",
  deleted = "deleted",
  restored = "restored",
}

export interface Relation {
  name?: string;
  tableName: string;
  relationType: relationType;
  condition?: string;
  extra?: {
    alias: string;
    prefix: string;
  };
}

export interface Table {
  name?: string;
  tableName: string;
  relations?: Relation[];
  alias: string;
  columns: string[];
}
