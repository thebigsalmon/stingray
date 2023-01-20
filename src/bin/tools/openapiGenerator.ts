import {
  lstatSync, //
  readdirSync,
  constants,
} from "fs";
import { access, writeFile } from "fs/promises";
import { resolve } from "path";

import * as TJS from "typescript-json-schema";

interface GenericObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const capitalizeFirstLetter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const { PROJECT_ROOT: projectRootDir } = process.env;

if (!projectRootDir) {
  console.error(` [openapiGenerator] : PROJECT_ROOT env is required but not presented`);

  process.exit(1);
}

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

// optionally pass ts compiler options
const compilerOptions: TJS.CompilerOptions = {
  strictNullChecks: true,
  baseUrl: `${projectRootDir}/src`,
  rootDir: `${projectRootDir}/src`,
  paths: {
    "@domain/*": ["domain/*"],
    "@errors/*": ["errors/*"],
    "@lib/*": ["lib/*"],
    "@routes/*": ["routes/*"],
    "@models/*": ["models/*"],
    "@store/*": ["store/*"],
    "@middlewares/*": ["middlewares/*"],
    "@constants/*": ["constants/*"],
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
  requestBody: GenericObject;
  responses: GenericObject;
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
      requestBody: {},
      responses: {},
    };
  }

  const obj = {
    requestBody: {},
    responses: {},
  };

  const requestSymbol = requestSymbols
    ? requestSymbols.find((s) => s.fullyQualifiedName.includes(apiFilePath.slice(0, -3)))
    : undefined;

  if (requestSymbol) {
    const schema = generator.getSchemaForSymbol(requestSymbol.name);

    obj.requestBody = {
      content: {
        "application/json": {
          schema,
        },
      },
    };
  }

  const responseSymbol = responseSymbols
    ? responseSymbols.find((s) => s.fullyQualifiedName.includes(apiFilePath.slice(0, -3)))
    : undefined;

  if (responseSymbol) {
    const schema = generator.getSchemaForSymbol(responseSymbol.name);

    obj.responses = {
      "200": {
        description: "Success response",
        content: {
          "application/json": { schema },
        },
      },
    };
  }

  return {
    routeName: derivedRouteName,
    ...obj,
  };
};

(async () => {
  try {
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
      requestBody: GenericObject;
      responses: GenericObject;
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

    const paths: GenericObject = {};
    const definitions: GenericObject = {};

    schemas.forEach((schema) => {
      const [version, domain] = schema.routeName.split(".");

      paths[schema.routeName] = {
        description: schema.routeName,
        post: {
          requestBody: schema.requestBody,
          responses: schema.responses,
          tags: [`${version}.${domain}`],
        },
      };

      if (schema.requestBody.content) {
        const schemaDefinitions = schema.requestBody.content["application/json"]?.schema?.definitions;

        if (schemaDefinitions) {
          for (const [key, value] of Object.entries(schemaDefinitions)) {
            if (!definitions[key]) {
              definitions[key] = value;
            }
          }
        }
      }
    });

    const resultSpec = {
      openapi: "3.0.0",
      info: {
        title: "Polevod Stingray API",
        contact: {
          name: "Polevod Stingray",
          url: "http://localhost:9000",
        },
      },
      paths,
      definitions,
    };

    await writeFile(resolve(projectRootDir, "openapi.json"), JSON.stringify(resultSpec));

    const end = new Date().valueOf();

    console.log(`Generating completed. Routes touched: ${schemas.length}. Script took ${end - start} ms to complete`);
  } catch (e) {
    console.error(e);

    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
