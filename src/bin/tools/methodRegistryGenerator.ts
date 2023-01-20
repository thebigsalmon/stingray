import {
  lstatSync, //
  readdirSync,
  writeFileSync,
} from "fs";
import { resolve } from "path";

const capitalizeFirstLetter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const { ROUTES_DIR, METHOD_REGISTRY_OUT_DIR } = process.env;

if (!ROUTES_DIR) {
  console.error(` [methodRegistryGenerator] : ROUTES_DIR env is required but not presented`);

  process.exit(1);
}

if (!METHOD_REGISTRY_OUT_DIR) {
  console.error(` [methodRegistryGenerator] : METHOD_REGISTRY_OUT_DIR env is required but not presented`);

  process.exit(1);
}

const routesPath = resolve(ROUTES_DIR);

const readFolder = (path: string, previousFolders: string[]) => {
  const items = readdirSync(path);

  for (let i = 0; i < items.length; i++) {
    const item = resolve(path, items[i]);

    if (lstatSync(item).isDirectory()) {
      readFolder(resolve(path, item), [...previousFolders, items[i]]);
    }

    if (!item.endsWith(".handler.ts")) {
      continue;
    }

    writeFile({
      file: items[i],
      previousFolders,
    });
  }
};

const importLines: string[] = [];
const returnLines: string[] = [];

const writeFile = ({ file, previousFolders }: { file: string; previousFolders: string[] }) => {
  const spl = file.split(".");

  spl.pop();

  const className = [...previousFolders, ...spl].map(capitalizeFirstLetter).join("");

  const importLine = `import {Handler as ${className}} from "@routes/${previousFolders.join("/")}/${spl.join(".")}"`;
  const returnLine = className;

  returnLines.push(`    new ${returnLine}(dependencies)`);
  importLines.push(importLine);
};

readFolder(routesPath, []);

writeFileSync(
  resolve(METHOD_REGISTRY_OUT_DIR, "methodRegistry.ts"),
  `import { Knex } from "knex";

import { JsonRpcHandler } from "@lib/server";
${importLines.join("\n")}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createHandlers = (dependencies: any): JsonRpcHandler<any, any>[] => {
  return [
${returnLines.join(",\n")}
  ];
};
`,
);
