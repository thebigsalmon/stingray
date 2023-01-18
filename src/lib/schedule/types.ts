export interface Task {
  name: string;
  interval: string;
  execute: () => Promise<unknown>;
}
