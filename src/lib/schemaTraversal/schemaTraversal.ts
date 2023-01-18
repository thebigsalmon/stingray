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
