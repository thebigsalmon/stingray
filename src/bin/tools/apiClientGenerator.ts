import { resolve, join } from "node:path";
import {
  readdir, //
  lstat,
  mkdir,
  writeFile,
} from "node:fs/promises";

import { compile } from "json-schema-to-typescript";
import * as TJS from "typescript-json-schema";
import {
  ModuleKind,
  Project, //
  PropertyAssignment,
  ScriptTarget,
  SyntaxKind,
} from "ts-morph";

type ErrorDefinition = {
  className: string;
  message: string;
  errorTypeMnemocode: string;
  typeStr: string;
  fileName: string;
};

type Folder = {
  folders: string[];
  handlerFileName: string;
  apiFileName?: string;
};

const capitalizeFirstLetter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function readRoutes(dir: string, folders: string[]): Promise<Folder[]> {
  const folderContent = await readdir(dir);

  const result: Folder[] = [];

  for (let i = 0; i < folderContent.length; i++) {
    const itemName = folderContent[i];
    const itemPath = resolve(dir, itemName);

    const stat = await lstat(itemPath);

    if (stat.isDirectory()) {
      const subFolderResult = await readRoutes(itemPath, [...folders, itemName]);

      result.push(...subFolderResult);

      continue;
    }

    const isHandler = itemName.endsWith(".handler.ts");
    if (!isHandler) {
      continue;
    }

    const apiFileName = itemName.replace(".handler.ts", ".api.ts");

    let apiFileExists = false;

    try {
      apiFileExists = (await lstat(resolve(dir, apiFileName))).isFile();
    } catch (e) {
      if (e && (e as any).code !== "ENOENT") {
        throw e;
      }
    }

    result.push({
      folders,
      handlerFileName: itemName,
      apiFileName: apiFileExists ? apiFileName : undefined,
    });
  }

  return result;
}

function indexSymbolsByApiFileName({
  generator,
  symbolName,
  projectRootDir,
}: {
  symbolName: string;
  generator: TJS.JsonSchemaGenerator;
  projectRootDir: string;
}): Map<string, TJS.SymbolRef> {
  const result = new Map<string, TJS.SymbolRef>();

  const symbolList = generator.getSymbols(symbolName);

  symbolList.forEach((symbol) => {
    const fileName = symbol.fullyQualifiedName
      .split(`".${symbolName}`)[0]
      .replace(`"${projectRootDir}/src/routes/`, "");

    result.set(`${fileName}.ts`, symbol);
  });

  return result;
}

const extractErrorDefinitions = ({
  project,
  file: errorsFile,
  projectRootDir,
}: {
  project: Project;
  file: string;
  projectRootDir: string;
}): ErrorDefinition[] => {
  const result: ErrorDefinition[] = [];

  const errorSourceFile = project.getSourceFile(errorsFile);
  if (!errorSourceFile) {
    throw new Error("No error source file");
  }

  const importDeclaration = errorSourceFile.getImportDeclaration("@thebigsalmon/stingray/cjs/server/errors");
  if (!importDeclaration) {
    throw new Error("No import declaration");
  }

  const moduleSpecifiedSourceFile = importDeclaration.getModuleSpecifierSourceFile();
  if (!moduleSpecifiedSourceFile) {
    throw new Error("No module specified source file");
  }

  const moduleSourceFile = project.getSourceFile(moduleSpecifiedSourceFile.getFilePath());
  if (!moduleSourceFile) {
    throw new Error("No module source file");
  }

  const internalErrorClass = moduleSourceFile.getClass("StingrayError");
  if (!internalErrorClass) {
    throw new Error("No internal error class");
  }

  const derivedClassesSet = new Set(internalErrorClass.getDerivedClasses());

  const classes = errorSourceFile.getClasses();
  classes.forEach((classItem) => {
    const hasErrorClass = derivedClassesSet.has(classItem);

    if (!hasErrorClass) {
      return;
    }

    const classItemExtends = classItem.getExtends();
    if (!classItemExtends) {
      return;
    }

    const propertyValueByName = new Map<string, string>();

    const properties = classItem.getProperties();
    properties.forEach((property) => {
      const { name, initializer } = property.getStructure();

      if (!initializer) {
        return;
      }

      if (typeof initializer !== "string") {
        return;
      }

      propertyValueByName.set(name, initializer);
    });

    let typeStr = "";

    const typearguments = classItemExtends.getType().getTypeArguments();
    typearguments.forEach((typeargument) => {
      if (typeargument.getText() === "this") {
        return;
      }

      typeStr = typeargument.getText();
    });

    const message = propertyValueByName.get("message");
    if (!message) {
      return;
    }

    const errorTypeMnemocode = propertyValueByName.get("errorTypeMnemocode");
    if (!errorTypeMnemocode) {
      return;
    }

    const className = classItem.getName();
    if (!className) {
      return;
    }

    result.push({
      className,
      message,
      errorTypeMnemocode,
      typeStr,
      fileName: errorsFile.replace(`${projectRootDir}/src/errors/`, ""),
    });
  });

  return result;
};

const groupErrorsByApiMethodName = ({
  project,
  errorDefinitionList,
  projectRootDir,
}: {
  project: Project;
  errorDefinitionList: ErrorDefinition[];
  projectRootDir: string;
}): Map<string, ErrorDefinition[]> => {
  const result = new Map<string, ErrorDefinition[]>();

  const apiSourceFiles = project.getSourceFiles(`${projectRootDir}/src/routes/**/*.api.ts`);

  apiSourceFiles.forEach((apiFileName) => {
    const apiSourceFile = project.getSourceFile(apiFileName.getFilePath());
    if (!apiSourceFile) {
      throw new Error("No api source file");
    }

    const variableDeclaration = apiSourceFile.getVariableDeclaration("Errors");
    if (!variableDeclaration) {
      return;
    }

    const apiFileNameData = apiFileName //
      .getFilePath()
      .split("/src/routes/")
      .slice(-1)[0]
      .split("/");
    const folderPart = apiFileNameData
      .slice(0, -1)
      .map((item, index) => (index === 0 ? item : capitalizeFirstLetter(item)))
      .join(".");
    const filePart = apiFileNameData //
      .slice(-1)[0]
      .split(".")
      .slice(0, -2)
      .map(capitalizeFirstLetter)
      .join(".");

    const apiMethodName = `${folderPart}.${filePart}`;

    const errorDefinitionListForMethod: ErrorDefinition[] = [];

    const ole = variableDeclaration.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    for (const prop of ole.getProperties()) {
      const initializer = (prop as PropertyAssignment).getInitializer();
      if (!initializer) {
        continue;
      }

      const className = initializer.getText();

      let errorDefinition = errorDefinitionList.find((d) => d.className === className);
      if (!errorDefinition) {
        const spl = className.split(".");
        if (spl.length !== 2) {
          throw new Error(`Error definition for ${className} not found, filename ${apiFileName.getFilePath()}`);
        }

        if (spl[0] !== "errors") {
          throw new Error(`Error definition for ${className} not found, filename ${apiFileName.getFilePath()}`);
        }

        errorDefinition = errorDefinitionList.find((d) => d.className === spl[1]);
        if (!errorDefinition) {
          throw new Error(`Error definition for ${className} not found, filename ${apiFileName.getFilePath()}`);
        }
      }

      errorDefinitionListForMethod.push(errorDefinition);
    }

    result.set(apiMethodName, errorDefinitionListForMethod);
  });

  return result;
};

export default async function ({
  projectRootDir, //
  outDir,
  rpcClientImportPath = "@services/rpc",
}: {
  projectRootDir: string;
  outDir: string;
  rpcClientImportPath: string;
}): Promise<void> {
  const ERRORS_DIR = resolve(projectRootDir, "src", "errors");
  const TSCONFIG_PATH = resolve(projectRootDir, "tsconfig.json");

  const errorFileList = (await readdir(ERRORS_DIR))
    .filter((item) => item !== "index.ts")
    .map((item) => `${ERRORS_DIR}/${item}`);

  const project = new Project({
    tsConfigFilePath: resolve(TSCONFIG_PATH),
  });

  project.addSourceFilesAtPaths(errorFileList);

  project.resolveSourceFileDependencies();

  const errorDefinitionList: ErrorDefinition[] = [];

  errorFileList.forEach((errorFile) => {
    errorDefinitionList.push(...extractErrorDefinitions({ project, file: errorFile, projectRootDir }));
  });

  const errorsByApiMethodName = groupErrorsByApiMethodName({ project, errorDefinitionList, projectRootDir });

  const routes = await readRoutes(resolve(projectRootDir, "src", "routes"), []);

  const apiFileNames = routes.reduce<string[]>((acc, curr) => {
    if (curr.apiFileName) {
      return [
        ...acc,
        join(
          projectRootDir, //
          "src",
          "routes",
          ...curr.folders,
          curr.apiFileName,
        ),
      ];
    }

    return acc;
  }, []);

  const compilerOptions: TJS.CompilerOptions = {
    target: ScriptTarget.ES2020,
    module: ModuleKind.ES2020,
    rootDir: "./src",
    baseUrl: "./src",
    paths: {
      "@domain/*": ["domain/*"],
      "@errors/*": ["errors/*"],
      "@routes/*": ["routes/*"],
      "@models/*": ["models/*"],
      "@store/*": ["store/*"],
      "@middlewares/*": ["middlewares/*"],
      "@providers/*": ["providers/*"],
      "@constants/*": ["constants/*"],
      "@root/*": ["*"],
      "@tasks/*": ["tasks/*"],
      "@util/*": ["util/*"],
    },
    sourceMap: true,
    outDir: "./build",
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    strict: true,
    strictNullChecks: true,
    skipLibCheck: true,
  };

  const settings: TJS.PartialArgs = {
    required: true,
    validationKeywords: ["bypass"],
    uniqueNames: true,
  };

  const program = TJS.getProgramFromFiles(apiFileNames, compilerOptions, projectRootDir);

  const generator = TJS.buildGenerator(program, settings);
  if (!generator) {
    throw new Error(`Generator was not created`);
  }

  const requestSymbolByFullFileName = indexSymbolsByApiFileName({
    symbolName: "Request", //
    generator,
    projectRootDir,
  });
  const responseSymbolByFullFileName = indexSymbolsByApiFileName({
    symbolName: "Response", //
    generator,
    projectRootDir,
  });

  const routesByRelativeOutDir = new Map<string, Folder[]>();

  for (let i = 0; i < routes.length; i++) {
    const itemFullOutFolderName = resolve(outDir, "api", ...routes[i].folders);
    const itemTypesFullOutFolderName = resolve(itemFullOutFolderName, "types");

    await mkdir(itemTypesFullOutFolderName, { recursive: true });

    if (routes[i].apiFileName) {
      const fullFileName = `${routes[i].folders.join("/")}/${routes[i].apiFileName}`;

      const fullRouteName = `${routes[i].folders.map(capitalizeFirstLetter).join("")}${routes[i]
        .apiFileName!.slice(0, -".api.ts".length)
        .split(".")
        .map(capitalizeFirstLetter)
        .join("")}`;

      const apiFileLines: string[] = [];

      const requestSymbol = requestSymbolByFullFileName.get(fullFileName);
      if (requestSymbol) {
        const schema = generator.getSchemaForSymbol(requestSymbol.name);

        apiFileLines.push(
          await compile(schema as any, `${fullRouteName}Request`, {
            additionalProperties: false,
            bannerComment: "",
          }),
        );
      }

      const responseSymbol = responseSymbolByFullFileName.get(fullFileName);
      if (responseSymbol) {
        const schema = generator.getSchemaForSymbol(responseSymbol.name);

        apiFileLines.push(
          await compile(schema as any, `${fullRouteName}Response`, {
            additionalProperties: false,
            bannerComment: "",
          }),
        );
      }

      if (apiFileLines.length !== 0) {
        await writeFile(resolve(itemTypesFullOutFolderName, routes[i].apiFileName!), apiFileLines.join("\n"));
      }
    }

    const mapKey = routes[i].folders.join("/");

    const existingRouteByRelativeOutDir = routesByRelativeOutDir.get(mapKey) ?? [];

    routesByRelativeOutDir.set(mapKey, [...existingRouteByRelativeOutDir, routes[i]]);
  }

  for (const [routeFolder, routes] of routesByRelativeOutDir.entries()) {
    const indexFileImportLines: string[] = [];
    const indexFileExportTypesLines: string[] = [];
    const indexFileExportLines: string[] = [];

    for (let i = 0; i < routes.length; i++) {
      const fullRouteSigrature = [
        ...routes[i].folders,
        ...routes[i].handlerFileName.replace(".handler.ts", "").split("."),
      ].map((value, i) => (i === 0 ? value : capitalizeFirstLetter(value)));

      const fullRouteNameWhole = fullRouteSigrature.join("");
      const fullRouteNameDotted = fullRouteSigrature.join(".");

      let hasRequest = false;
      let hasResponse = false;
      let requestTypeString = "never";
      let responseTypeString = "void";

      if (routes[i].apiFileName) {
        const importValues: string[] = [];

        const mapKey = `${routeFolder}/${routes[i].apiFileName!}`;

        hasRequest = requestSymbolByFullFileName.has(mapKey);
        hasResponse = responseSymbolByFullFileName.has(mapKey);

        if (hasRequest) {
          importValues.push(`${capitalizeFirstLetter(fullRouteNameWhole)}Request`);
        }
        if (hasResponse) {
          importValues.push(`${capitalizeFirstLetter(fullRouteNameWhole)}Response`);
        }

        if (hasRequest || hasResponse) {
          indexFileImportLines.push(
            `import {${importValues.join()}} from "./types/${routes[i].apiFileName!.replace(".ts", "")}";`,
          );
          indexFileExportTypesLines.push(
            `export type {${importValues.join()}} from "./types/${routes[i].apiFileName!.replace(".ts", "")}";`,
          );
        }

        requestTypeString = hasRequest ? `${capitalizeFirstLetter(fullRouteNameWhole)}Request` : "never";
        responseTypeString = hasResponse ? `${capitalizeFirstLetter(fullRouteNameWhole)}Response` : "void";
      }

      const errors = errorsByApiMethodName.get(fullRouteNameDotted);
      let errorsLine = "";
      let errorCaseLines: string[] = [];
      if (errors) {
        const errorsObj = errors.map((item) => `${item.className}: errors.${item.className},`).join("");
        errorCaseLines = errors.map(
          (item) => `case errors.${item.className}.errorTypeMnemocode:
      throw new errors.${item.className}(${item.typeStr !== "never" ? `e.data as ${item.typeStr}` : ""});`,
        );

        errorsLine = `${fullRouteNameWhole}.errors = { ${errorsObj} }`;
      }

      indexFileExportLines.push(`export async function ${fullRouteNameWhole}(${
        hasRequest ? `params: ${requestTypeString}` : ""
      }): Promise<${responseTypeString}> {
  try {
  ${hasResponse ? `const response = ` : ""}await rpc<
    ${requestTypeString},
    ${responseTypeString}
  >("${fullRouteNameDotted}"${hasRequest ? `, params` : ""});
  ${hasResponse ? "return response" : ""}
  } catch (e) {
    if (!(e instanceof JsonRpcError)) {
      throw e;
    }

    if (!e.errorTypeMnemocode) {
      throw e;
    }

    switch (e.errorTypeMnemocode) {
      ${errorCaseLines.join("\n")}
      default:
        throw e;
    }
  }
}${errorsLine ? `\n${errorsLine}` : ""}`);
    }

    const fullIndexFile = `/** This code is automatically generated. DO NOT EDIT! */

import * as errors from "@/gen/errors/index";
import { JsonRpcError, rpc } from "${rpcClientImportPath}";

${indexFileImportLines.join("\n")}

${indexFileExportTypesLines.join("\n")}

${indexFileExportLines.join("\n\n")}
`;

    await writeFile(resolve(outDir, "api", routeFolder, "index.ts"), fullIndexFile);
  }

  const errorFileContent = errorFileList //
    .map((item) => `export * from "./${item.split("/").slice(-1)[0].split(".").slice(0, -1)}";`)
    .join("\n");

  const errorsDirectoryFullPath = resolve(outDir, "errors");

  await mkdir(errorsDirectoryFullPath, { recursive: true });

  await writeFile(resolve(outDir, "errors", "index.ts"), errorFileContent);

  const baseErrorFile = `type GenericObject = { [key: string]: unknown };

  export abstract class StingrayError<T extends GenericObject> extends Error {
    static errorTypeMnemocode: string;
    static message: string;
  
    constructor(protected data?: T) {
      super();
    }
  }  
`;

  await writeFile(resolve(outDir, "errors", "base.ts"), baseErrorFile);

  const pureErrorFileList = errorFileList.map((item) => item.replace(`${projectRootDir}/src/errors/`, ""));

  const contentByPureErrorItem = pureErrorFileList.reduce<Record<string, string[]>>(
    (acc, curr) => ({
      ...acc, //
      [curr]: [],
    }),
    {},
  );

  errorDefinitionList.forEach((errorDefinitionItem) => {
    contentByPureErrorItem[errorDefinitionItem.fileName].push(`
export class ${errorDefinitionItem.className} extends StingrayError<${errorDefinitionItem.typeStr}> {
  public static errorTypeMnemocode = ${errorDefinitionItem.errorTypeMnemocode};
  public static message = ${errorDefinitionItem.message};

  constructor(${errorDefinitionItem.typeStr !== "never" ? `public data: ${errorDefinitionItem.typeStr}` : ""}) {
    super(${errorDefinitionItem.typeStr !== "never" ? `data` : ""});
  }
    }
`);
  });

  const errorFileNames = Object.keys(contentByPureErrorItem);

  for (let i = 0; i < errorFileNames.length; i++) {
    await writeFile(
      resolve(outDir, "errors", errorFileNames[i]),
      `import { StingrayError } from "./base";\n` + contentByPureErrorItem[errorFileNames[i]].join("\n"),
    );
  }
}
