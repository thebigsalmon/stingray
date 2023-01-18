import { ClientError } from "../server/errors";

export const FileStringIsNotBase64 = (data: { base64str: string }): ClientError => {
  return new ClientError("FileStringIsNotBase64", "String is not a base64str.", data);
};

export const FileBase64IsEmpty = (): ClientError => {
  return new ClientError("FileBase64IsEmpty", "File base64 is empty.");
};

export const FileUnsupportedMimeType = (data: { mimeType: string }): ClientError => {
  return new ClientError("FileUnsupportedMimeType", "Unsupported mime type.", data);
};

export const FileUnsupportedExtension = (data: { extension: string }): ClientError => {
  return new ClientError("FileUnsupportedExtension", "Unsupported extension.", data);
};

export const FileAttemptToSaveEmpty = (): ClientError => {
  return new ClientError("FileAttemptToSaveEmpty", "Attempt to save empty file.");
};

export const FileImageDimensionIsZero = (): ClientError => {
  return new ClientError("FileImageDimensionIsZero", "Zero image dimension detected.");
};

export const FilePathIsNotExists = (data: { path: string; type: "File" | "Directory" }): ClientError => {
  return new ClientError("FilePathIsNotExists", "Path is not exists.", data);
};

export const FileInsufficientCompressQuality = (data: { quality: number }): ClientError => {
  return new ClientError(
    "FileInsufficientCompressQuality",
    "Insufficient quality: quality must be in range between 1 and 100.",
    data,
  );
};
