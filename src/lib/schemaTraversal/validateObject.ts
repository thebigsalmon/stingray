import Ajv from "ajv";

import { GenericObject } from "../db/types";

const ajv = new Ajv();

export const validateObject = (schema: GenericObject, source: GenericObject): GenericObject | null => {
  const validate = ajv.compile(schema);

  const isValid = validate(source);

  if (isValid) {
    return null;
  }

  return validate.errors ?? {};
};
