import { leadZeros } from "../helpers/text";

export const buildDate = (year: number, month: number, day: number): Date => {
  const sYear = year.toString();
  const sMonth = (month < 10 ? "0" : "") + month.toString();
  const sDay = (day < 10 ? "0" : "") + day.toString();

  const d = `${sYear}-${sMonth}-${sDay}T00:00:00Z`;

  return new Date(d);
};

export const buildDateTime = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date => {
  const sYear = year.toString();
  const sMonth = (month < 10 ? "0" : "") + month.toString();
  const sDay = (day < 10 ? "0" : "") + day.toString();
  const sHour = (hour < 10 ? "0" : "") + hour.toString();
  const sMinute = (minute < 10 ? "0" : "") + minute.toString();
  const sSecond = (second < 10 ? "0" : "") + second.toString();

  const d = `${sYear}-${sMonth}-${sDay}T${sHour}:${sMinute}:${sSecond}Z`;

  return new Date(d);
};

export const getDayStart = (date: Date): Date => {
  const newDate = new Date(date); // Required operation!
  return buildDateTime(newDate.getFullYear(), newDate.getMonth() + 1, newDate.getDate(), 0, 0, 0);
};

export const getDayEnd = (date: Date): Date => {
  const newDate = new Date(date); // Required operation!
  return buildDateTime(newDate.getFullYear(), newDate.getMonth() + 1, newDate.getDate(), 23, 59, 59);
};

export const addDays = (date: Date, daysCount: number): Date => {
  const newDate = new Date(date); // Required operation!
  return new Date(newDate.setDate(newDate.getDate() + daysCount));
};

export const dateDiffDays = (dateFirst: Date, dateSecond: Date): number => {
  const newDateFirst = new Date(dateFirst);
  const newDateSecond = new Date(dateSecond);

  return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / (1000 * 60 * 60 * 24));
};

export const dateDiffHours = (dateFirst: Date, dateSecond: Date): number => {
  const newDateFirst = new Date(dateFirst);
  const newDateSecond = new Date(dateSecond);

  return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / (1000 * 60 * 60));
};

export const dateDiffMinutes = (dateFirst: Date, dateSecond: Date): number => {
  const newDateFirst = new Date(dateFirst);
  const newDateSecond = new Date(dateSecond);

  return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / (1000 * 60));
};

export const dateDiffSeconds = (dateFirst: Date, dateSecond: Date): number => {
  const newDateFirst = new Date(dateFirst);
  const newDateSecond = new Date(dateSecond);

  return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / 1000);
};

export const addMonths = (date: Date, monthsCount: number): Date => {
  // TODO find out if the operation is that required
  const newDate = new Date(date); // Required operation!
  return new Date(newDate.setMonth(newDate.getMonth() + monthsCount));
};

export const addHours = (date: Date, hoursCount: number): Date => {
  // TODO find out if the operation is that required
  const newDate = new Date(date); // Required operation!
  return new Date(newDate.setHours(newDate.getHours() + hoursCount));
};

export const addMinutes = (date: Date, minutesCount: number): Date => {
  // TODO find out if the operation is that required
  const newDate = new Date(date); // Required operation!
  return new Date(newDate.setMinutes(newDate.getMinutes() + minutesCount));
};

export const compareDates = (dateFirst: Date, dateSecond: Date, operation: string): boolean => {
  const newDateFirst = new Date(dateFirst);
  const newDateSecond = new Date(dateSecond);

  switch (operation) {
    case ">=":
      return newDateFirst >= newDateSecond;
    case ">":
      return newDateFirst > newDateSecond;
    case "<=":
      return newDateFirst <= newDateSecond;
    case "<":
      return newDateFirst < newDateSecond;
    case "==":
      return newDateFirst.getTime() === newDateSecond.getTime();
    case "!=":
      return newDateFirst.getTime() !== newDateSecond.getTime();
    default:
      throw new Error(`Wrong operation in compareDates(): "${operation}"`);
  }
};

export const formatDateTime = (dateString: string | undefined | null): string | null => {
  if (!dateString) {
    return null;
  }

  const dtPart = dateString.split("T");
  const dPart = dtPart[0].split("-");

  if (dPart.length !== 3) {
    throw new Error(`Wrong dateTime: "${dateString}"`);
  }

  const year = Number(dPart[0]);
  const month = Number(dPart[1]);
  const day = Number(dPart[2]);

  let hour = 0;
  let minute = 0;
  let second = 0;

  if (dtPart.length == 2) {
    const tPart = dtPart[1].split(".")[0].split(":");

    if (tPart.length > 0) {
      hour = Number(tPart[0]);
    }

    if (tPart.length > 1) {
      minute = Number(tPart[1]);
    }

    if (tPart.length > 2) {
      second = Number(tPart[2]);
    }
  }

  return buildDateTime(year, month, day, hour, minute, second).toISOString();
};

export const formatUtcShift = (utcShift: string): string => {
  if (!utcShift) {
    return "";
  }

  if (utcShift.length > 6) {
    throw new Error(`Wrong utcShift: "${utcShift}"`);
  }

  let result = utcShift;

  const firstChar = result.substring(0, 1);
  const isMinus = firstChar === "-";
  if (["+", "-"].includes(firstChar)) {
    result = result.substring(1);
  }

  let separatorPos = -1;
  for (let i = 0; i < result.length; i++) {
    if (!["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":"].includes(result.substring(i, i + 1))) {
      throw new Error(`Wrong utcShift: "${utcShift}", char: "${result.substring(i, i + 1)}"`);
    }

    if (result.substring(i, i + 1) === ":") {
      if (separatorPos !== -1) {
        throw new Error(`Wrong utcShift: "${utcShift}", char: "${result.substring(i, i + 1)}"`);
      }

      separatorPos = i;
    }
  }

  if (separatorPos === 0 || (separatorPos !== -1 && separatorPos !== result.length - 3)) {
    throw new Error(`Wrong utcShift: "${utcShift}", char: "${result.substring(separatorPos, separatorPos + 1)}"`);
  }

  if (separatorPos === -1) {
    switch (result.length) {
      case 1:
        result = `0${result}:00`;
        break;
      case 2:
        result = `${result}:00`;
        break;
      case 3:
        result = `0${result.substring(0, 1)}:${result.substring(1, 3)}`;
        break;
      case 4:
        result = `${result.substring(0, 2)}:${result.substring(2, 4)}`;
        break;
    }
  }

  while (result.length < 5) {
    result = "0" + result;
  }

  if (isMinus) {
    result = "-" + result;
  } else {
    result = "+" + result;
  }

  return result;
};

export const applyUtcShiftToDateTime = (
  dateString: string | null,
  utcShift: string | null,
  isAdd: boolean,
): string | null => {
  if (!dateString) {
    return null;
  }

  if (!utcShift) {
    return dateString;
  }

  const utc = formatUtcShift(utcShift);

  const isMinus = utc.substring(0, 1) === "-";

  const modifier = !isMinus === isAdd ? 1 : -1;

  const hours = Number(utc.substring(1, 3)) * modifier;
  const minutes = Number(utc.substring(4)) * modifier;

  const dt = formatDateTime(dateString);

  if (!dt) {
    return null;
  }

  const result = addMinutes(addHours(new Date(dt), hours), minutes);

  return result.toISOString();
};

export class LocalDatetime {
  private year: number;
  private month: number;
  private day: number;
  private hour: number;
  private minute: number;
  private second: number;
  private millisecond: number;

  parse(dateTime: string) {
    if (!dateTime) {
      throw new Error(`Empty dateTime`);
    }

    if (dateTime.slice(-1) === "Z") {
      dateTime = dateTime.slice(0, -1);
    }

    let [strYear, strMonth, strDay] = ["", "", ""];
    let strTime = "";

    const dateTimePart = dateTime.split("T");
    const datePart = dateTimePart[0].split("-");

    if (datePart.length === 3) {
      [strYear, strMonth, strDay] = datePart;

      if (dateTimePart.length == 2) {
        strTime = dateTimePart[1];
      }
    } else {
      const dateTimePart = dateTime.split(" ");
      const datePart = dateTimePart[0].split(".");

      if (datePart.length === 3) {
        [strDay, strMonth, strYear] = datePart;

        if (dateTimePart.length == 2) {
          strTime = dateTimePart[1];
        }
      } else {
        throw new Error(`Wrong dateTime: "${dateTime}"`);
      }
    }

    // year
    this.year = Number(strYear);
    if (Number.isNaN(this.year)) {
      throw new Error(`Wrong year: "${strYear}"`);
    }

    // month
    this.month = Number(strMonth);
    if (Number.isNaN(this.month)) {
      throw new Error(`Wrong month: "${strMonth}"`);
    }
    if (this.month < 1 || this.month > 12) {
      throw new Error(`Wrong month: "${strMonth}"`);
    }

    // day
    this.day = Number(strDay);
    if (Number.isNaN(this.day)) {
      throw new Error(`Wrong day: "${strDay}"`);
    }
    if (this.day < 1 || this.day > 31) {
      throw new Error(`Wrong day: "${strDay}"`);
    }
    const dayMonthCheck = new Date(this.year, this.month - 1, this.day);
    if (dayMonthCheck.getMonth() !== this.month - 1) {
      throw new Error(`Wrong day: "${strDay}" / ${dayMonthCheck.getMonth()} / ${this.month}`);
    }

    this.hour = 0;
    this.minute = 0;
    this.second = 0;
    this.millisecond = 0;

    if (strTime) {
      if (strTime.split(".").length > 2) {
        throw new Error(`Wrong dateTime: "${strTime}"`);
      }

      const timePart = strTime.split(".")[0].split(":");

      // hour
      if (timePart.length > 0) {
        this.hour = Number(timePart[0]);
      }
      if (Number.isNaN(this.hour)) {
        throw new Error(`Wrong hour: "${timePart[0]}"`);
      }
      if (this.hour < 0 || this.hour > 23) {
        throw new Error(`Wrong hour: "${timePart[0]}"`);
      }

      // minute
      if (timePart.length > 1) {
        this.minute = Number(timePart[1]);
      }
      if (Number.isNaN(this.minute)) {
        throw new Error(`Wrong minute: "${timePart[1]}"`);
      }
      if (this.minute < 0 || this.minute > 59) {
        throw new Error(`Wrong minute: "${timePart[1]}"`);
      }

      // second
      if (timePart.length > 2) {
        this.second = Number(timePart[2]);
      }
      if (Number.isNaN(this.second)) {
        throw new Error(`Wrong second: "${timePart[2]}"`);
      }
      if (this.second < 0 || this.second > 59) {
        throw new Error(`Wrong second: "${timePart[2]}"`);
      }

      //millisecond
      if (strTime.split(".").length == 2) {
        this.millisecond = Number(strTime.split(".")[1]);
      }
      if (Number.isNaN(this.millisecond)) {
        throw new Error(`Wrong millisecond: "${strTime.split(".")[1]}"`);
      }
      if (this.millisecond < 0 || this.millisecond > 999) {
        throw new Error(`Wrong millisecond: "${strTime.split(".")[1]}"`);
      }
    }
  }

  setTimestamp(time: number) {
    const newDate = new Date(time * 1000);
    this.parse(newDate.toISOString());
  }

  setTimeMillisecondStamp(time: number) {
    const newDate = new Date(time);
    this.parse(newDate.toISOString());
  }

  constructor();
  constructor(param: { dateTime: string | undefined | null });
  constructor(param: { timestamp: number });
  constructor(param: {
    year?: number; //
    month?: number;
    day?: number;
  });
  constructor(param: {
    year?: number; //
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
  });
  constructor(param: {
    year?: number; //
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
    millisecond?: number;
  });
  constructor(param?: {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
    millisecond?: number;
    dateTime?: string | undefined | null;
    timestamp?: number;
  }) {
    this.year = 0;
    this.month = 0;
    this.day = 0;
    this.hour = 0;
    this.minute = 0;
    this.second = 0;
    this.millisecond = 0;

    if (param?.dateTime) {
      this.parse(param.dateTime);
    }
    if (param?.timestamp) {
      this.setTimestamp(param?.timestamp);
    }
    if (param?.year) {
      this.year = param.year;
    }
    if (param?.month) {
      this.month = param.month;
    }
    if (param?.day) {
      this.day = param.day;
    }
    if (param?.hour) {
      this.hour = param.hour;
    }
    if (param?.minute) {
      this.minute = param.minute;
    }
    if (param?.second) {
      this.second = param.second;
    }
    if (param?.millisecond) {
      this.millisecond = param.millisecond;
    }
  }

  isEmpty(): boolean {
    return (
      this.year === 0 &&
      this.month === 0 &&
      this.day === 0 &&
      this.hour === 0 &&
      this.minute === 0 &&
      this.second === 0 &&
      this.millisecond === 0
    );
  }

  valueOf() {
    return (
      this.getDate() + //
      "T" +
      leadZeros(this.hour, 2) + //
      ":" +
      leadZeros(this.minute, 2) +
      ":" +
      leadZeros(this.second, 2) +
      "." +
      leadZeros(this.millisecond, 3) +
      "Z"
    );
  }

  toString() {
    return this.valueOf();
  }

  clone(): LocalDatetime {
    return new LocalDatetime({
      year: this.year,
      month: this.month,
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      second: this.second,
      millisecond: this.millisecond,
    });
  }

  static buildDate(year: number, month: number, day: number): string {
    return (
      leadZeros(year, 4) + //
      "-" +
      leadZeros(month, 2) +
      "-" +
      leadZeros(day, 2) +
      "T00:00:00Z"
    );
  }

  static buildDateTime(year: number, month: number, day: number, hour: number, minute: number, second: number): string {
    return (
      leadZeros(year, 4) + //
      "-" +
      leadZeros(month, 2) +
      "-" +
      leadZeros(day, 2) +
      "T" +
      leadZeros(hour, 2) +
      ":" +
      leadZeros(minute, 2) +
      ":" +
      leadZeros(second, 2) +
      "Z"
    );
  }

  static isLeapYear(year: number): boolean {
    const feb29IsExists = new Date(year, 1, 29);
    return feb29IsExists.getMonth() === 1;
  }

  static timezoneOffsetToUtcShift(timezone: number): string {
    const sign = timezone < 0 ? "-" : "+";
    const h = Math.trunc(Math.abs(timezone) / 60);
    const m = Math.abs(timezone) - h * 60;

    return (
      sign + //
      leadZeros(h, 2) +
      ":" +
      leadZeros(m, 2)
    );
  }

  static formatUtcShift(utcShift: string): string {
    if (!utcShift) {
      return "";
    }

    if (utcShift.length > 6) {
      throw new Error(`Wrong utcShift: "${utcShift}"`);
    }

    let result = utcShift;

    const firstChar = result.substring(0, 1);
    const isMinus = firstChar === "-";
    if (["+", "-"].includes(firstChar)) {
      result = result.substring(1);
    }

    let separatorPos = -1;
    for (let i = 0; i < result.length; i++) {
      if (!["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":"].includes(result.substring(i, i + 1))) {
        throw new Error(`Wrong utcShift: "${utcShift}", char: "${result.substring(i, i + 1)}"`);
      }

      if (result.substring(i, i + 1) === ":") {
        if (separatorPos !== -1) {
          throw new Error(`Wrong utcShift: "${utcShift}", char: "${result.substring(i, i + 1)}"`);
        }

        separatorPos = i;
      }
    }

    if (separatorPos === 0 || (separatorPos !== -1 && separatorPos !== result.length - 3)) {
      throw new Error(`Wrong utcShift: "${utcShift}", char: "${result.substring(separatorPos, separatorPos + 1)}"`);
    }

    if (separatorPos === -1) {
      switch (result.length) {
        case 1:
          result = `0${result}:00`;
          break;
        case 2:
          result = `${result}:00`;
          break;
        case 3:
          result = `0${result.substring(0, 1)}:${result.substring(1, 3)}`;
          break;
        case 4:
          result = `${result.substring(0, 2)}:${result.substring(2, 4)}`;
          break;
      }
    }

    while (result.length < 5) {
      result = "0" + result;
    }

    if (isMinus) {
      result = "-" + result;
    } else {
      result = "+" + result;
    }

    return result;
  }

  static currentUtcShift() {
    const newDate = new Date(); // Required operation!
    const timezone = newDate.getTimezoneOffset();

    return LocalDatetime.timezoneOffsetToUtcShift(-1 * timezone);
  }

  static currentDateTimeUTC(): string {
    const newDate = new Date();

    const d = new LocalDatetime({ dateTime: newDate.toISOString() });
    return d.getDateTime();
  }

  static currentDateTimeLocal(): string {
    const d = new LocalDatetime({ dateTime: LocalDatetime.currentDateTimeUTC() });
    d.applyUtcShift(LocalDatetime.currentUtcShift(), "UTC_TO_LOCAL");

    return d.getDateTime();
  }

  applyUtcShift(utcShift: string, way: "UTC_TO_LOCAL" | "LOCAL_TO_UTC") {
    const utc = LocalDatetime.formatUtcShift(utcShift);

    const isMinus = utc.substring(0, 1) === "-";

    const modifier = !isMinus === (way === "UTC_TO_LOCAL") ? 1 : -1;

    const hours = Number(utc.substring(1, 3)) * modifier;
    const minutes = Number(utc.substring(4)) * modifier;

    this.addHours(hours);
    this.addMinutes(minutes);
  }

  getDate(): string {
    return (
      leadZeros(this.year, 4) + //
      "-" +
      leadZeros(this.month, 2) +
      "-" +
      leadZeros(this.day, 2)
    );
  }

  getDateTime(): string {
    return (
      this.getDate() + //
      "T" +
      leadZeros(this.hour, 2) + //
      ":" +
      leadZeros(this.minute, 2) +
      ":" +
      leadZeros(this.second, 2) +
      (this.millisecond > 0 ? "." + leadZeros(this.millisecond, 3) : "") +
      "Z"
    );
  }

  getDayStart(): string {
    return LocalDatetime.buildDateTime(this.year, this.month, this.day, 0, 0, 0);
  }

  getDayEnd(): string {
    return LocalDatetime.buildDateTime(this.year, this.month, this.day, 23, 59, 59);
  }

  setDayStart() {
    this.parse(this.getDayStart());
    return this;
  }

  setDayEnd() {
    this.parse(this.getDayEnd());
    return this;
  }

  getTimestamp(): number {
    const newDate = new Date(this.valueOf());
    return newDate.getTime() / 1000;
  }

  getTimeMillisecondStamp(): number {
    const newDate = new Date(this.valueOf());
    return newDate.getTime();
  }

  addYears(yearsCount: number) {
    this.year += yearsCount;
    return this;
  }

  addMonths(monthsCount: number) {
    const newDate = new Date(this.getDateTime());
    this.parse(new Date(newDate.setMonth(newDate.getMonth() + monthsCount)).toISOString());
    return this;
  }

  addDays(daysCount: number) {
    const newDate = new Date(this.getDateTime());
    this.parse(new Date(newDate.setDate(newDate.getDate() + daysCount)).toISOString());
    return this;
  }

  addHours(hoursCount: number) {
    const newDate = new Date(this.getDateTime());
    this.parse(new Date(newDate.setHours(newDate.getHours() + hoursCount)).toISOString());
    return this;
  }

  addMinutes(minutesCount: number) {
    const newDate = new Date(this.getDateTime());
    this.parse(new Date(newDate.setMinutes(newDate.getMinutes() + minutesCount)).toISOString());
    return this;
  }

  static getDiffDays(dateFirst: LocalDatetime, dateSecond: LocalDatetime): number {
    const newDateFirst = new Date(dateFirst.getDateTime());
    const newDateSecond = new Date(dateSecond.getDateTime());

    return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / (1000 * 60 * 60 * 24));
  }

  static getDiffHours(dateFirst: LocalDatetime, dateSecond: LocalDatetime): number {
    const newDateFirst = new Date(dateFirst.getDateTime());
    const newDateSecond = new Date(dateSecond.getDateTime());

    return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / (1000 * 60 * 60));
  }

  static getDiffMinutes(dateFirst: LocalDatetime, dateSecond: LocalDatetime): number {
    const newDateFirst = new Date(dateFirst.getDateTime());
    const newDateSecond = new Date(dateSecond.getDateTime());

    return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / (1000 * 60));
  }

  static getDiffSeconds(dateFirst: LocalDatetime, dateSecond: LocalDatetime): number {
    const newDateFirst = new Date(dateFirst.getDateTime());
    const newDateSecond = new Date(dateSecond.getDateTime());

    return Math.round((newDateSecond.getTime() - newDateFirst.getTime()) / 1000);
  }
}

export class StopwatchTimer {
  private startTime: [number, number];

  constructor() {
    this.startTime = process.hrtime();
  }

  reset() {
    this.startTime = process.hrtime();
  }

  getElapsedTime(): [number, number] {
    return process.hrtime(this.startTime);
  }

  getElapsedMilliSeconds(): string {
    const elapsedTime = process.hrtime(this.startTime);
    return `${Math.trunc((elapsedTime[0] + elapsedTime[1] / 1e9) * 1000)} ms`;
  }

  getElapsedMilliSecondsNumber(): number {
    const elapsedTime = process.hrtime(this.startTime);
    return Math.trunc((elapsedTime[0] + elapsedTime[1] / 1e9) * 1000);
  }

  getElapsedSeconds(): string {
    const elapsedTime = process.hrtime(this.startTime);
    return `${(elapsedTime[0] + elapsedTime[1] / 1e9).toFixed(3)} sec`;
  }
}
