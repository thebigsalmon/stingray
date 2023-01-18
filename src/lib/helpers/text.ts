export const leadZeros = (value: number, length: number) => {
  let result = value.toString();

  while (result.length < length) {
    result = `0${result}`;
  }

  return result;
};

export const formatPhone = (phone: string): string => {
  const result = phone.replace(/(\d{1})(\d{3})(\d{3})(\d{2})(\d{2})/g, "+$1($2)$3-$4-$5");

  return result;
};

export const cleanPhone = (phone: string): string => {
  let result = phone.replace(/[^0-9]/g, "");
  result = result.replace(/^8/g, "7");

  if (result.length < 11) {
    throw new Error("phone should have 11 digits");
  }

  return result;
};

export const replaceAll = (src: string, find: string, replace: string): string => {
  let result = src;

  while (result.includes(find)) {
    result = result.replace(find, replace);
  }

  return result;
};

export const escapeCsvLine = (data: string | null | undefined): string => {
  if (!data) {
    return `""`;
  }

  const result = replaceAll(replaceAll(data, ";", ","), '"', "''");

  return `"${result}"`;
};

export const isGuid = (data: string): boolean => {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data);
};

export const generateRandomString = (length: number, alphabet?: string): string => {
  if (!alphabet) {
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  }

  let result = "";
  const alphabetSize = alphabet.length;

  for (let i = 0; i < length; i++) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabetSize));
  }

  return result;
};

export const htmlToPlainText = (html: string) => {
  let text = html;

  text = text.replace(/\n/gi, "");
  text = text.replace(/<style([\s\S]*?)<\/style>/gi, "");
  text = text.replace(/<script([\s\S]*?)<\/script>/gi, "");
  text = text.replace(/<a.*?href="(.*?)[?"].*?>(.*?)<\/a.*?>/gi, " $2 $1 ");
  text = text.replace(/<\/div>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<li.*?>/gi, "  *  ");
  text = text.replace(/<\/ul>/gi, "\n\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  // TODO fix this and write a test on this case
  // eslint-disable-next-line no-useless-escape
  text = text.replace(/<br\s*[\/]?>/gi, "\n");
  text = text.replace(/<[^>]+>/gi, "");
  text = text.replace(/^\s*/gim, "");
  text = text.replace(/ ,/gi, ",");
  text = text.replace(/ +/gi, " ");
  text = text.replace(/\n+/gi, "\n\n");

  text = replaceAll(text, "&nbsp;", " ");
  text = replaceAll(text, "&lt;", "<");
  text = replaceAll(text, "&gt;", ">");

  text = replaceAll(text, "  ", " ").trim();

  return text;
};
