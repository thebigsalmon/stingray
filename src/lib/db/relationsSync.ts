import { Model } from "./model";
import { relationsSyncState } from "../db/types";
import { copyObject } from "../helpers/objects";

export interface relationSyncResultItem<T> {
  to: T | null;
  from: T | null;
  state: relationsSyncState;
  indexInDesirable: number;
  indexInExisting: number;
}

export const oneToManySync = async <T extends Model>({
  existing,
  desirable,
  usrAccSessionId,
  columns,
}: {
  existing: T[];
  desirable: T[];
  usrAccSessionId: string | null;
  columns: string[];
}): Promise<relationSyncResultItem<T>[]> => {
  const result: relationSyncResultItem<T>[] = [];

  for (let i = 0; i < desirable.length; i++) {
    let indexInExisting = -1;

    if (existing) {
      indexInExisting = existing.findIndex((item) => item.id === desirable[i].id);
    }

    if (indexInExisting === -1) {
      await desirable[i].insert({
        usrAccCreationId: usrAccSessionId,
      });

      result.push({
        to: desirable[i], //
        from: null,
        state: relationsSyncState.inserted,
        indexInDesirable: i,
        indexInExisting: -1,
      });

      continue;
    }

    const fromModel = copyObject(existing[indexInExisting]);

    const isChanged = desirable[i].differs(existing[indexInExisting], columns);

    if (isChanged) {
      await desirable[i].update(null, {
        usrAccChangesId: usrAccSessionId,
        columns,
      });

      result.push({
        to: existing[indexInExisting], //
        from: fromModel,
        state: relationsSyncState.updated,
        indexInDesirable: i,
        indexInExisting,
      });
    } else {
      result.push({
        to: existing[indexInExisting], //
        from: fromModel,
        state: relationsSyncState.untouched,
        indexInDesirable: i,
        indexInExisting,
      });
    }
  }

  if (existing) {
    for (let i = 0; i < existing.length; i++) {
      const isModelStillPresented = desirable.some((item) => item.id === existing[i].id);

      if (isModelStillPresented) {
        continue;
      }

      const fromModel = copyObject(existing[i]);

      const isDeleted = (existing[i] as any).dateDeleted;

      if (!isDeleted) {
        await existing[i].delete({
          usrAccChangesId: usrAccSessionId,
        });

        result.push({
          to: existing[i], //
          from: fromModel,
          state: relationsSyncState.deleted,
          indexInDesirable: -1,
          indexInExisting: i,
        });
      } else {
        result.push({
          to: existing[i], //
          from: fromModel,
          state: relationsSyncState.untouched,
          indexInDesirable: -1,
          indexInExisting: i,
        });
      }
    }
  }

  return result;
};

export const manyToManySync = async <T extends Model>({
  existing,
  desirable,
  usrAccSessionId,
  columns,
}: {
  existing: T[];
  desirable: T[];
  usrAccSessionId: string | null;
  columns: string[];
}): Promise<relationSyncResultItem<T>[]> => {
  const result: relationSyncResultItem<T>[] = [];

  for (let i = 0; i < desirable.length; i++) {
    let indexInExisting = -1;

    if (existing) {
      indexInExisting = existing.findIndex((item) => !item.differs(desirable[i], columns));
    }

    if (indexInExisting === -1) {
      await desirable[i].insert({
        usrAccCreationId: usrAccSessionId,
      });

      result.push({
        to: desirable[i], //
        from: null,
        state: relationsSyncState.inserted,
        indexInDesirable: i,
        indexInExisting: -1,
      });

      continue;
    }

    const fromModel = copyObject(existing[indexInExisting]);

    const isDeleted = (existing[indexInExisting] as any).dateDeleted;

    if (isDeleted) {
      await existing[indexInExisting].restore({
        usrAccChangesId: usrAccSessionId,
      });

      result.push({
        to: existing[indexInExisting], //
        from: fromModel,
        state: relationsSyncState.restored,
        indexInDesirable: i,
        indexInExisting,
      });
    } else {
      result.push({
        to: existing[indexInExisting], //
        from: fromModel,
        state: relationsSyncState.untouched,
        indexInDesirable: i,
        indexInExisting,
      });
    }
  }

  if (existing) {
    for (let i = 0; i < existing.length; i++) {
      const isModelStillPresented = desirable.some((item) => !item.differs(existing[i], columns));

      if (isModelStillPresented) {
        continue;
      }

      const back = copyObject(existing[i]);

      const isDeleted = (existing[i] as any).dateDeleted;

      if (!isDeleted) {
        await existing[i].delete({
          usrAccChangesId: usrAccSessionId,
        });

        result.push({
          to: existing[i], //
          from: back,
          state: relationsSyncState.deleted,
          indexInDesirable: -1,
          indexInExisting: i,
        });
      } else {
        result.push({
          to: existing[i], //
          from: back,
          state: relationsSyncState.untouched,
          indexInDesirable: -1,
          indexInExisting: i,
        });
      }
    }
  }

  return result;
};

// Удалить внешний объект, если вложенный объект пустой
export const getItemsWithRequiredObject = (array: any[], objectName: string): any => {
  const tmpArr = [...array];

  for (let i = tmpArr.length - 1; i >= 0; i--) {
    if (!tmpArr[i][objectName]) {
      tmpArr.splice(i, 1);
    }
  }
  return tmpArr;
};
