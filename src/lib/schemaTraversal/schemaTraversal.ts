import { GenericObject } from "../db/types";

const traversalObject = (
  source: GenericObject,
  properties: GenericObject,
  parent: GenericObject,
  required: string[],
  path: string,
) => {
  Object.keys(properties).forEach((propertyName) => {
    // Обрабатываем необязательный параметр в response.
    // eslint-disable-next-line no-prototype-builtins
    if (!required?.includes(propertyName) && !source.hasOwnProperty(propertyName)) {
      return;
    }

    if (properties[propertyName].bypass) {
      parent[propertyName] = source[propertyName];

      return;
    }

    // Данная ситуация может возникнуть при использовании типа вроде
    // entity: EntityType | OtherEntityType | null
    // Библиотека поддерживает только использование типа
    // entity: EntityType | null, где EntityType - объект.
    if (properties[propertyName].anyOf) {
      if (properties[propertyName].anyOf.length > 2) {
        throw new Error(
          `Property "${propertyName}" resolved to anyOf but is does not satisfy anyOf requirements (elements count is more than 2)`,
        );
      }

      const objectTypes = properties[propertyName].anyOf.filter((item: GenericObject) => item.type === "object");
      if (objectTypes.length > 1) {
        throw new Error(
          `Property "${propertyName}" resolved to anyOf but is does not satisfy anyOf requirements (object types count is more than 1)`,
        );
      }

      const nullTypes = properties[propertyName].anyOf.filter((item: GenericObject) => item.type === "null");
      if (nullTypes.length > 1) {
        throw new Error(
          `Property "${propertyName}" resolved to anyOf but is does not satisfy anyOf requirements (null types count is more than 1)`,
        );
      }

      if (
        properties[propertyName].anyOf.some((item: GenericObject) => item.type !== "object" && item.type !== "null")
      ) {
        throw new Error(
          `Property "${propertyName}" resolved to anyOf but is does not satisfy anyOf requirements (found a type that is not null or object)`,
        );
      }

      if (nullTypes.length !== 0 && source[propertyName] === null) {
        parent[propertyName] = null;

        return;
      }

      parent[propertyName] = {};

      if (!source[propertyName]) {
        if (required?.includes(propertyName)) {
          const p = path.split("").splice(1).join("");

          throw new Error(`Property "${p}.${propertyName}" is undefined in source`);
        }
      } else {
        traversalObject(
          source[propertyName],
          objectTypes[0].properties,
          parent[propertyName],
          objectTypes[0].required,
          `${path}.${propertyName}`,
        );
      }

      return;
    }

    if (properties[propertyName].type === "object") {
      parent[propertyName] = {};

      if (!source[propertyName]) {
        if (required?.includes(propertyName)) {
          const p = path.split("").splice(1).join("");

          throw new Error(`Property "${p}.${propertyName}" is undefined in source`);
        }
      } else {
        traversalObject(
          source[propertyName],
          properties[propertyName].properties,
          parent[propertyName],
          properties[propertyName].required,
          `${path}.${propertyName}`,
        );
      }

      return;
    }

    if (properties[propertyName].type === "array") {
      const container: any[] = [];

      traversalArray(source[propertyName], properties[propertyName].items, container, `${path}.${propertyName}`);

      parent[propertyName] = container;

      return;
    }

    parent[propertyName] = source[propertyName];
  });
};

const traversalArray = (source: any[], items: GenericObject, container: any[], path: string) => {
  for (let i = 0; i < source.length; i++) {
    switch (items.type) {
      case "object": {
        const obj = {};

        traversalObject(source[i], items.properties, obj, items.required, `${path}[${i}]`);

        container[i] = obj;

        break;
      }
      case "array": {
        // TODO проверить этот кейс, когда он встретится на практике.
        const subContainer: any[] = [];

        traversalArray(source[i], items.items, subContainer, `${path}[${i}]`);

        container[i] = subContainer;

        break;
      }
      default:
        container[i] = source[i];
    }
  }
};

export const generateObject = (source: GenericObject, schema: GenericObject): GenericObject => {
  const result: GenericObject = {};

  traversalObject(source, schema.properties, result, schema.required, "");

  return result;
};
