import { GenericObject } from "../db/types";

type LogLevel =
  | "error" //
  | "warning"
  | "info"
  | "debug";

const logLevelOrder: LogLevel[] = [
  "error", //
  "warning",
  "info",
  "debug",
];

function isLogLevel(level: string): level is LogLevel {
  return logLevelOrder.some((item) => (item as string) === level);
}

export class Logger {
  private logLevel: LogLevel;

  constructor(private service: string, logLevel = "info") {
    if (!isLogLevel(logLevel)) {
      throw new Error(`Unknown log level: ${logLevel}`);
    }

    this.logLevel = logLevel;
  }

  getLogLevel() {
    return this.logLevel;
  }

  info(message: string, attributes?: GenericObject) {
    this.log("info", message, attributes);
  }

  warning(message: string, attributes?: GenericObject) {
    this.log("warning", message, attributes);
  }

  error(message: string, attributes?: GenericObject) {
    this.log("error", message, attributes);
  }

  debug(message: string, attributes?: GenericObject) {
    this.log("debug", message, attributes);
  }

  private log(
    level: LogLevel, //
    message: string,
    attributes?: GenericObject,
  ): void {
    if (logLevelOrder.indexOf(level) > logLevelOrder.indexOf(this.logLevel)) {
      return;
    }

    console.log(
      JSON.stringify({
        level, //
        service: this.service,
        message,
        ...attributes,
      }),
    );
  }
}
