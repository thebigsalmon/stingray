import { relationsSyncState } from "../db/types";
import { FileModel } from "../db/model";

import { FilesFolder } from "./constants";
import * as errors from "./errors";

export const getRootFolder = (filePath: string): string => {
  const rootDir = filePath.split("/").shift();
  return rootDir ? rootDir : "";
};

export const getFileExtension = (fileName: string): string => {
  const ext = fileName.split(".").pop();
  return ext ? ext : "";
};

export const getFileName = (filePath: string): string => {
  const fileName = filePath.split("/").pop();
  return fileName ? fileName : "";
};

export const getFileFolder = (filePath: string): string => {
  const fileName = getFileName(filePath);
  return fileName ? filePath.substring(0, filePath.length - fileName.length - 1) : "";
};

export const getFileThumbPath = (filePath: string, size: number): string => {
  const fileName = getFileName(filePath);
  const fileFolder = getFileFolder(filePath);

  return fileName && fileFolder ? `${fileFolder}/${size}px/${fileName}` : "";
};

export const decodeBase64Image = (base64str: string): Buffer => {
  const matches = base64str.match(/^data:([A-Za-z0-9-+/]+);base64,(.+)$/);

  if (!matches || matches.length !== 3) {
    throw errors.FileStringIsNotBase64({ base64str: base64str });
  }

  return Buffer.from(matches[2], "base64");
};

export const getTargetDimensions = ({
  width,
  height,
  size,
}: {
  width: number;
  height: number;
  size: number;
}): [number, number] => {
  if (width >= height) {
    const scale = width / size;

    return [size, Math.trunc(height / scale)];
  }

  const scale = height / size;

  return [Math.trunc(width / scale), size];
};

export interface fileSyncResultItem<T> {
  model: T; //
  state: relationsSyncState;
  isFileSaved: boolean;
  indexInDesirable: number | null;
  indexInExisting: number | null;
}

export interface FilesStore {
  save({
    dir, //
    mimeType,
    fileBase64,
    forceFileName,
  }: {
    dir: FilesFolder;
    mimeType: string;
    fileBase64: string;
    forceFileName?: string;
  }): Promise<{
    fileChecksum: string;
    filePath: string;
    fileSize: number;
  }>;

  downloadFileByUrl({
    url, //
    dir,
    filename,
  }: {
    url: string;
    dir: string;
    filename: string;
  }): Promise<{
    fileChecksum: string;
    filePath: string;
    fileSize: number;
  }>;

  thumbnail({
    dir, //
    filename,
    size,
  }: {
    dir: string;
    filename: string;
    size: number;
  }): Promise<void>;

  saveModelFile<T extends FileModel>({
    existing,
    desirable,
    columns,
    usrAccSessionId,
  }: {
    existing: T[];
    desirable: T[];
    columns: string[];
    usrAccSessionId: string;
  }): Promise<fileSyncResultItem<T>[]>;

  archive({
    filesList,
    dataList,
    archivePath,
  }: {
    filesList?: {
      srcFilePath: string;
      destFilePath: string;
    }[];
    dataList?: {
      stringData: string;
      destFilePath: string;
    }[];
    archivePath: string;
  }): Promise<void>;

  compressImage(src: string, quality: number): Promise<void>;

  getFiles({ dir, extensionFilterList }: { dir: string; extensionFilterList?: string[] }): Promise<string[]>;

  isFileExists({ filePath }: { filePath: string }): Promise<boolean>;

  isDirectoryExists({ filePath }: { filePath: string }): Promise<boolean>;

  removeFile({ filePath }: { filePath: string }): Promise<void>;

  getFileSizeInBytes({ filePath }: { filePath: string }): Promise<number>;

  getFileChecksum({ filePath, algorithm }: { filePath: string; algorithm: "md5" | "sha256" }): Promise<string>;

  getFileChecksumMD5({ filePath }: { filePath: string }): Promise<string>;

  getFileChecksumSHA256({ filePath }: { filePath: string }): Promise<string>;
}
