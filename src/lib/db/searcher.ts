import { Knex } from "knex";

import { normalizeDirection, snakeToCamel } from "./util";
import { GenericObject, Relation, relationType, Table } from "./types";

// import { tables } from "../../tables";

let tables: Table[];

const POSTGRES_MAX_COLUMN_NAME_LENGTH = 63;

const findTable = (tableName: string): Table => {
  const table = tables.find((t) => t.name === tableName || t.tableName === tableName);

  if (!table) {
    throw new Error(`Table "${tableName}" not found`);
  }

  return table;
};

const findRelation = (table: Table, relationName: string): Relation => {
  if (!table.relations) {
    throw new Error(`Table ${table.tableName} does not have any relations`);
  }

  const relation = table.relations.find(
    (relation) => relation.name === relationName || relation.tableName === relationName,
  );
  if (!relation) {
    throw new Error(`Table ${table.tableName} does not have a relation ${relationName}`);
  }

  return relation;
};

const resolveTableByPath = (path: string[], parent?: Table): Table => {
  if (path.length === 1) {
    if (!parent) {
      return findTable(path[0]);
    }

    const relation = findRelation(parent, path[0]);

    return findTable(relation.tableName);
  }

  const [current, ...rest] = path;

  parent = findTable(current);

  return resolveTableByPath(rest, parent);
};

interface QueryTree {
  tree: GenericObject;
  depth: number;
  previousPath: string[];
}

type SearcherQueryModifier = (query: Knex.QueryBuilder) => void;

export const setTables = (tablesParam: Table[]): void => {
  tables = tablesParam;
};

export class Searcher<T> {
  protected knex: Knex | Knex.Transaction;
  protected isShowDeleted: boolean;

  protected joinTree: GenericObject = {};
  protected joinModifiers: { path: string; fn: any }[];

  private queryModifiers: SearcherQueryModifier[] = [];

  constructor(knex: Knex | Knex.Transaction, tableName: string, { isShowDeleted = false } = {}) {
    this.knex = knex;
    this.isShowDeleted = isShowDeleted;

    this.joinTree = {
      [snakeToCamel(tableName)]: null,
    };

    this.joinModifiers = [];
  }

  static whereInAsRaw(column: string, values: string[] | number[]): string {
    // Если параметры не переданы, то запрос должен ничего не вернуть: "where false".
    if (values.length === 0) {
      return "false";
    }

    const param = values
      .map((x) => {
        // Экранируем кавычку.
        let v = x.toString().replace(/'/g, "''");

        // Для строки берем параметры в кавычки.
        if (typeof x === "string") {
          v = `'${v}'`;
        }

        return v;
      })
      .join(",");

    return `${column} IN (${param})`;
  }

  // see ./notes/3.md
  public whereInAsRaw(column: string, values: string[] | number[]): string {
    return Searcher.whereInAsRaw(column, values);
  }

  protected modifyQuery(fn: SearcherQueryModifier): void {
    this.queryModifiers.push(fn);
  }

  protected patchJoinTree(path: string, joinModifier?: (query: Knex.QueryBuilder) => void): void {
    const properties = path.split(".");
    let currentJoinGraphItem = this.joinTree;

    for (let i = 0; i < properties.length - 1; i++) {
      const property = properties[i];

      // TODO fix this and write a test on this case
      // eslint-disable-next-line no-prototype-builtins
      if (!currentJoinGraphItem.hasOwnProperty(property)) {
        throw new Error(`Property ${property} is not presented in current join graph`);
      }

      if (i === properties.length - 2 && currentJoinGraphItem[property] === null) {
        currentJoinGraphItem[property] = {};
      }

      currentJoinGraphItem = currentJoinGraphItem[property];
    }

    currentJoinGraphItem[properties[properties.length - 1]] = null;

    if (joinModifier) {
      this.joinModifiers.push({ path, fn: joinModifier });
    }
  }

  private async processTree(
    queryTree: QueryTree,
    {
      isZeroDepth,
      onlyReturnCount,
      parentIds,
      parentKey,
      parentCachePath,
    }: {
      isZeroDepth?: boolean;
      onlyReturnCount?: boolean;
      parentIds?: string[];
      parentKey?: string;
      parentCachePath?: string;
    },
  ): Promise<{ result: GenericObject; queryTree: QueryTree }> {
    // Здесь мы точно знаем, что в дереве не может быть ничего, кроме hasOne и belongsToOne.

    let shortColumnsCount = 0;

    const generateColumns = (
      table: Table,
      relation?: Relation,
    ): { queryColumns: string[]; shortColumnsByName: { [key: string]: string } } => {
      if (!relation) {
        const queryColumns: string[] = []; // see ./notes/2.md
        const shortColumnsByName: { [key: string]: string } = {};

        table.columns.forEach((column) => {
          const tableColumn = `${table.alias}.${column}`;
          const aliasColumn = `${table.tableName}_${column}`;

          if (aliasColumn.length <= POSTGRES_MAX_COLUMN_NAME_LENGTH) {
            queryColumns.push(`${tableColumn} as ${aliasColumn}`);

            return;
          }

          shortColumnsCount++;
          const shortColumnName = `short_${shortColumnsCount}`;

          queryColumns.push(`${tableColumn} as ${shortColumnName}`);
          shortColumnsByName[shortColumnName] = aliasColumn;
        });

        return {
          queryColumns,
          shortColumnsByName,
        };
      }

      const alias = relation.extra ? relation.extra.alias : table.alias;
      const prefix = relation.extra ? relation.extra.prefix : table.tableName;

      const queryColumns: string[] = [];
      const shortColumnsByName: { [key: string]: string } = {};

      table.columns.forEach((column) => {
        const tableColumn = `${alias}.${column}`;
        const aliasColumn = `${prefix}_${column}`;

        if (aliasColumn.length > POSTGRES_MAX_COLUMN_NAME_LENGTH) {
          throw new Error("Maximum postgres column name length exceeded!");
        }

        queryColumns.push(`${tableColumn} as ${aliasColumn}`);
      });

      return {
        queryColumns,
        shortColumnsByName,
      };
    };

    const root = Object.keys(queryTree.tree)[0];

    const rootTable = tables.find((table) => table.name === root || table.tableName === root);
    if (!rootTable) {
      throw new Error(`Table "${root}" is not presented in tables list`);
    }

    const query = this.knex.queryBuilder().from(`${rootTable.tableName} as ${rootTable.alias}`);
    if (!this.isShowDeleted && rootTable.columns.includes("date_deleted")) {
      query.whereNull(`${rootTable.alias}.date_deleted`);
    }

    if (!isZeroDepth) {
      if (!parentIds) {
        throw new Error(`No parent Ids for table "${root}"`);
      }

      if (!parentKey) {
        throw new Error(`No parent key for table "${root}"`);
      }

      query.whereIn(parentKey, parentIds);

      if (parentCachePath) {
        const leafName = rootTable.name ? rootTable.name : rootTable.tableName;

        const joinModifierPath = `${parentCachePath}.${leafName}`;

        const modifier = this.joinModifiers.find((m) => m.path === joinModifierPath);
        if (modifier) {
          modifier.fn(query);
        }
      }
    }

    if (this.queryModifiers.length > 0 && isZeroDepth) {
      for (let i = 0; i < this.queryModifiers.length; i++) {
        this.queryModifiers[i](query);
      }
    }

    let columns = generateColumns(rootTable);

    const makeJoinCondition = ({
      previousRootTable,
      previousRootChildRelation,
      childTable,
      query,
    }: {
      previousRootTable: Table;
      previousRootChildRelation: Relation;
      childTable: Table;
      query: Knex.QueryBuilder;
    }) => {
      if (previousRootChildRelation.relationType === relationType.belongsToOne) {
        if (previousRootChildRelation.condition) {
          const alias = previousRootChildRelation.extra ? previousRootChildRelation.extra.alias : childTable.alias;

          query.leftJoin(
            `${childTable.tableName} as ${alias}`,
            this.knex.raw(`${previousRootChildRelation.condition}`),
          );

          return;
        }

        const alias = previousRootChildRelation.extra ? previousRootChildRelation.extra.alias : childTable.alias;

        if (this.isShowDeleted) {
          query.leftJoin(`${childTable.tableName} as ${alias}`, function () {
            this.on(`${childTable.alias}.id`, "=", `${previousRootTable.alias}.${childTable.tableName}_id`);
          });
        } else {
          query.leftJoin(`${childTable.tableName} as ${alias}`, function () {
            this.on(`${childTable.alias}.id`, "=", `${previousRootTable.alias}.${childTable.tableName}_id`); //
            if (childTable.columns.includes("date_deleted")) {
              this.andOnNull(`${childTable.alias}.date_deleted`);
            }
          });
        }

        return;
      }

      // TODO реализовать для hasOne
      // else {
      //   condition.push(`${childTable.alias}.id`, `${previousRootTable.alias}.${childTable.tableName}_id`);
      // }

      throw new Error(
        `Unable to build join condition between ${previousRootTable.tableName} and ${childTable.tableName}`,
      );
    };

    const traverse = ({
      tree,
      query,
      parentTable,
    }: {
      tree: GenericObject; //
      query: Knex.QueryBuilder;
      parentTable: Table;
    }) => {
      Object.keys(tree).forEach((childKey) => {
        if (!parentTable.relations) {
          throw new Error(`Table "${parentTable.tableName}" does not have any relations`);
        }

        const parentCurrentRelation = parentTable.relations.find(
          (relation) => relation.tableName === childKey || relation.name === childKey,
        );
        if (!parentCurrentRelation) {
          throw new Error(`Table "${parentTable.tableName}" does not have relation "${childKey}"`);
        }

        const currentTable = tables.find(
          (table) =>
            table.name === parentCurrentRelation.tableName || table.tableName === parentCurrentRelation.tableName,
        );
        if (!currentTable) {
          // console.log("------------ Error!");

          throw new Error(`Table "${childKey}" is not presented in tables list`);
        }

        const cc = generateColumns(currentTable, parentCurrentRelation);

        columns = {
          queryColumns: [...columns.queryColumns, ...cc.queryColumns],
          shortColumnsByName: { ...columns.shortColumnsByName, ...cc.shortColumnsByName },
        };

        makeJoinCondition({
          previousRootTable: parentTable,
          previousRootChildRelation: parentCurrentRelation,
          childTable: currentTable,
          query,
        });

        if (tree[childKey] !== null) {
          traverse({
            tree: tree[childKey],
            query,
            parentTable: currentTable,
          });
        }
      });
    };

    if (queryTree.tree[root] !== null) {
      traverse({
        tree: queryTree.tree[root],
        query,
        parentTable: rootTable,
      });
    }

    if (onlyReturnCount) {
      return await query.count();
    }

    const cc: string[] = [...columns.queryColumns];

    const records = await query.select(cc);

    for (let i = 0; i < records.length; i++) {
      for (const [key, value] of Object.entries(columns.shortColumnsByName)) {
        const realQueryColumnName = value;

        records[i][realQueryColumnName] = records[i][key]; // see ./notes/2.md

        delete records[i][key];
      }
    }

    const result: any = {};
    const localCache: GenericObject = {};

    const tree = ({
      record, //
      joinsGraph,
      parent,
      currentJoinKey,
      previousJoinKey,
      isDummyData = false,
    }: {
      record: GenericObject;
      joinsGraph: GenericObject;
      parent: any;
      previousJoinKey?: string;
      currentJoinKey: string;
      isDummyData?: boolean; // See ./notes/0.md
    }) => {
      let localCacheKey = "";
      let columns: string[] = [];
      let prefix = "";

      if (previousJoinKey) {
        const previousTable = findTable(previousJoinKey);
        const relation = findRelation(previousTable, currentJoinKey);
        const currentTable = findTable(relation.tableName);

        localCacheKey = relation.extra ? relation.extra.alias : currentTable.tableName;
        prefix = relation.extra ? relation.extra.prefix : currentTable.tableName;
        columns = currentTable.columns;
      } else {
        const currentTable = tables.find(
          (table) => table.tableName === currentJoinKey || table.name === currentJoinKey,
        );
        if (!currentTable) {
          throw new Error(`Table ${currentJoinKey} is not presented in tables list`);
        }

        localCacheKey = currentTable.tableName;
        columns = currentTable.columns;
        prefix = currentTable.tableName;
      }

      if (!localCache[localCacheKey]) {
        localCache[localCacheKey] = {};
      }

      let currentEntity: GenericObject = {};

      if (!isDummyData) {
        const currentTableId = record[`${localCacheKey}_id`];
        if (localCache[localCacheKey][currentTableId]) {
          currentEntity = localCache[localCacheKey][currentTableId];
        } else {
          columns.forEach((column) => {
            const columnCamelCase = snakeToCamel(column);

            // По договорённости у нас все поля вида entityNameId - строки.
            if ((columnCamelCase === "id" || columnCamelCase.endsWith("Id")) && record[`${prefix}_${column}`]) {
              currentEntity[columnCamelCase] = record[`${prefix}_${column}`].toString();
            } else {
              currentEntity[columnCamelCase] = record[`${prefix}_${column}`];
            }
          });

          localCache[localCacheKey][currentEntity.id] = currentEntity;
        }
      }

      let newParent: any;

      if (!previousJoinKey) {
        if (!parent[currentJoinKey]) {
          parent[currentJoinKey] = [];
        }

        const parentIndex = parent[currentJoinKey].findIndex(
          (parentItem: GenericObject) => parentItem.id === currentEntity.id,
        );

        if (parentIndex === -1) {
          if (!isDummyData) {
            parent[currentJoinKey].push(currentEntity);
          }

          newParent = currentEntity;
        } else {
          newParent = parent[parentIndex];
        }
      } else {
        // Обрабатываем ситуацию, в которой мы джоиним таблицу на текущем уровне дерева запросов,
        // но такой записи нет. Например, domesticMachine, который не привязан в machineType, то есть
        // machineTypeId у записи будет null. В таком случае мы получаем объект со всеми полями null,
        // т.к. в такой форме он прилетает из базы.
        if (currentEntity.id !== null) {
          parent[currentJoinKey] = currentEntity;

          newParent = currentEntity;
        } else {
          return;
        }
      }

      const currentJoinGraph = joinsGraph[currentJoinKey];
      if (currentJoinGraph === null) {
        // Мы достигли последнего узла в дереве.
        return;
      }

      if (!currentJoinGraph) {
        // Мы не достигли последнего узла в дереве, но что-то пошло не так.
        throw new Error(`Join key ${currentJoinKey} is not presented in join graph`);
      }

      Object.keys(currentJoinGraph).forEach((key) => {
        tree({
          record,
          joinsGraph: currentJoinGraph,
          parent: newParent,
          previousJoinKey: currentJoinKey,
          currentJoinKey: key,
          isDummyData,
        });
      });
    };

    for (let i = 0; i < records.length; i++) {
      tree({
        record: records[i],
        joinsGraph: queryTree.tree,
        parent: result,
        currentJoinKey: Object.keys(queryTree.tree)[0],
      });
    }

    if (Object.keys(result).length === 0) {
      tree({
        record: {},
        joinsGraph: queryTree.tree,
        parent: result,
        currentJoinKey: Object.keys(queryTree.tree)[0],
        isDummyData: true,
      });
    }

    return { result, queryTree };
  }

  public page({ pageSize, pageNumber }: { pageSize: number; pageNumber: number }) {
    const offset = pageSize * (pageNumber - 1);
    const limit = pageSize;

    this.modifyQuery((query) => query.offset(offset).limit(limit));

    return this;
  }

  public sort({ column, direction, asString }: { column: string; direction?: string; asString?: boolean }) {
    if (!column) {
      throw new Error("Column is not presented");
    }

    let d = "ASC";
    if (direction) {
      d = normalizeDirection(direction);
    }
    if (!d) {
      throw new Error("d is not presented");
    }
    if (!["ASC", "DESC"].includes(d)) {
      throw new Error("Direction is unknown");
    }
    if (!asString) {
      this.modifyQuery((q) => q.orderBy(column, d.toLowerCase()));
    } else {
      this.modifyQuery((q) => q.orderByRaw(`lower(${column}) ${d.toLowerCase()}`));
    }
    return this;
  }

  private async _execute({ onlyReturnCount }: { onlyReturnCount: boolean } = { onlyReturnCount: false }): Promise<T[]> {
    const queryTrees: QueryTree[] = [];

    // console.log(JSON.stringify(this.joinTree));

    const traversal = ({
      tree,
      currentRoot,
      isRoot = false,
      depth = 0,
      previousPath,
    }: {
      tree: GenericObject;
      currentRoot: string;
      isRoot?: boolean;
      depth: number;
      previousPath: string[];
    }): GenericObject | null | undefined => {
      if (tree[currentRoot] === null) {
        if (isRoot) {
          queryTrees.push({
            tree: { [currentRoot]: null },
            depth,
            previousPath,
          });

          return;
        }

        return null;
      }

      const resultTree: GenericObject = {};

      const rootTable = tables.find((table) => table.name === currentRoot || table.tableName === currentRoot);
      if (!rootTable) {
        throw new Error(`Table "${currentRoot}" is not presented in tables list`);
      }

      if (!rootTable.relations) {
        throw new Error(`Root table "${currentRoot}" does not have any relations`);
      }

      const oneToOneKeys: { [key: string]: Relation } = {};
      const oneToManyKeys: { [key: string]: Relation } = {};

      Object.keys(tree[currentRoot]).forEach((childKey) => {
        const rootChildRelation = rootTable.relations!.find(
          (relation) => relation.name === childKey || relation.tableName === childKey,
        );
        if (!rootChildRelation) {
          throw new Error(`Child table "${childKey}" is not presented in relations of root table "${currentRoot}"`);
        }

        if (
          rootChildRelation.relationType === relationType.hasOne ||
          rootChildRelation.relationType === relationType.belongsToOne
        ) {
          oneToOneKeys[childKey] = rootChildRelation;

          return;
        }

        oneToManyKeys[childKey] = rootChildRelation;
      });

      const newPath = [...previousPath, currentRoot];

      Object.keys(oneToOneKeys).forEach((childKey) => {
        resultTree[childKey] = traversal({
          tree: tree[currentRoot],
          currentRoot: childKey,
          depth,
          previousPath: newPath,
        });
      });

      Object.keys(oneToManyKeys).forEach((childKey) => {
        traversal({
          tree: tree[currentRoot],
          currentRoot: childKey,
          isRoot: true,
          depth: depth + 1,
          previousPath: newPath,
        });
      });

      /*
        Тут было непонятное условие, которое ломало дерево при полностью сгенеренной структуре базы. Вот это условие:
        rootTable.relations.every(
          (relation) =>
            relation.relationType !== relationType.hasOne && relation.relationType !== relationType.belongsToOne,
        )
        После того, как заменил это условие на `Object.keys(oneToOneKeys).length === 0`, код перестал ломаться в этом месте.
      */
      if (Object.keys(oneToOneKeys).length === 0) {
        // Здесь обрабатывается ситуация, при которой к таблице на текущей глубине ничего не джоинится,
        // и таблица является рутом. Был баг, при котором joinTree был {culture: {maturationPhase: null}},
        // и при этом кейсе либа крашилась.
        if (isRoot) {
          queryTrees.push({
            tree: { [currentRoot]: null },
            depth,
            previousPath,
          });
        }

        return null;
      }

      if (!isRoot) {
        return resultTree;
      }

      queryTrees.push({
        tree: { [currentRoot]: resultTree },
        previousPath,
        depth,
      });
    };

    traversal({
      tree: this.joinTree,
      currentRoot: Object.keys(this.joinTree)[0],
      isRoot: true,
      depth: 0,
      previousPath: [],
    });

    // console.log(JSON.stringify(queryTrees.sort((a, b) => a.depth - b.depth)));

    let maxDepth = 0;
    for (let i = 0; i < queryTrees.length; i++) {
      if (maxDepth < queryTrees[i].depth) {
        maxDepth = queryTrees[i].depth;
      }
    }

    const extractPathFromTree = (tree: GenericObject): string[] => {
      const key = Object.keys(tree)[0];

      if (tree[key] === null) {
        return [key];
      }

      return [key, ...extractPathFromTree(tree[key])];
    };

    const cache: GenericObject = {};

    const cacheByPath = ({
      records,
      tree,
      previousPath = [],
      isRootInTree,
    }: {
      records: GenericObject;
      tree: GenericObject;
      previousPath?: string[];
      isRootInTree?: boolean;
    }): void => {
      if (previousPath.length === 0) {
        if (isRootInTree) {
          const recordsRootKey = Object.keys(records)[0];

          cache[recordsRootKey] = [];

          for (let i = 0; i < records[recordsRootKey].length; i++) {
            cache[recordsRootKey].push(records[recordsRootKey][i]);

            if (tree[recordsRootKey] !== null) {
              cacheByPath({
                records: records[recordsRootKey][i],
                tree: tree[recordsRootKey],
                previousPath: [recordsRootKey],
                isRootInTree: false,
              });
            }
          }
        }
      } else {
        if (!isRootInTree) {
          if (tree === null) {
            return;
          }

          const key = Object.keys(tree)[0];
          const cacheKey = [...previousPath, key].join(".");

          if (records[`${key}Id`] === null) {
            return;
          }

          // Ситуация, при которой значение ключа есть (например, territoryId = 1),
          // но сущность не приджоинилась, т.к. она была удалена.
          // В таком случае просто завершаем обработку текущей записи по данному ключу.
          if (records[`${key}Id`] !== null && records[key] === undefined) {
            return;
          }

          if (records[key] && !cache[cacheKey].some((cacheItem: GenericObject) => cacheItem.id === records[key].id)) {
            cache[cacheKey].push(records[key]);
          }

          cacheByPath({
            records: records[key],
            tree: tree[key],
            previousPath: [...previousPath, key],
            isRootInTree: false,
          });
        } else {
          const recordsRootKey = Object.keys(records)[0];
          const cacheKey = [...previousPath, recordsRootKey].join(".");

          const parentCacheKey = previousPath.join(".");

          for (let parentCacheIndex = 0; parentCacheIndex < cache[parentCacheKey].length; parentCacheIndex++) {
            if (!cache[parentCacheKey][parentCacheIndex][recordsRootKey]) {
              cache[parentCacheKey][parentCacheIndex][recordsRootKey] = [];
            }
          }

          const parentTable = resolveTableByPath(previousPath);

          const parentTableName = parentTable.name || parentTable.tableName;
          const parentTableIdKey = `${parentTableName}Id`;

          for (let i = 0; i < records[recordsRootKey].length; i++) {
            cache[cacheKey].push(records[recordsRootKey][i]);

            for (let parentCacheI = 0; parentCacheI < cache[parentCacheKey].length; parentCacheI++) {
              if (cache[parentCacheKey][parentCacheI].id === records[recordsRootKey][i][parentTableIdKey]) {
                cache[parentCacheKey][parentCacheI][recordsRootKey].push(records[recordsRootKey][i]);
              }
            }

            if (tree[recordsRootKey] !== null) {
              cacheByPath({
                records: records[recordsRootKey][i],
                tree: tree[recordsRootKey],
                previousPath: [...previousPath, recordsRootKey],
                isRootInTree: false,
              });
            }
          }
        }
      }
    };

    const initCacheForTree = ({ tree, previousPath }: { tree: GenericObject; previousPath: string[] }) => {
      Object.keys(tree).forEach((key) => {
        const cachePath = [...previousPath, key];

        cache[cachePath.join(".")] = [];

        if (tree[key] === null) {
          return;
        }

        initCacheForTree({ tree: tree[key], previousPath: cachePath });
      });
    };

    queryTrees
      .sort((a, b) => a.depth - b.depth)
      .forEach((tree) => {
        initCacheForTree({ tree: tree.tree, previousPath: tree.previousPath });
      });

    for (let depth = 0; depth <= maxDepth; depth++) {
      if (depth === 0) {
        const tree = queryTrees.find((queryTree) => queryTree.depth === 0);
        if (!tree) {
          throw new Error("Impossible");
        }

        const recordsSet = await this.processTree(tree, { isZeroDepth: true, onlyReturnCount });

        if (onlyReturnCount) {
          return (recordsSet as any)[0].count; // See ./notes/1.md
        }

        const rootKey = Object.keys(recordsSet.queryTree.tree)[0];

        cacheByPath({
          records: recordsSet.result,
          tree: tree.tree,
          isRootInTree: true,
        });

        continue;
      }

      const trees = queryTrees //
        .filter((queryTree) => queryTree.depth === depth);

      const promises = [];
      for (let i = 0; i < trees.length; i++) {
        const parentCachePath = trees[i].previousPath.join(".");
        const parentIds = cache[parentCachePath].map((cacheItem: GenericObject) => cacheItem.id);

        const parentKey = trees[i].previousPath[trees[i].previousPath.length - 1];
        const parentTable = tables.find((table) => table.name === parentKey || table.tableName === parentKey);
        if (!parentTable) {
          throw new Error(`Table "${parentKey}" is not presented in tables list`);
        }

        promises.push(
          this.processTree(trees[i], {
            isZeroDepth: false, //
            parentIds,
            parentKey: `${parentTable.tableName}_id`,
            parentCachePath,
          }),
        );
      }

      const recordsSets = await Promise.all(promises);

      for (let i = 0; i < recordsSets.length; i++) {
        cacheByPath({
          records: recordsSets[i].result,
          tree: recordsSets[i].queryTree.tree,
          previousPath: recordsSets[i].queryTree.previousPath,
          isRootInTree: true,
        });
      }
    }

    return cache[Object.keys(this.joinTree)[0]];
  }

  public async execute(): Promise<T[]> {
    return this._execute();
  }

  public async executeByPages(pageSize: number): Promise<T[]> {
    const result: T[] = [];
    let pageNumber = 1;
    let lastResult: T[] = [];

    do {
      lastResult = await this.page({ pageSize, pageNumber })._execute();

      pageNumber++;
      result.push(...lastResult);
    } while (lastResult.length !== 0);

    return result;
  }

  public async executeForOne(): Promise<T | undefined> {
    // TODO add limit 2 for performance sake - для проверки существования только одной записи больше нам не нужно.

    const records = await this.execute();

    if (records.length > 1) {
      throw new Error("ambigious record set");
    }

    return records[0];
  }

  public async count(): Promise<number> {
    const count = await this._execute({ onlyReturnCount: true });

    return parseInt(count as any, 10); // See ./notes/1.md
  }
}
