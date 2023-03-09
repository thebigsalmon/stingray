import {
  Server, //
  RequestListener,
  IncomingMessage,
  ServerResponse,
  createServer,
} from "http";

import {
  JsonRpcRequestValidationError, //
  JsonRpcServer,
  JsonRpcServerError,
} from "./index";
import { ClientError, StingrayError } from "./errors";
import { StopwatchTimer } from "../helpers/datetime";
import { Logger } from "../log";
import { GenericObject } from "../db/types";

const handleError = (
  err: Error,
  res: ServerResponse,
  requestHeaders: {
    methodName?: string; //
    domain: string;
    messageId: string;
  },
  responseHeaders: GenericObject,
  logger: Logger,
) => {
  if (requestHeaders.methodName) {
    // TODO add event
    // metrics.handleJsonRpcRequestError({ method: requestHeaders.methodName, domain: requestHeaders.domain });
  }

  if (err instanceof JsonRpcRequestValidationError) {
    res.writeHead(200, responseHeaders);
    res.end(
      JSON.stringify({
        id: requestHeaders.messageId,
        jsonrpc: "2.0",
        error: { code: err.code, message: "Invalid request body", data: err.data },
      }),
    );

    logger.error("Method ended with an error", {
      errorMessage: err.message,
      methodName: requestHeaders.methodName,
      messageId: requestHeaders.messageId,
    });

    return;
  }

  if (err instanceof JsonRpcServerError) {
    res.writeHead(200, responseHeaders);
    res.end(
      JSON.stringify({
        id: requestHeaders.messageId, //
        jsonrpc: "2.0",
        error: { code: err.code, message: err.message },
      }),
    );

    logger.error("Method ended with an error", {
      errorMessage: err.message,
      methodName: requestHeaders.methodName,
      messageId: requestHeaders.messageId,
    });

    return;
  }

  if (err instanceof ClientError || err instanceof StingrayError) {
    const data = err.getData();

    res.writeHead(200, responseHeaders);
    res.end(
      JSON.stringify({
        id: requestHeaders.messageId,
        jsonrpc: "2.0",
        error: {
          code: err.code, //
          message: err.message,
          data,
        },
      }),
    );

    logger.error("Method ended with an error", {
      errorMessage: err.message,
      description: data.description,
      methodName: requestHeaders.methodName,
      messageId: requestHeaders.messageId,
    });

    return;
  }

  res.writeHead(500, responseHeaders);
  res.end("Internal server error");

  logger.error("Method ended with an unknown error", {
    errorMessage: err.message,
    methodName: requestHeaders.methodName,
    messageId: requestHeaders.messageId,
  });
};

const handleJsonRpcRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  responseHeaders: GenericObject,
  jsonRpcServer: JsonRpcServer,
  logger: Logger,
) => {
  const stopwatchTimer = new StopwatchTimer();

  let requestHeaders: {
    methodName?: string; //
    domain: string;
    messageId: string;
  } = {
    domain: "", //
    messageId: "",
  };

  try {
    res.setHeader("Content-Type", "application/json");

    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }

    // TODO добавить проверку парсинга с кодом ошибки -32700
    const body = JSON.parse(Buffer.concat(buffers).toString());

    const methodName = body?.method;
    const messageId = body?.id;
    let domain = "";

    if (methodName) {
      const [apiVersion, shortMethodName] = methodName.split(".");

      if (apiVersion && shortMethodName) {
        domain = `${apiVersion}.${shortMethodName}`;
      }
    }

    requestHeaders = {
      methodName,
      domain,
      messageId,
    };

    if (methodName && messageId) {
      logger.info("Method started", {
        methodName,
        messageId,
      });
    }
    // TODO add event

    // metrics.handleJsonRpcRequestStart({
    //   method: methodName, //
    //   domain,
    // });

    const { jsonRpcResponse, jsonRpcHeaders } = await jsonRpcServer.handle(body, req.headers);

    res.writeHead(200, { ...responseHeaders, ...jsonRpcHeaders });

    res.end(JSON.stringify(jsonRpcResponse));

    const duration = stopwatchTimer.getElapsedMilliSecondsNumber();
    // TODO add event

    // metrics.handleJsonRpcRequestSuccess({
    //   method: methodName, //
    //   domain,
    //   duration,
    // });

    if (methodName && messageId) {
      logger.info("Method ended", {
        methodName,
        messageId,
        duration: `${duration} ms`,
      });
    }

    return;
  } catch (e) {
    handleError(
      e as Error, //
      res,
      requestHeaders,
      responseHeaders,
      logger,
    );
  }
};

const requestListener: (
  jsonRpcServer: JsonRpcServer,
  logger: Logger,
  headersFn: () => GenericObject,
) => RequestListener =
  (jsonRpcServer: JsonRpcServer, logger: Logger, headersFn: () => GenericObject) => async (req, res) => {
    const headers = headersFn
      ? headersFn()
      : {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS, POST",
          "Access-Control-Max-Age": 2592000, // 30 days
          "Access-Control-Allow-Headers": "*",
        };

    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();

      return;
    }

    // TODO move prefix to param
    if (req.method === "POST" && req.url === "/stingray/jrpc") {
      await handleJsonRpcRequest(req, res, headers, jsonRpcServer, logger);

      return;
    }

    // TODO добавить нормальную проверку по домену для cors - сейчас проверяет тупо по *, и не отвечает в случае недоступного метода.
    // res.writeHead(405, headers);
    // res.end(`${req.method} is not allowed for the request.`);

    res.writeHead(500, headers);
    res.end("Not found");
  };

export function createJsonRpcHttpServer(
  jsonRpcServer: JsonRpcServer,
  logger: Logger,
  headersFn: () => GenericObject,
): Server {
  const httpServer = createServer(requestListener(jsonRpcServer, logger, headersFn));

  return httpServer;
}
