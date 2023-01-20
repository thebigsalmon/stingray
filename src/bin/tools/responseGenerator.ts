import { createWriteStream } from "fs";
import { lstat, readdir } from "fs/promises";
import { resolve } from "path";
import { Readable } from "stream";

import * as TJS from "typescript-json-schema";

import { ConcurrentPromiseBatch } from "./promises";

const capitalizeFirstLetter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async ({
  projectRootDir,
  routesDir,
  targetRoute,
}: {
  projectRootDir: string;
  routesDir: string;
  targetRoute?: string;
}) => {
  // optionally pass argument to schema generator
  const settings: TJS.PartialArgs = {
    required: true,
    validationKeywords: ["bypass"],
    uniqueNames: true,
  };

  // optionally pass ts compiler options
  const compilerOptions: TJS.CompilerOptions = {
    strictNullChecks: true,
    baseUrl: `${projectRootDir}/src`,
    rootDir: `${projectRootDir}/src`,
    paths: {
      "@routes/*": ["routes/*"],
    },
  };

  const routesPath = resolve(routesDir);

  const readFolder = async (
    path: string,
    arr: { folder: string; file: string }[],
    targetRoute?: string,
  ): Promise<void> => {
    const items = await readdir(path);

    for (let i = 0; i < items.length; i++) {
      const item = resolve(path, items[i]);

      const stat = await lstat(item);

      if (stat.isDirectory()) {
        await readFolder(resolve(path, item), arr, targetRoute);
      }

      if (!item.endsWith(".api.ts")) {
        continue;
      }

      // Тут добавляется +1 к длине пути, чтобы убрать / в начале
      const routePath = path
        .substring(routesPath.length + 1)
        .split("/")
        .map((str, i) => {
          if (i === 0) {
            return str;
          }

          return capitalizeFirstLetter(str);
        })
        .join(".");

      // Здесь мы удаляем последний элемент из массива перед join-ом, т.к. этот массив
      // содержит расширение исходного файла, то есть .ts
      // Также удаляем Response из роута, т.к. он есть в имени файла.
      const restRouteName = items[i] //
        .split(".")
        .map(capitalizeFirstLetter)
        .slice(0, -2)
        .join(".");

      const derivedRouteName = `${routePath}.${restRouteName}`;

      if (!targetRoute || targetRoute === derivedRouteName) {
        arr.push({
          folder: path,
          file: items[i],
        });
      }
    }
  };

  const writeFileStream = (fullFilePath: string, content: string): Promise<void> => {
    return new Promise((resolve) => {
      const stream = createWriteStream(fullFilePath);

      stream.on("finish", () => {
        resolve();
      });

      Readable.from(content).pipe(stream);
    });
  };

  const writeFilePromise = async (
    { folder, file }: { folder: string; file: string },
    symbolsByFile: Record<string, TJS.SymbolRef>,
    generator: TJS.JsonSchemaGenerator,
  ): Promise<boolean> => {
    const symbolKey = `${folder}/${file}`;
    const templateFilename = file.substring(0, file.length - ".api.ts".length);
    const pickFilename = `${templateFilename}.pick.ts`;

    const symbol = symbolsByFile[symbolKey];

    if (!symbol) {
      return false;
    }

    const schema = generator.getSchemaForSymbol(symbol.name);

    const content = `/** This code is automatically generated. DO NOT EDIT! */

  import { generateObject } from "@thebigsalmon/stingray/cjs/schemaTraversal";

  import { Response } from "./${templateFilename}.api";

  const schema = ${JSON.stringify(schema)};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const pickResponse = (source: any) => generateObject(source, schema) as Response;

  `;

    await writeFileStream(resolve(routesPath, folder, pickFilename), content);

    return true;
  };

  const start = new Date().valueOf();

  const arr: { folder: string; file: string }[] = [];

  await readFolder(routesPath, arr, targetRoute);

  const program = TJS.getProgramFromFiles(
    arr.map(({ file, folder }) => `${folder}/${file}`),
    compilerOptions,
  );

  const generator = TJS.buildGenerator(program, settings);
  if (!generator) {
    throw new Error(`Generator was not created`);
  }

  const responseSymbols = generator.getSymbols("Response");

  const symbolsByFile = arr.reduce<Record<string, TJS.SymbolRef>>((acc, curr) => {
    const h = `${curr.folder}/${curr.file}`.split(".");
    h.splice(-1);

    const haystack = h.join(".");

    const result = responseSymbols.find((s) => s.fullyQualifiedName.includes(haystack));

    if (!result) {
      return acc;
    }

    return {
      ...acc,
      [`${haystack}.ts`]: result,
    };
  }, {});

  const promises = arr.map((item) => () => writeFilePromise(item, symbolsByFile, generator));

  await new ConcurrentPromiseBatch(promises, 10).run();

  const end = new Date().valueOf();

  console.log(`Generating completed, took ${end - start} ms to complete`);
};
