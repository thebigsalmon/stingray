import { GenericObject } from "../db/types";

export const CODE_INTERNAL_SERVER_ERROR = -32000;
export const CODE_REQUEST_INVALID = -32600;
export const CODE_METHOD_NOT_FOUND = -32601;
export const CODE_INVALID_PARAMS = -32602;

export class ClientError extends Error {
  code: number;

  constructor(
    public message: string, //
    private description: string,
    private data?: GenericObject,
  ) {
    super();

    this.code = CODE_INTERNAL_SERVER_ERROR;
  }

  public getData() {
    const result: GenericObject = {
      description: this.description,
      ...this.data,
    };

    return result;
  }
}

export abstract class StingrayError<T extends GenericObject> extends Error {
  public readonly code = CODE_INTERNAL_SERVER_ERROR;

  abstract errorTypeMnemocode: string;
  abstract message: string;

  constructor(protected data?: T) {
    super();
  }

  public getData(): { errorTypeMnemocode: string } & { data: T | undefined } {
    return {
      errorTypeMnemocode: this.errorTypeMnemocode,
      data: this.data,
    };
  }
}
