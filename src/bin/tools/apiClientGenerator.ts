import { resolve, join } from "node:path";
import {
  readdir, //
  lstat,
  mkdir,
  writeFile,
} from "node:fs/promises";

import { compile } from "json-schema-to-typescript";
import * as TJS from "typescript-json-schema";

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

export default async function ({
  projectRootDir, //
  outDir,
  rpcClientImportPath = "@services/rpc",
}: {
  projectRootDir: string;
  outDir: string;
  rpcClientImportPath: string;
}): Promise<void> {
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
    strictNullChecks: true,
    baseUrl: `${projectRootDir}/src`,
    rootDir: `${projectRootDir}/src`,
  };

  const settings: TJS.PartialArgs = {
    required: true,
    validationKeywords: ["bypass"],
    uniqueNames: true,
  };

  const program = TJS.getProgramFromFiles(apiFileNames, compilerOptions);

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
    const itemFullOutFolderName = resolve(outDir, ...routes[i].folders);
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

      await writeFile(resolve(itemTypesFullOutFolderName, routes[i].apiFileName!), apiFileLines.join("\n"));
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

        indexFileImportLines.push(
          `import {${importValues.join()}} from "./types/${routes[i].apiFileName!.replace(".ts", "")}";`,
        );
        indexFileExportTypesLines.push(
          `export type {${importValues.join()}} from "./types/${routes[i].apiFileName!.replace(".ts", "")}";`,
        );

        requestTypeString = hasRequest ? `${capitalizeFirstLetter(fullRouteNameWhole)}Request` : "never";
        responseTypeString = hasResponse ? `${capitalizeFirstLetter(fullRouteNameWhole)}Response` : "void";
      }

      indexFileExportLines.push(`export async function ${fullRouteNameWhole}(${
        hasRequest ? `params: ${requestTypeString}` : ""
      }): Promise<${responseTypeString}> {
  ${hasResponse ? `const response = ` : ""}await rpc<
    ${requestTypeString},
    ${responseTypeString}
  >("${fullRouteNameDotted}"${hasRequest ? `, params` : ""});
  ${hasResponse ? "return response" : ""}
}`);
    }

    const fullIndexFile = `/** This code is automatically generated. DO NOT EDIT! */

import { rpc } from "${rpcClientImportPath}";

${indexFileImportLines.join("\n")}

${indexFileExportTypesLines.join("\n")}

${indexFileExportLines.join("\n\n")}
`;

    await writeFile(resolve(outDir, routeFolder, "index.ts"), fullIndexFile);
  }
}
