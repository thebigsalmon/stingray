import { Knex } from "knex";

import { Model } from "../db/model";
import { relationSyncResultItem } from "../db/relationsSync";
import { GenericObject, relationsSyncState } from "../db/types";
import { getGuidFieldNameByIdFieldName } from "../db/util";

type createInstanceFn = (modelName: string, knex: Knex | Knex.Transaction) => Model;

let createInstance!: createInstanceFn;

export const setCreateInstance = (createInstanceParam: createInstanceFn): void => {
  createInstance = createInstanceParam;
};

export const isEmpty = (obj: GenericObject | null | undefined) => {
  if (!obj) return true;

  return Object.keys(obj).length === 0;
};

export const copyObject = (obj: any) => {
  return JSON.parse(JSON.stringify(obj));
};

export const stringAsArrayElement = (s: string | null | undefined) => {
  if (!s) return [] as string[];

  return [s] as string[];
};

export const objectToXml = (obj: GenericObject): string => {
  let xml = "";
  for (const prop in obj) {
    xml += obj[prop] instanceof Array ? "" : "<" + prop + ">";
    if (obj[prop] instanceof Array) {
      for (const array in obj[prop]) {
        xml += "<" + prop + ">";
        xml += objectToXml(new Object(obj[prop][array]));
        xml += "</" + prop + ">";
      }
    } else if (typeof obj[prop] == "object") {
      xml += objectToXml(new Object(obj[prop]));
    } else {
      xml += obj[prop];
    }
    xml += obj[prop] instanceof Array ? "" : "</" + prop + ">";
  }
  xml = xml.replace(/<\/?[0-9]{1,}>/g, "");
  return xml;
};

export const resolveEditBodyFromDictionary = (
  editBody: GenericObject,
  entityName: string,
  fieldName: string,
  dictionary: GenericObject,
  columns: string[],
) => {
  const result = copyObject(editBody);

  const fieldFullName = `${entityName}${fieldName}`;

  if (result[fieldFullName]) {
    result[entityName] = {
      new: null,
      old: null,
    };

    const guidNew = result[fieldFullName]["new"];
    if (guidNew) {
      result[entityName]["new"] = {};

      columns.forEach((c) => {
        result[entityName]["new"][c] = dictionary[guidNew][c] ? dictionary[guidNew][c] : null;
      });
    }

    const guidOld = result[fieldFullName]["old"];
    if (guidOld) {
      result[entityName]["old"] = {};

      columns.forEach((c) => {
        result[entityName]["old"][c] = dictionary[guidOld][c] ? dictionary[guidOld][c] : null;
      });
    }

    delete result[fieldFullName];
  }

  return result;
};

export const differenceEditBody = async <T extends Model | null>({
  existing,
  desirable,
  columns,
}: {
  existing: T;
  desirable: T;
  columns: string[];
}): Promise<GenericObject> => {
  const editBody: GenericObject = {};

  if (!existing && !desirable) {
    return editBody;
  }

  const existingStaticColumns = existing ? Object.getPrototypeOf(existing).constructor.columns ?? [] : [];
  const desirableStaticColumns = desirable ? Object.getPrototypeOf(desirable).constructor.columns ?? [] : [];

  const existingForeignColumns = existing ? Object.getPrototypeOf(existing).constructor.foreigns ?? [] : [];
  const desirableForeignColumns = desirable ? Object.getPrototypeOf(desirable).constructor.foreigns ?? [] : [];

  const columnsByDdColumnName: Map<string, string> = new Map();
  for (const [key, value] of [...Object.entries(existingStaticColumns), ...Object.entries(desirableStaticColumns)]) {
    columnsByDdColumnName.set(String(value), key);
  }

  for (let i = 0; i < columns.length; i++) {
    const column = columnsByDdColumnName.get(columns[i]);

    if (!column) {
      continue;
    }

    // eslint-disable-next-line no-prototype-builtins
    const isOldEmpty = !existing || !existing.hasOwnProperty(column);
    // eslint-disable-next-line no-prototype-builtins
    const isNewEmpty = !desirable || !desirable.hasOwnProperty(column);

    if (
      isOldEmpty !== isNewEmpty ||
      JSON.stringify((existing as any)[column]) !== JSON.stringify((desirable as any)[column])
    ) {
      let isForeign = false;

      if (!isOldEmpty) {
        if (existingForeignColumns && existingForeignColumns.get(column)) {
          isForeign = true;
        }
      } else {
        if (!isNewEmpty) {
          if (desirableForeignColumns && desirableForeignColumns.get(column)) {
            isForeign = true;
          }
        }
      }

      if (!isForeign) {
        // Если это поле - это не внешний ключ, то просто пишем старое и новое значение в объект.
        editBody[column] = {
          old: !isOldEmpty ? (existing as any)[column] : null,
          new: !isNewEmpty ? (desirable as any)[column] : null,
        };
      } else {
        // Если это поле - это внешний ключ, то нужно заменить его на guid.
        const columnGuid = getGuidFieldNameByIdFieldName(column);
        editBody[columnGuid] = {};

        let oldForeignGuid = null;
        if (!isOldEmpty) {
          const entityName = existingForeignColumns.get(column);
          const oldValueId = (existing as any)[column];

          if (oldValueId) {
            const foreignEntity = createInstance(entityName, existing.getKnex()).fromJSON({
              //
              id: oldValueId,
            });
            oldForeignGuid = await foreignEntity.getModeldGuidById();
          }
        }

        let newForeignGuid = null;
        if (!isNewEmpty) {
          const entityName = desirableForeignColumns.get(column);
          const newValueId = (desirable as any)[column];

          if (newValueId) {
            const foreignEntity = createInstance(entityName, desirable.getKnex()).fromJSON({
              //
              id: newValueId,
            });
            newForeignGuid = await foreignEntity.getModeldGuidById();
          }
        }

        editBody[columnGuid] = {
          old: oldForeignGuid,
          new: newForeignGuid,
        };
      }
    }
  }

  return editBody;
};

export const differenceEditBodyByRelation = async <T extends Model>({
  relationSyncResult,
  columns,
}: {
  relationSyncResult: relationSyncResultItem<T>[];
  columns: string[];
}): Promise<GenericObject[]> => {
  const editBody: GenericObject[] = [];

  for (let i = 0; i < relationSyncResult.length; i++) {
    if (relationSyncResult[i].state === relationsSyncState.untouched) {
      continue;
    }

    let op = "";
    switch (relationSyncResult[i].state) {
      case relationsSyncState.inserted:
        op = "add";
        break;
      case relationsSyncState.restored:
        op = "add";
        break;
      case relationsSyncState.deleted:
        op = "remove";
        break;
      case relationsSyncState.updated:
        op = "edit";
        break;
    }

    const entity = await differenceEditBody({
      existing: relationSyncResult[i].from,
      desirable: relationSyncResult[i].to,
      columns,
    });

    const guid = await (relationSyncResult[i].to as Model).getModeldGuidById();

    editBody.push({
      guid,
      op,
      entity,
    });
  }

  return editBody;
};

export const compare = (
  var1: string | number | boolean | null | undefined,
  var2: string | number | boolean | null | undefined,
  direction: string | null | undefined,
): number => {
  if ((var1 === null || var1 === undefined) && var2 !== null && var2 !== undefined) {
    return 1;
  }
  if (var1 !== null && var1 !== undefined && (var2 === null || var2 === undefined)) {
    return -1;
  }
  if ((var1 === null || var1 === undefined) && (var2 === null || var2 === undefined)) {
    return 0;
  }

  const sortForward = !direction || direction.toLowerCase() !== "desc" ? 1 : -1;
  const sortBackward = !direction || direction.toLowerCase() !== "desc" ? -1 : 1;

  if (var1! > var2!) {
    return sortForward;
  }
  if (var1! < var2!) {
    return sortBackward;
  }

  return 0;
};
