import Ajv from "ajv";

import {
  CODE_INVALID_PARAMS, //
  CODE_METHOD_NOT_FOUND,
  CODE_REQUEST_INVALID,
} from "./errors";
import { GenericObject } from "../db/types";

const ajv = new Ajv();

export class JsonRpcServerError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);

    this.code = code;
  }
}

export class JsonRpcRequestValidationError extends Error {
  code = CODE_INVALID_PARAMS;

  data: GenericObject;

  constructor(data: GenericObject) {
    super("Invalid request");

    this.data = data;
  }
}

type jsonRpcParams = { sessId: string } & GenericObject;

export interface jsonRpcRequest extends GenericObject {
  jsonrpc: string;
  id: string;
  method: string;
  params?: jsonRpcParams;
}

export type JsonRpcMiddleware = (params: {
  params: jsonRpcParams;
  headers: JsonRpcRequestHeaders;
}) => Promise<jsonRpcParams>;

export type JsonRpcRequestHeaders = {
  jsonrpc: string; //
  id: string;
  method: string;
};

export abstract class JsonRpcHandler<Request extends GenericObject, Response extends GenericObject | void> {
  abstract methodName: string;
  abstract middlewares: JsonRpcMiddleware[];
  abstract handle(request: Request, rawRequest?: JsonRpcRequestHeaders): Promise<Response>;
}

const schema = {
  type: "object",
  properties: {
    jsonrpc: { type: "string" },
    id: { type: "string" },
    method: { type: "string" },
    params: { type: "object" },
  },
  required: [
    "jsonrpc", //
    "id",
    "method",
  ],
  additionalProperties: false,
};

export class JsonRpcServer {
  private handlers: { [methodName: string]: JsonRpcHandler<GenericObject, GenericObject> } = {};

  private requestValidators: { [methodName: string]: (request: GenericObject) => GenericObject | null } = {};

  private responsePickers: { [methodName: string]: (response: GenericObject) => GenericObject } = {};

  registerHandler(handler: JsonRpcHandler<GenericObject, GenericObject>): void {
    this.handlers[handler.methodName] = handler;
  }

  registerRequestValidator(methodName: string, validator: (request: GenericObject) => GenericObject | null): void {
    this.requestValidators[methodName] = validator;
  }

  registerResponsePicker(methodName: string, picker: (response: GenericObject) => GenericObject): void {
    this.responsePickers[methodName] = picker;
  }

  async handle(request: jsonRpcRequest): Promise<GenericObject> {
    const validate = ajv.compile<jsonRpcRequest>(schema);
    if (!validate(request)) {
      throw new JsonRpcServerError("Invalid jsonRPC request", CODE_REQUEST_INVALID);
    }

    const {
      id, //
      method,
      jsonrpc,
    } = request;

    const requestHeaders: JsonRpcRequestHeaders = {
      id,
      method,
      jsonrpc,
    };

    const handler = this.handlers[method];
    if (!handler) {
      throw new JsonRpcServerError("method not found", CODE_METHOD_NOT_FOUND);
    }

    let { params } = request;
    if (!params) {
      params = {} as jsonRpcParams;
    }

    const validationErrors = this.requestValidators[method](params);
    if (validationErrors) {
      throw new JsonRpcRequestValidationError(validationErrors);
    }

    for (let i = 0; i < handler.middlewares.length; i++) {
      params = await handler.middlewares[i]({ params, headers: requestHeaders });
    }

    const handlerResult = await handler.handle(params || {}, requestHeaders);

    const responsePicker = this.responsePickers[method];
    const result = responsePicker ? responsePicker(handlerResult) : handlerResult;

    return {
      id, //
      jsonrpc,
      result,
    };
  }
}
