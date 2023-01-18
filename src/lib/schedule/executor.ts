import schedule from "node-schedule";
import { v4 } from "uuid";

import { StopwatchTimer } from "../helpers/datetime";

import { Task } from "./types";

export class TaskExecutor {
  private tasksById: { [key: string]: Task } = {};

  private busyById: { [key: string]: boolean } = {};

  add(task: Task): void {
    const taskId = v4();

    this.tasksById[taskId] = task;

    this.busyById[taskId] = false;
  }

  start(): void {
    console.log("Task executor started");

    for (const [taskId, task] of Object.entries(this.tasksById)) {
      schedule.scheduleJob(task.interval, async () => {
        if (this.busyById[taskId]) {
          console.log(
            `Task ${task.name} is still running, new task will not be executed until current running task ends`,
          );

          return;
        }

        console.log(`Task ${task.name} is started`);

        this.busyById[taskId] = true;

        const operationTimer = new StopwatchTimer();

        try {
          await task.execute();

          console.log(`Task ${task.name} executed, elapsed ${operationTimer.getElapsedSeconds()}`);
        } catch (e) {
          console.error(`Task ${task.name} ended with an error, ${e}`);
        } finally {
          this.busyById[taskId] = false;
        }
      });
    }
  }
}
