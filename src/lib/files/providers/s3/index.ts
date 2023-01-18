import crypto from "crypto";
import {
  createReadStream, //
  createWriteStream,
  ReadStream,
  statSync,
} from "fs";
import {
  stat, //
  unlink,
  writeFile,
} from "fs/promises";
import { resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

import {
  S3Client, //
  S3ClientConfig,
  NotFound,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsCommand,
} from "@aws-sdk/client-s3";
import archiver, { Archiver } from "archiver";
import axios from "axios";
import sharp from "sharp";
import { v4 } from "uuid";

import { FileModel } from "../../../db/model";
import { relationsSyncState } from "../../../db/types";
import {
  decodeBase64Image, //
  FilesStore,
  fileSyncResultItem,
  getFileFolder,
  getTargetDimensions,
} from "../../../files";
import { mimeTypes } from "../../../files/mimes";
import { ConcurrentPromiseBatch, isResultResolved } from "../../../helpers/promise";
import * as errors from "../../errors";

export class S3FilesStore implements FilesStore {
  private client: S3Client;

  constructor(
    config: S3ClientConfig, //
    private Bucket: string,
    private tmpDir: string,
    private fsRootDir: string,
  ) {
    this.client = new S3Client(config);
  }

  async save({
    dir,
    mimeType,
    fileBase64,
    forceFileName,
  }: {
    dir: string;
    mimeType: string;
    fileBase64: string;
    forceFileName?: string;
  }): Promise<{ fileChecksum: string; filePath: string; fileSize: number }> {
    if (!fileBase64) {
      throw errors.FileBase64IsEmpty();
    }

    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });
    if (!isDirectoryExists) {
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

    const fileChecksum128bit = crypto //
      .createHash("md5")
      .update(buffer)
      .digest("base64");

    const extension = mimeTypes[mimeType];

    if (!extension) {
      throw errors.FileUnsupportedMimeType({ mimeType });
    }

    const fullPath = forceFileName ? `${dir}/${forceFileName}` : `${dir}/${sha256sum}.${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.Bucket,
        Key: fullPath,
        Body: buffer,
        ContentMD5: fileChecksum128bit,
      }),
    );

    return {
      fileChecksum: fileChecksum,
      filePath: `${sha256sum}.${extension}`,
      fileSize: buffer.length,
    };
  }

  async downloadFileByUrl({
    url,
    dir,
    filename,
  }: {
    url: string;
    dir: string;
    filename: string;
  }): Promise<{ fileChecksum: string; filePath: string; fileSize: number }> {
    const {
      fileChecksum, //
      fileChecksum128bit,
      fullFilePath,
      fileSize,
    } = await this.downloadTempFileByUrl(url);

    const readStream = createReadStream(fullFilePath);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.Bucket,
        Key: `${dir}/${filename}`,
        Body: readStream,
        ContentMD5: fileChecksum128bit,
      }),
    );

    await unlink(fullFilePath);

    return {
      fileChecksum,
      filePath: filename,
      fileSize,
    };
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
    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });

    if (!isDirectoryExists) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const tempSrcFileName = await this.downloadTempFile({ filePath: `${dir}/${filename}` });

    // See: https://github.com/lovell/sharp/issues/1691
    const image = sharp(resolve(tempSrcFileName), { failOnError: false });

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

    await unlink(tempSrcFileName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.Bucket,
        Key: `${dir}/${size}px/${filename}`,
        Body: buffer,
      }),
    );
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
    filesList?: { srcFilePath: string; destFilePath: string }[] | undefined;
    dataList?: { stringData: string; destFilePath: string }[] | undefined;
    archivePath: string;
  }): Promise<void> {
    const dir = getFileFolder(archivePath);
    if (!dir) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const isDirectoryExists = await this.isDirectoryExists({ filePath: dir });
    if (!isDirectoryExists) {
      throw errors.FilePathIsNotExists({ path: dir, type: "Directory" });
    }

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    if (dataList) {
      for (let i = 0; i < dataList.length; i++) {
        archive.append(dataList[i].stringData, { name: dataList[i].destFilePath });
      }
    }

    const tmpFilesList: string[] = [];

    const promises: Array<() => Promise<{ stream: ReadStream; name: string }>> = [];

    if (filesList) {
      for (let i = 0; i < filesList.length; i++) {
        promises.push(async (): Promise<{ stream: ReadStream; name: string }> => {
          const isFileExists = await this.isFileExists({ filePath: filesList[i].srcFilePath });

          if (isFileExists) {
            const tempFileName = await this.downloadTempFile({ filePath: filesList[i].srcFilePath });

            tmpFilesList.push(tempFileName);

            return { stream: createReadStream(tempFileName), name: filesList[i].destFilePath };
          } else {
            const isFileExists = await this.isFileExistsInFs({ filePath: filesList[i].srcFilePath });

            if (isFileExists) {
              const srcFullFilePath = `${this.fsRootDir}/${filesList[i].srcFilePath}`;

              return { stream: createReadStream(srcFullFilePath), name: filesList[i].destFilePath };
            } else {
              throw errors.FilePathIsNotExists({ path: filesList[i].srcFilePath, type: "File" });
            }
          }
        });
      }
    }

    const streams = await new ConcurrentPromiseBatch(promises, 10).run();
    const fulfilled = streams.filter(isResultResolved);

    if (fulfilled.length !== streams.length) {
      throw new Error("has rejected");
    }

    for (let i = 0; i < fulfilled.length; i++) {
      archive.append(fulfilled[i].result.stream, { name: fulfilled[i].result.name });
    }

    const tmpArchivePath = `${this.tmpDir}/${v4()}`;

    await this.writeTempArchive(archive, tmpArchivePath);

    const readStream = createReadStream(tmpArchivePath);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.Bucket,
        Key: archivePath,
        Body: readStream,
      }),
    );

    for (let i = 0; i < tmpFilesList.length; i++) {
      await unlink(tmpFilesList[i]);
    }

    await unlink(tmpArchivePath);
  }

  async compressImage(src: string, quality: number): Promise<void> {
    if (quality <= 0 || quality >= 100) {
      throw errors.FileInsufficientCompressQuality({ quality });
    }

    const [extension] = src.split(".").slice(-1);

    const fullTmpFilePath = await this.downloadTempFile({ filePath: src });

    switch (extension) {
      case "jpg":
      case "jpeg": {
        const buffer = await sharp(fullTmpFilePath) //
          .jpeg({ quality })
          .toBuffer();

        await writeFile(fullTmpFilePath, buffer);

        break;
      }
      default:
        throw errors.FileUnsupportedExtension({ extension });
    }

    const readStream = createReadStream(fullTmpFilePath);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.Bucket,
        Key: src,
        Body: readStream,
      }),
    );

    await unlink(fullTmpFilePath);
  }

  async getFiles({
    dir,
    extensionFilterList = [],
  }: {
    dir: string;
    extensionFilterList?: string[] | undefined;
  }): Promise<string[]> {
    const list = await this.client.send(
      new ListObjectsCommand({
        Bucket: this.Bucket,
        Prefix: dir,
      }),
    );

    if (!list.Contents) {
      throw new Error("No contents");
    }

    const files = list.Contents.filter(({ Key }) => {
      if (!Key) {
        return false;
      }

      if (Key === dir) {
        return false;
      }

      const filePart = Key.substring(dir.length + 1);
      const [, extension] = filePart.split(".");

      if (filePart.split("/").length !== 1) {
        return false;
      }

      if (!extension) {
        return false;
      }

      if (extensionFilterList?.length === 0) {
        return true;
      }

      return extensionFilterList.includes(extension);
    }).map(({ Key }) => Key!.substring(dir.length + 1));

    return files;
  }

  async isFileExists({ filePath }: { filePath: string }): Promise<boolean> {
    try {
      const data = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.Bucket,
          Key: filePath,
        }),
      );

      if (data.ContentType === "application/directory") {
        return false;
      }

      return true;
    } catch (e) {
      if (e instanceof NotFound) {
        return false;
      }

      throw e;
    }
  }

  async isDirectoryExists({ filePath }: { filePath: string }): Promise<boolean> {
    try {
      const data = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.Bucket,
          Key: filePath,
        }),
      );

      if (data.ContentType === "application/directory") {
        return true;
      }

      return false;
    } catch (e) {
      if (e instanceof NotFound) {
        return false;
      }

      throw e;
    }
  }

  async removeFile({ filePath }: { filePath: string }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.Bucket,
        Key: filePath,
      }),
    );
  }

  async getFileSizeInBytes({ filePath }: { filePath: string }): Promise<number> {
    const isExists = await this.isFileExists({ filePath });
    if (!isExists) {
      throw errors.FilePathIsNotExists({ path: filePath, type: "File" });
    }

    const data = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.Bucket,
        Key: filePath,
      }),
    );

    if (!data.ContentLength) {
      console.warn("File size is zero", filePath);

      return 0;
    }

    return data.ContentLength;
  }

  async getFileChecksum({ filePath, algorithm }: { filePath: string; algorithm: "sha256" | "md5" }): Promise<string> {
    const fullTmpFilePath = await this.downloadTempFile({ filePath });

    const sum = await getFileChecksum({ fullPath: fullTmpFilePath, algorithm });

    await unlink(fullTmpFilePath);

    return sum;
  }

  getFileChecksumMD5({ filePath }: { filePath: string }): Promise<string> {
    return this.getFileChecksum({ algorithm: "md5", filePath });
  }

  getFileChecksumSHA256({ filePath }: { filePath: string }): Promise<string> {
    return this.getFileChecksum({ algorithm: "sha256", filePath });
  }

  private writeTempArchive(archive: Archiver, tmpArchivePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(tmpArchivePath);

      output.on("close", () => resolve());

      output.on("error", (e) => reject(e));

      archive.pipe(output);

      archive.finalize();
    });
  }

  private async downloadTempFile({ filePath }: { filePath: string }): Promise<string> {
    const isExists = await this.isFileExists({ filePath });
    if (!isExists) {
      throw errors.FilePathIsNotExists({ path: filePath, type: "File" });
    }

    const data = await this.client.send(
      new GetObjectCommand({
        Bucket: this.Bucket,
        Key: filePath,
      }),
    );

    if (!data.Body) {
      throw new Error("Empty response");
    }

    const fullTmpFilePath = `${this.tmpDir}/${v4()}`;

    const writeStream = createWriteStream(fullTmpFilePath);

    await pipeline(
      data.Body as Readable, //
      writeStream,
    );

    return fullTmpFilePath;
  }

  private async downloadTempFileByUrl(url: string): Promise<{
    fileChecksum: string;
    fileChecksum128bit: string;
    fullFilePath: string;
    fileSize: number;
  }> {
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    const tempFileName = v4();

    const fullPath = `${this.tmpDir}/${tempFileName}`;

    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(fullPath);

      writeStream.on("finish", () => {
        let length = 0;
        const hash = crypto.createHash("md5");
        const hash128bit = crypto.createHash("md5");

        const readStream = createReadStream(fullPath);

        readStream.on("data", (chunk) => {
          length += chunk.length;
          hash.update(chunk);
          hash128bit.update(chunk);
        });

        readStream.on("error", (err) => {
          reject(err);
        });

        readStream.on("end", () => {
          resolve({
            fileChecksum: hash.digest("hex"),
            fileChecksum128bit: hash128bit.digest("base64"),
            fullFilePath: fullPath,
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

  private async isFileExistsInFs({ filePath }: { filePath: string }): Promise<boolean> {
    try {
      const stats = await stat(`${this.fsRootDir}/${filePath}`);
      return stats.isFile();
    } catch (err) {
      return false;
    }
  }
}

function getFileChecksum({ fullPath, algorithm }: { fullPath: string; algorithm: "md5" | "sha256" }): Promise<string> {
  return new Promise((resolve, reject) => {
    let isExists = true;
    try {
      const stats = statSync(fullPath);
      isExists = stats.isFile();
    } catch (err) {
      isExists = false;
    }

    if (!isExists) {
      throw errors.FilePathIsNotExists({ path: fullPath, type: "File" });
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
