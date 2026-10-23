import {
  DocumentError,
  validateDownloadRecords,
  type DownloadHistory,
  type DownloadRecords,
} from "../../../../src/domain/documents";

const key = (value: string) => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new DocumentError("history");
  return value;
};
/** One read/merge/write transaction prevents lost history updates across browser tabs. */
export class BrowserDownloadHistory implements DownloadHistory {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let abandoned = false;
      const request = indexedDB.open("better-myepitech-downloads", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("accounts");
      };
      request.onsuccess = () => {
        if (abandoned) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(new DocumentError("history"));
      request.onblocked = () => {
        abandoned = true;
        reject(new DocumentError("history"));
      };
    });
  }
  private async transaction<T>(
    account: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, finish: (value: T) => void) => void,
  ): Promise<T> {
    key(account);
    let db: IDBDatabase;
    try {
      db = await this.open();
    } catch {
      throw new DocumentError("history");
    }
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction("accounts", mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(new DocumentError("history"));
        try {
          operation(tx.objectStore("accounts"), (value) => {
            result = value;
          });
        } catch {
          tx.abort();
        }
      });
    } finally {
      db.close();
    }
  }
  read(account: string) {
    return this.transaction<DownloadRecords>(
      account,
      "readonly",
      (store, finish) => {
        const request = store.get(account);
        request.onsuccess = () => {
          try {
            finish(
              request.result === undefined
                ? {}
                : validateDownloadRecords(request.result),
            );
          } catch {
            request.transaction?.abort();
          }
        };
      },
    );
  }
  async commit(account: string, records: DownloadRecords) {
    const safe = validateDownloadRecords(records);
    return this.transaction<void>(account, "readwrite", (store, finish) => {
      const request = store.get(account);
      request.onsuccess = () => {
        try {
          const previous =
            request.result === undefined
              ? {}
              : validateDownloadRecords(request.result);
          store.put(validateDownloadRecords({ ...previous, ...safe }), account);
          finish();
        } catch {
          request.transaction?.abort();
        }
      };
    });
  }
  clear(account: string) {
    return this.transaction<void>(account, "readwrite", (store, finish) => {
      store.delete(account);
      finish();
    });
  }
}
