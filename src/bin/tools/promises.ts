import { EventEmitter } from "events";

type GenericPromise<T> = (...args: any[]) => Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface ResultResolved<T> {
  isResolved: true;

  result: T;
}

interface ResultReject {
  isResolved: false;

  error: unknown;
}

export const isResultResolved = <T>(param: ResultResolved<T> | ResultReject): param is ResultResolved<T> => {
  return param.isResolved;
};

export class ConcurrentPromiseBatch<T> {
  private tasks: GenericPromise<T>[];
  private limit: number;

  private result: Array<ResultResolved<T> | ResultReject> = [];

  private runningTaskIndex = -1;
  private runningTasksCount = 0;
  private completedTasksCount = 0;
  private emitter = new EventEmitter();

  constructor(tasks: GenericPromise<T>[], limit: number) {
    this.tasks = tasks;
    this.limit = limit;
  }

  private canRun(): boolean {
    // Если мы уже запустили максимальное число задач, больше запустить мы не можем.
    if (this.runningTasksCount === this.limit) {
      return false;
    }

    // Если мы выполнили все задачи, то новую задачу мы запустить не можем.
    if (this.completedTasksCount === this.tasks.length) {
      return false;
    }

    // Задачи могут выполняться не по порядку. Если мы выполнили последнюю по списку
    // задачу, то мы не можем выполнить следующую, т.к. её не существует.
    if (this.runningTaskIndex === this.tasks.length - 1) {
      return false;
    }

    return true;
  }

  private runTask(taskIndex: number): void {
    this.runningTasksCount++;
    const promise = this.tasks[taskIndex];

    const handlePromiseResult = (result: ResultResolved<T> | ResultReject): void => {
      this.runningTasksCount--;
      this.completedTasksCount++;
      this.result[taskIndex] = result;

      if (this.canRun()) {
        this.runningTaskIndex++;
        this.runTask(this.runningTaskIndex);
      }

      this.emitter.emit("TASK_COMPLETED");
    };

    promise()
      .then((result) => {
        handlePromiseResult({ isResolved: true, result });
      })
      .catch((err) => {
        handlePromiseResult({ isResolved: false, error: err });
      });
  }

  public run(): Promise<Array<ResultResolved<T> | ResultReject>> {
    return new Promise((resolve) => {
      if (this.tasks.length === 0) {
        resolve([]);

        return;
      }

      this.emitter.on("TASK_COMPLETED", () => {
        if (this.completedTasksCount === this.tasks.length) {
          resolve(this.result);
        }
      });

      for (let i = 0; i < this.limit; i++) {
        if (this.canRun()) {
          this.runningTaskIndex++;
          this.runTask(this.runningTaskIndex);
        }
      }
    });
  }
}
