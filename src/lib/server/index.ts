import { IncomingHttpHeaders } from "http";

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

export type JsonRpcParams = GenericObject;

export interface jsonRpcRequest extends GenericObject {
  jsonrpc: string;
  id: string;
  method: string;
  params?: JsonRpcParams;
}

export type JsonRpcMiddleware = (params: {
  params: JsonRpcParams;
  headers: JsonRpcRequestHeaders;
  httpHeaders: IncomingHttpHeaders;
}) => Promise<JsonRpcParams>;

export type JsonRpcRequestHeaders = {
  jsonrpc: string; //
  id: string;
  method: string;
};

type ResponseBody<T> = T;

export type ResponseFullSigrature<T> = { responseBody?: T; responseHeaders?: GenericObject };

export abstract class JsonRpcHandler<Request extends GenericObject, Response extends GenericObject | void> {
  abstract methodName: string;
  abstract middlewares: JsonRpcMiddleware[];
  abstract handle(
    request: Request,
    rawRequest?: JsonRpcRequestHeaders,
  ): Promise<ResponseBody<Response> | ResponseFullSigrature<Response>>;
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

const isResponseFullSigrature = <T>(source: GenericObject): source is ResponseFullSigrature<T> => {
  if (source.responseBody) {
    return true;
  }

  if (source.responseHeaders) {
    return true;
  }

  return false;
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

  async handle(
    request: jsonRpcRequest,
    httpRequestHeaders: IncomingHttpHeaders,
  ): Promise<{ jsonRpcResponse: GenericObject; jsonRpcHeaders: GenericObject }> {
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
      params = {} as JsonRpcParams;
    }

    const validator = this.requestValidators[method];
    const validationErrors = validator ? validator(params) : false;

    if (validationErrors) {
      throw new JsonRpcRequestValidationError(validationErrors);
    }

    for (let i = 0; i < handler.middlewares.length; i++) {
      params = await handler.middlewares[i]({
        params, //
        headers: requestHeaders,
        httpHeaders: httpRequestHeaders,
      });
    }

    const handlerResult = await handler.handle(params || {}, requestHeaders);

    let handlerResponseBody: ResponseBody<Response>;
    let handlerResponseHeaders: GenericObject;

    if (isResponseFullSigrature<Response>(handlerResult)) {
      handlerResponseBody = handlerResult.responseBody ?? ({} as Response);
      handlerResponseHeaders = handlerResult.responseHeaders ?? {};
    } else {
      handlerResponseBody = handlerResult as Response;
      handlerResponseHeaders = {};
    }

    const responsePicker = this.responsePickers[method];
    const result = responsePicker ? responsePicker(handlerResponseBody) : handlerResponseBody;

    return {
      jsonRpcResponse: {
        id, //
        jsonrpc,
        result,
      },
      jsonRpcHeaders: handlerResponseHeaders,
    };
  }
}
