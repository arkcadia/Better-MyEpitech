import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import {
  DocumentError,
  type ArchiveFactory,
  type SavedArchive,
} from "../../domain/documents";

const zipDirectory = () => {
  const directory = new Directory(Paths.cache, "document-zips");
  directory.create({ intermediates: true, idempotent: true });
  return directory;
};
export function clearOrphanDocumentZips() {
  for (const file of zipDirectory().list())
    if (
      file instanceof File &&
      /^epitech-documents-[a-f0-9-]+\.zip$/.test(file.name)
    )
      file.delete();
}
export const deviceArchive: ArchiveFactory = async () => {
  const file = new File(
    zipDirectory(),
    `epitech-documents-${Crypto.randomUUID()}.zip`,
  );
  file.create();
  const handle = file.open();
  let closed = false;
  const close = () => {
    if (!closed) {
      handle.close();
      closed = true;
    }
  };
  const dispose = async () => {
    close();
    if (file.exists) file.delete();
  };
  return {
    async write(chunk) {
      if (closed) throw new DocumentError("storage");
      await handle.writeBytes(chunk);
    },
    async finish() {
      close();
      const artifact: SavedArchive = {
        confirmed: false,
        async save() {
          const directory = await Directory.pickDirectoryAsync();
          if (!file.exists) throw new DocumentError("cancelled");
          const destination = new File(directory, file.name);
          if (destination.exists) throw new DocumentError("storage");
          try {
            await file.copy(destination);
            artifact.confirmed = true;
          } catch {
            if (destination.exists) destination.delete();
            throw new DocumentError("storage");
          }
        },
        async share() {
          if (!(await Sharing.isAvailableAsync()))
            throw new DocumentError("storage");
          await Sharing.shareAsync(file.uri, {
            mimeType: "application/zip",
            dialogTitle: "Save your Epitech documents ZIP",
            UTI: "public.zip-archive",
          });
        },
        dispose,
      };
      return artifact;
    },
    abort: dispose,
  };
};
