import crypto from "crypto";
import {
  createWriteStream, //
  createReadStream,
  statSync,
} from "fs";
import {
  mkdir, //
  stat,
  writeFile,
  readdir,
  unlink,
} from "fs/promises";
import { resolve } from "path";

import axios from "axios";
import sharp from "sharp";
import archiver from "archiver";

import { relationsSyncState } from "../../../db/types";
import { FileModel } from "../../../db/model";

import { FilesFolder } from "../../constants";
import * as errors from "../../errors";
import { mimeTypes } from "../../mimes";
import {
  FilesStore, //
  decodeBase64Image,
  getFileFolder,
  getTargetDimensions,
  fileSyncResultItem,
} from "../../index";

export class FsFilesStore implements FilesStore {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async save({
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
  }> {
    if (!fileBase64) {
      throw errors.FileBase64IsEmpty();
    }

    const dirPath = `${this.rootDir}/${dir}`;

    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });

    if (!dirPath || !isDirectoryExists) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const buffer = decodeBase64Image(fileBase64);

    const sha256sum = crypto //
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    const fileChecksum = crypto //
      .createHash("md5")
      .update(buffer)
      .digest("hex");

    const extension = mimeTypes[mimeType];

    if (!extension) {
      throw errors.FileUnsupportedMimeType({ mimeType });
    }

    const fullPath = forceFileName ? `${dirPath}/${forceFileName}` : `${dirPath}/${sha256sum}.${extension}`;

    await writeFile(fullPath, buffer);

    return {
      fileChecksum: fileChecksum,
      filePath: `${sha256sum}.${extension}`,
      fileSize: buffer.length,
    };
  }

  async downloadFileByUrl({
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
  }> {
    const dirPath = `${this.rootDir}/${dir}`;

    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });

    if (!dirPath || !isDirectoryExists) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    const fullPath = `${dirPath}/${filename}`;

    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(fullPath);

      writeStream.on("finish", () => {
        let length = 0;
        const hash = crypto.createHash("md5");

        const readStream = createReadStream(fullPath);

        readStream.on("data", (chunk) => {
          length += chunk.length;
          hash.update(chunk);
        });

        readStream.on("error", (err) => {
          reject(err);
        });

        readStream.on("end", () => {
          resolve({
            fileChecksum: hash.digest("hex"),
            filePath: filename,
            fileSize: length,
          });
        });
      });

      response.data
        .pipe(writeStream) //
        .on("error", (err: unknown) => {
          reject(err);
        });
    });
  }

  async thumbnail({
    dir, //
    filename,
    size,
  }: {
    dir: string;
    filename: string;
    size: number;
  }): Promise<void> {
    const dirPath = `${this.rootDir}/${dir}`;

    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });

    if (!dirPath || !isDirectoryExists) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const image = sharp(resolve(this.rootDir, dir, filename));

    const { width = 0, height = 0 } = await image.metadata();

    if (width === 0 || height === 0) {
      throw errors.FileImageDimensionIsZero();
    }

    const [targetWidth, targetHeight] = getTargetDimensions({
      width, //
      height,
      size,
    });

    const buffer = await image //
      .resize(targetWidth, targetHeight)
      .withMetadata()
      .toBuffer();

    const thumbnailDirname = `${this.rootDir}/${dir}/${size}px`;

    try {
      const stats = await stat(thumbnailDirname);

      if (!stats.isDirectory()) {
        await mkdir(thumbnailDirname);
      }
    } catch (e) {
      if ((e as any)?.code !== "ENOENT") {
        throw e;
      }

      await mkdir(thumbnailDirname);
    }

    const fullPath = `${thumbnailDirname}/${filename}`;

    await writeFile(fullPath, buffer);
  }

  async saveModelFile<T extends FileModel>({
    existing,
    desirable,
    columns,
    usrAccSessionId,
  }: {
    existing: T[];
    desirable: T[];
    columns: string[];
    usrAccSessionId: string;
  }): Promise<fileSyncResultItem<T>[]> {
    const result: fileSyncResultItem<T>[] = [];

    // Получаем каталог с файлами данной сущности
    let fileFolder = "";
    if (desirable.length) {
      fileFolder = (<typeof FileModel>desirable[0].constructor).fileFolder;
    }

    for (let i = 0; i < desirable.length; i++) {
      let isFileSaved = false;
      const columnsWithFileFields: string[] = [...columns];

      let fileStats = { fileChecksum: "", filePath: "", fileSize: 0 };

      const fileBase64 = desirable[i]?.fileBase64;
      const mimeType = desirable[i]?.mimeType;

      // Сохраняем сам файл, если переданы поля fileBase64 и mimeType
      if (fileBase64 && mimeType) {
        fileStats = await this.save({
          dir: fileFolder,
          mimeType,
          fileBase64,
        });

        desirable[i].filePath = fileStats.filePath;
        desirable[i].fileChecksum = fileStats.fileChecksum;
        desirable[i].fileSize = fileStats.fileSize;

        columnsWithFileFields.push(desirable[i].columnByName({ columnName: "filePath", withAlias: true }));
        columnsWithFileFields.push(desirable[i].columnByName({ columnName: "fileChecksum", withAlias: true }));
        columnsWithFileFields.push(desirable[i].columnByName({ columnName: "fileSize", withAlias: true }));

        isFileSaved = true;
      }

      let indexInExisting = -1;

      if (existing) {
        indexInExisting = existing.findIndex((item) => item.id === desirable[i].id);
      }

      // Вставка, если файл новый
      if (indexInExisting === -1) {
        if (!isFileSaved) {
          throw errors.FileAttemptToSaveEmpty();
        }

        await desirable[i].insert({
          usrAccCreationId: usrAccSessionId,
        });

        result.push({
          model: desirable[i], //
          state: relationsSyncState.inserted,
          isFileSaved,
          indexInDesirable: i,
          indexInExisting: null,
        });

        continue;
      }

      // Изменение, если файл уже существовал
      const isChanged = desirable[i].differs(existing[indexInExisting], columnsWithFileFields);

      if (isChanged) {
        await desirable[i].update(null, {
          usrAccChangesId: usrAccSessionId,
          columns: columnsWithFileFields,
        });

        result.push({
          model: desirable[i], //
          state: relationsSyncState.updated,
          isFileSaved,
          indexInDesirable: i,
          indexInExisting,
        });
      } else {
        result.push({
          model: existing[indexInExisting], //
          state: relationsSyncState.untouched,
          isFileSaved,
          indexInDesirable: i,
          indexInExisting,
        });
      }
    }

    // Удалить файлы, которые отсутствуют в списке нужных файлов
    if (existing) {
      for (let i = 0; i < existing.length; i++) {
        const isModelStillPresented = desirable.some((item) => item.id === existing[i].id);

        if (isModelStillPresented) {
          continue;
        }

        await existing[i].delete({
          usrAccChangesId: usrAccSessionId,
        });

        result.push({
          model: existing[i], //
          state: relationsSyncState.deleted,
          isFileSaved: false,
          indexInDesirable: null,
          indexInExisting: i,
        });
      }
    }

    return result;
  }

  async archive({
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
  }): Promise<void> {
    const dir = getFileFolder(archivePath);

    if (dir) {
      const dirPath = `${this.rootDir}/${dir}`;

      const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });

      if (!dirPath || !isDirectoryExists) {
        throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
      }
    }

    const archiveFullPath = `${this.rootDir}/${archivePath}`;

    const output = createWriteStream(archiveFullPath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });
    archive.pipe(output);

    if (dataList) {
      for (let i = 0; i < dataList.length; i++) {
        archive.append(dataList[i].stringData, { name: dataList[i].destFilePath });
      }
    }

    if (filesList) {
      for (let i = 0; i < filesList.length; i++) {
        const isFileExists = await this.isFileExists({ filePath: filesList[i].srcFilePath });

        if (isFileExists) {
          const srcFullFilePath = `${this.rootDir}/${filesList[i].srcFilePath}`;

          archive.append(createReadStream(srcFullFilePath), { name: filesList[i].destFilePath });
        } else {
          throw errors.FilePathIsNotExists({ path: filesList[i].srcFilePath, type: "File" });
        }
      }
    }

    await archive.finalize();
  }

  async compressImage(src: string, quality: number): Promise<void> {
    if (quality <= 0 || quality >= 100) {
      throw errors.FileInsufficientCompressQuality({ quality });
    }

    const [extension] = src.split(".").slice(-1);

    const fullPath = `${this.rootDir}/${src}`;

    switch (extension) {
      case "jpg":
      case "jpeg": {
        const buffer = await sharp(fullPath) //
          .jpeg({ quality })
          .toBuffer();

        await writeFile(fullPath, buffer);

        break;
      }
      default:
        throw errors.FileUnsupportedExtension({ extension });
    }
  }

  async getFiles({
    dir,
    extensionFilterList = [],
  }: {
    dir: string;
    extensionFilterList?: string[];
  }): Promise<string[]> {
    const dirPath = `${this.rootDir}/${dir}`;

    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });

    if (!dirPath || !isDirectoryExists) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const files = await readdir(dirPath);

    if (extensionFilterList.length === 0) {
      return files;
    }

    return files.filter((x) => extensionFilterList.includes(x));
  }

  async isFileExists({ filePath }: { filePath: string }): Promise<boolean> {
    try {
      const stats = await stat(`${this.rootDir}/${filePath}`);
      return stats.isFile();
    } catch (err) {
      return false;
    }
  }

  async isDirectoryExists({ filePath }: { filePath: string }): Promise<boolean> {
    try {
      const stats = await stat(`${this.rootDir}/${filePath}`);
      return stats.isDirectory();
    } catch (err) {
      return false;
    }
  }

  async removeFile({ filePath }: { filePath: string }): Promise<void> {
    await unlink(`${this.rootDir}/${filePath}`);
  }

  async getFileSizeInBytes({ filePath }: { filePath: string }): Promise<number> {
    const fullPath = `${this.rootDir}/${filePath}`;

    const isFileExists = await this.isFileExists({ filePath });

    if (!filePath || !isFileExists) {
      throw errors.FilePathIsNotExists({ path: filePath, type: "File" });
    }

    const fileStat = await stat(fullPath);
    return fileStat.size;
  }

  getFileChecksum({ filePath, algorithm }: { filePath: string; algorithm: "md5" | "sha256" }): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log("--- I AM HERE");

      const fullPath = `${this.rootDir}/${filePath}`;

      let isExists = true;
      try {
        const stats = statSync(fullPath);
        isExists = stats.isFile();

        console.log("here", isExists, stats);
      } catch (err) {
        console.log("there");

        isExists = false;
      }

      if (!isExists) {
        throw errors.FilePathIsNotExists({ path: filePath, type: "File" });
      }

      const hash = crypto.createHash(algorithm);
      const rs = createReadStream(fullPath);

      rs.on("open", function () {
        //
      });

      rs.on("error", function (err) {
        reject(err);
      });

      rs.on("data", function (chunk) {
        hash.update(chunk);
      });

      rs.on("close", function () {
        resolve(hash.digest("hex"));
      });
    });
  }

  getFileChecksumMD5({ filePath }: { filePath: string }): Promise<string> {
    return this.getFileChecksum({ algorithm: "md5", filePath });
  }

  getFileChecksumSHA256({ filePath }: { filePath: string }): Promise<string> {
    return this.getFileChecksum({ algorithm: "sha256", filePath });
  }
}
