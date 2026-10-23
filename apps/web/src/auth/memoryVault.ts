import type { SessionVault, StoredSession } from "../../../../src/domain/auth";

/** A browser reload intentionally signs out. Never writes provider credentials to Web Storage. */
export class MemorySessionVault implements SessionVault {
  private session: StoredSession | null = null;
  async read() {
    return this.session;
  }
  async write(session: StoredSession) {
    this.session = session;
  }
  async clear() {
    this.session = null;
  }
}
