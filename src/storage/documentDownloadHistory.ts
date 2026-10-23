import { Directory, File, Paths } from "expo-file-system";
import {
  DocumentError,
  validateDownloadRecords,
  type DownloadHistory,
  type DownloadRecords,
} from "../domain/documents";

/** Retains only account/document/revision hashes, separate from credentials and downloaded bytes. */
export class DeviceDownloadHistory implements DownloadHistory {
  private queue: Promise<unknown> = Promise.resolve();
  private file(account: string) {
    if (!/^[a-f0-9]{64}$/.test(account)) throw new DocumentError("history");
    const directory = new Directory(Paths.document, "download-history-v1");
    directory.create({ intermediates: true, idempotent: true });
    return new File(directory, `${account}.json`);
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation).catch(() => {
      throw new DocumentError("history");
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async load(file: File): Promise<DownloadRecords> {
    if (!file.exists) return {};
    if (file.size > 16 * 1024 * 1024) throw new DocumentError("history");
    return validateDownloadRecords(JSON.parse(await file.text()));
  }
  read(account: string) {
    return this.serialize(() => this.load(this.file(account)));
  }
  commit(account: string, records: DownloadRecords) {
    return this.serialize(async () => {
      const target = this.file(account);
      const merged = validateDownloadRecords({
        ...(await this.load(target)),
        ...validateDownloadRecords(records),
      });
      const temporary = new File(target.parentDirectory, `${account}.pending`);
      temporary.create({ overwrite: true });
      await temporary.write(JSON.stringify(merged));
      // A corrupt/interrupted metadata write blocks skipping rather than assuming a saved ZIP.
      await temporary.move(target, { overwrite: true });
    });
  }
  clear(account: string) {
    return this.serialize(async () => {
      const file = this.file(account);
      if (file.exists) file.delete();
      const pending = new File(file.parentDirectory, `${account}.pending`);
      if (pending.exists) pending.delete();
    });
  }
}
