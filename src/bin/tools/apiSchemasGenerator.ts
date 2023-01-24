import {
  lstatSync, //
  readdirSync,
  constants,
} from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compile } from "ejs";
import * as TJS from "typescript-json-schema";

interface GenericObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const capitalizeFirstLetter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// optionally pass argument to schema generator
const settings: TJS.PartialArgs = {
  required: true,
  validationKeywords: [
    "comment", //
    "description",
    "example",
  ],
  uniqueNames: true,
};

const template = compile(`/** This code is automatically generated. DO NOT EDIT! */

import { GenericObject } from "@thebigsalmon/stingray/cjs/db/types";
import { JsonRpcServer } from "@thebigsalmon/stingray/cjs/server";
import { generateObject, validateObject } from "@thebigsalmon/stingray/cjs/schemaTraversal";

const requestSchemaByMethodName: GenericObject = {};
const responseSchemaByMethodName: GenericObject = {};

<% for (let i = 0; i < schemas.length; i++) { %>
<% if (schemas[i].requestSchema) { %>
  requestSchemaByMethodName["<%- schemas[i].routeName %>"] = <%- JSON.stringify(schemas[i].requestSchema) %>;
<% } %>
<% if (schemas[i].responseSchema) { %>
  responseSchemaByMethodName["<%- schemas[i].routeName %>"] = <%- JSON.stringify(schemas[i].responseSchema) %>;
<% } %>
<% } %>

export function registerRequestValidators(jsonRpcServer: JsonRpcServer): void {
  Object.keys(requestSchemaByMethodName).forEach((methodName) => {
    const validationFn = (source: GenericObject): GenericObject | null =>
      validateObject(requestSchemaByMethodName[methodName], source);

    jsonRpcServer.registerRequestValidator(methodName, validationFn);
  });
}

export function registerResponsePickers(jsonRpcServer: JsonRpcServer): void {
  Object.keys(requestSchemaByMethodName).forEach((methodName) => {
    const pickerFn = (source: GenericObject) =>
      generateObject(source, requestSchemaByMethodName[methodName]) as Response;

    jsonRpcServer.registerResponsePicker(methodName, pickerFn);
  });
}
`);

export default async ({ projectRootDir, outDir }: { projectRootDir: string; outDir: string }) => {
  // optionally pass ts compiler options
  const compilerOptions: TJS.CompilerOptions = {
    strictNullChecks: true,
    baseUrl: `${projectRootDir}/src`,
    rootDir: `${projectRootDir}/src`,
    paths: {
      "@routes/*": ["routes/*"],
    },
  };

  const routesPath = resolve(projectRootDir, "src", "routes");

  const readFolder = (path: string): string[] => {
    const items = readdirSync(path);

    const result: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = resolve(path, items[i]);

      if (lstatSync(item).isDirectory()) {
        const schemas = readFolder(resolve(path, item));
        result.push(...schemas);
      }

      if (!item.endsWith(".handler.ts")) {
        continue;
      }

      result.push(item);
    }

    return result;
  };

  const start = new Date().valueOf();

  const verifyHandlerFile = async (handlerFilePath: string): Promise<[string, string | undefined]> => {
    try {
      const apiFilePath = `${handlerFilePath.slice(0, -".handler.ts".length)}.api.ts`;

      await access(apiFilePath, constants.F_OK);

      return [handlerFilePath, apiFilePath];
    } catch (e) {
      if (e && (e as any).code !== "ENOENT") {
        throw e;
      }

      return [handlerFilePath, undefined];
    }
  };

  const createHandlerSchemas = async (
    [handlerFilePath, apiFilePath]: [string, string | undefined],
    requestSymbols: TJS.SymbolRef[],
    responseSymbols: TJS.SymbolRef[],
    generator: TJS.JsonSchemaGenerator,
  ): Promise<{
    routeName: string;
    requestSchema: GenericObject;
    responseSchema: GenericObject;
  }> => {
    // Тут добавляется +1 к длине пути, чтобы убрать / в начале
    const derivedRouteName = handlerFilePath
      .substring(routesPath.length + 1)
      .split("/")
      .map((str, i, src) => {
        if (i === 0) {
          return str;
        }

        if (i === src.length - 1) {
          return str.slice(0, -".handler.ts".length).split(".").map(capitalizeFirstLetter).join(".");
        }

        return capitalizeFirstLetter(str);
      })
      .join(".");

    if (!apiFilePath) {
      return {
        routeName: derivedRouteName,
        requestSchema: {},
        responseSchema: {},
      };
    }

    const obj = {
      requestSchema: {},
      responseSchema: {},
    };

    const requestSymbol = requestSymbols
      ? requestSymbols.find((s) => s.fullyQualifiedName.includes(apiFilePath.slice(0, -3)))
      : undefined;

    if (requestSymbol) {
      obj.requestSchema = generator.getSchemaForSymbol(requestSymbol.name);
    }

    const responseSymbol = responseSymbols
      ? responseSymbols.find((s) => s.fullyQualifiedName.includes(apiFilePath.slice(0, -3)))
      : undefined;

    if (responseSymbol) {
      obj.responseSchema = generator.getSchemaForSymbol(responseSymbol.name);
    }

    return {
      routeName: derivedRouteName,
      ...obj,
    };
  };

  const handlersPaths = readFolder(routesPath);

  const checkFilePromises: Promise<[string, string | undefined]>[] = [];

  for (let i = 0; i < handlersPaths.length; i++) {
    checkFilePromises.push(verifyHandlerFile(handlersPaths[i]));
  }

  const verifyHandlersResult = await Promise.all(checkFilePromises);

  const program = TJS.getProgramFromFiles(
    verifyHandlersResult //
      .filter(([, apiFilePath]) => apiFilePath)
      .map(([, apiFilePath]) => resolve(apiFilePath!)),
    compilerOptions,
  );

  const generator = TJS.buildGenerator(program, settings);
  if (!generator) {
    throw new Error(`Generator was not created`);
  }

  const requestSymbols = generator.getSymbols("Request");
  const responseSymbols = generator.getSymbols("Response");

  const createSchemaPromises: Promise<{
    routeName: string;
    requestSchema: GenericObject;
    responseSchema: GenericObject;
  }>[] = [];

  for (let i = 0; i < verifyHandlersResult.length; i++) {
    createSchemaPromises.push(
      createHandlerSchemas(
        verifyHandlersResult[i], //
        requestSymbols,
        responseSymbols,
        generator,
      ),
    );
  }

  const schemas = await Promise.all(createSchemaPromises);

  const out = template({ schemas });

  await writeFile(resolve(outDir, "index.ts"), out);

  const end = new Date().valueOf();

  console.log(`Generating completed. Routes touched: ${schemas.length}. Script took ${end - start} ms to complete`);
};
