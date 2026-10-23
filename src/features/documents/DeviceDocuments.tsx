import { isMissingDocumentStatus } from "../../application/documentManager";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { SessionManager } from "../../application/sessionManager";
import { fileCategory, fileExtension } from "../../application/documentFiles";
import { createDeviceDocumentManager } from "../../providers/documents/createDeviceManager";
import { deviceArchive } from "../../providers/documents/deviceArchive";

const labels = {
  new: "New",
  changed: "Updated",
  downloaded: "Saved version",
  unversioned: "Saved · version unknown",
};
export function DeviceDocuments({
  session,
  login,
}: {
  session: SessionManager;
  login: string;
}) {
  const [manager] = useState(() => createDeviceDocumentManager(session));
  const state = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const [search, setSearch] = useState("");
  const [extension, setExtension] = useState("all");
  const [missingOnly, setMissingOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const [saveRequested, setSaveRequested] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  useEffect(() => {
    manager.setAccount(login);
    return () => manager.setAccount(null);
  }, [manager, login]);
  useEffect(() => {
    setSelected(
      new Set(
        state.index?.documents
          .filter((doc) => isMissingDocumentStatus(state.states[doc.id]))
          .map((doc) => doc.id) ?? [],
      ),
    );
  }, [state.index, state.states]);
  useEffect(() => {
    if (state.status !== "awaiting_confirmation") setSaveRequested(false);
  }, [state.status]);
  const documents =
    state.account === login ? (state.index?.documents ?? []) : [];
  const extensions = useMemo(
    () => [...new Set(documents.map((doc) => fileExtension(doc.name)))].sort(),
    [state.index],
  );
  const filtered = documents
    .filter(
      (doc) =>
        (extension === "all" || fileExtension(doc.name) === extension) &&
        (!missingOnly || isMissingDocumentStatus(state.states[doc.id])) &&
        `${doc.name} ${doc.context}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        fileExtension(a.name).localeCompare(fileExtension(b.name)) ||
        a.name.localeCompare(b.name),
    );
  const ids = filtered
    .filter((doc) => selected.has(doc.id))
    .map((doc) => doc.id);
  const missing = ids.filter((id) => isMissingDocumentStatus(state.states[id]));
  const busy = ["scanning", "exporting", "awaiting_confirmation"].includes(
    state.status,
  );
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        Your documents
      </Text>
      <Text style={styles.body}>
        Discover supported personal, project, activity, e-learning and follow-up
        files. ZIPs group files by type and extension. Download history
        remembers saved versions on this device, separately for each school
        account.
      </Text>
      <Button
        label="Find / refresh accessible documents"
        disabled={busy}
        onPress={() => void manager.scan()}
      />
      {["scanning", "exporting"].includes(state.status) && (
        <>
          <ActivityIndicator />
          <Button
            secondary
            label="Cancel document operation"
            onPress={() => manager.cancel()}
          />
        </>
      )}
      {state.issue && (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.issue}
        </Text>
      )}
      {state.progress && (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          ZIP: {state.progress.completed} / {state.progress.total} files ·{" "}
          {(state.progress.bytes / 1048576).toFixed(1)} MiB. History stays
          unchanged until saved.
        </Text>
      )}
      {state.status === "awaiting_confirmation" && (
        <View style={styles.card}>
          <Text style={styles.title}>Your ZIP is ready</Text>
          <Text style={styles.body}>
            Choose a local folder to save a copy to your device, or use the
            Android share sheet. Confirm only after saving; closing the share
            sheet does not prove the ZIP was saved.
          </Text>
          <Button
            label="Save ZIP to a device folder"
            onPress={() => {
              void manager
                .saveZip()
                .then((completed) => setSaveRequested(completed));
            }}
          />
          <Button
            secondary
            label="Share ZIP"
            onPress={() => {
              void manager
                .shareZip()
                .then((started) => setSaveRequested(started));
            }}
          />
          <Button
            label="I saved the ZIP — remember these files"
            disabled={!saveRequested}
            onPress={() => void manager.confirmSaved()}
          />
          <Button
            secondary
            label="Discard temporary ZIP"
            onPress={() => void manager.discardZip()}
          />
        </View>
      )}
      {state.savedCount > 0 && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {state.savedCount} saved file versions recorded.
        </Text>
      )}
      {state.index && (
        <>
          <Text style={styles.title}>{documents.length} discovered files</Text>
          <TextInput
            accessibilityLabel="Search documents"
            placeholder="Search files or folders"
            value={search}
            onChangeText={(text) => {
              setSearch(text);
              setLimit(100);
            }}
            style={styles.input}
          />
          <Text style={styles.body}>Filter by extension</Text>
          <View style={styles.row}>
            {["all", ...extensions].map((ext) => (
              <Button
                key={ext}
                label={ext}
                secondary={extension !== ext}
                onPress={() => {
                  setExtension(ext);
                  setLimit(100);
                }}
              />
            ))}
          </View>
          <Button
            secondary
            label={
              missingOnly
                ? "Show all files"
                : "Show only missing / changed files"
            }
            onPress={() => setMissingOnly((value) => !value)}
          />
          <Button
            secondary
            disabled={busy}
            label={`Select all ${filtered.length} matching files`}
            onPress={() => setSelected(new Set(filtered.map((doc) => doc.id)))}
          />
          <Button
            secondary
            disabled={busy}
            label="Clear selection"
            onPress={() => setSelected(new Set())}
          />
          <Button
            label={`ZIP missing selected (${missing.length})`}
            disabled={busy || !missing.length}
            onPress={() => void manager.download(ids, true, deviceArchive)}
          />
          <Button
            secondary
            label={`ZIP all selected (${ids.length})`}
            disabled={busy || !ids.length}
            onPress={() => void manager.download(ids, false, deviceArchive)}
          />
          <Text style={styles.small}>
            Up to 2 GB per ZIP; split larger collections. Unknown source
            versions stay marked as saved but cannot be checked for updates; use
            ZIP all selected to refresh them. A saved ZIP moved or deleted
            outside the app cannot be detected.
          </Text>
          {filtered.slice(0, limit).map((doc) => (
            <Pressable
              key={doc.id}
              disabled={busy}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: selected.has(doc.id),
                disabled: busy,
              }}
              accessibilityLabel={`${doc.name}, ${doc.context}`}
              onPress={() =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (next.has(doc.id)) next.delete(doc.id);
                  else next.add(doc.id);
                  return next;
                })
              }
              style={styles.card}
            >
              <Text style={styles.title}>
                {selected.has(doc.id) ? "☑ " : "☐ "}
                {doc.name}
              </Text>
              <Text style={styles.small}>
                {doc.context} · {doc.source}
              </Text>
              <Text style={styles.body}>
                {fileExtension(doc.name)} / {fileCategory(doc)} ·{" "}
                {doc.size === null
                  ? "Size unknown"
                  : `${(doc.size / 1024).toFixed(1)} KiB`}
              </Text>
              <Text style={styles.small}>
                {labels[state.states[doc.id] ?? "new"]}
              </Text>
            </Pressable>
          ))}
          {!filtered.length && (
            <Text style={styles.body}>No matching files.</Text>
          )}
          {filtered.length > limit && (
            <Button
              secondary
              label="Show 100 more files"
              onPress={() => setLimit((value) => value + 100)}
            />
          )}
          <Text style={styles.title}>Source coverage</Text>
          {state.index.coverage.map((item) => (
            <Text key={item.source} style={styles.small}>
              {item.source}: {item.status} ({item.count}). {item.message}
            </Text>
          ))}
        </>
      )}
      <Text style={styles.small}>
        History retains only account, document and revision hashes across
        sign-out. Temporary ZIPs are removed when discarded or the account
        disconnects; saved device copies remain yours.
      </Text>
      {!resetRequested ? (
        <Button
          secondary
          disabled={busy}
          label="Forget this account’s download history"
          onPress={() => setResetRequested(true)}
        />
      ) : (
        <View style={styles.card}>
          <Text style={styles.body}>
            Previously saved versions will become eligible again. Device ZIPs
            are not deleted.
          </Text>
          <Button
            secondary
            disabled={busy}
            label="Forget history"
            onPress={() => {
              void manager.forgetHistory();
              setResetRequested(false);
            }}
          />
          <Button
            secondary
            label="Keep history"
            onPress={() => setResetRequested(false)}
          />
        </View>
      )}
    </View>
  );
}
function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  section: { gap: 14 },
  heading: { fontSize: 23, color: "#17233a", fontWeight: "700" },
  title: { fontSize: 15, color: "#25354d", fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 21, color: "#596b83" },
  small: { fontSize: 11, lineHeight: 18, color: "#708198" },
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: "#dce4f0",
    backgroundColor: "#fff",
    borderRadius: 12,
    gap: 10,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  input: {
    borderWidth: 1,
    borderColor: "#dce4f0",
    backgroundColor: "#fff",
    padding: 13,
    fontSize: 16,
    borderRadius: 9,
  },
  button: {
    minHeight: 44,
    padding: 12,
    borderRadius: 9,
    backgroundColor: "#2454df",
    justifyContent: "center",
  },
  buttonText: {
    textAlign: "center",
    fontSize: 12,
    color: "#fff",
    fontWeight: "600",
  },
  secondary: { backgroundColor: "#e8eefb" },
  secondaryText: { color: "#3658a3" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  error: {
    color: "#923a25",
    padding: 12,
    backgroundColor: "#fff0e8",
    borderRadius: 8,
  },
  success: { fontSize: 13, color: "#208362" },
});
