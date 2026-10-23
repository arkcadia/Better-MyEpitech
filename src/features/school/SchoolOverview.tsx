import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SessionManager } from '../../application/sessionManager';
import { StudentDataManager, timetableWindow } from '../../application/studentDataManager';
import type { CalendarEntry, CalendarMoment } from '../../domain/calendar';
import { HttpEpitechStudentDataApi } from '../../providers/epitech/studentData';
import { createGoogleCalendarManager } from '../../providers/google/createManager';

function dateLabel(value: CalendarMoment): string {
  if ('date' in value) return `${value.date} · all day`;
  const zone = value.timeZone ?? 'UTC';
  try {
    return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value.dateTime))} (${zone})`;
  } catch { return value.dateTime; }
}

export function SchoolOverview({ session, login }: { session: SessionManager; login: string }) {
  const [school] = useState(() => new StudentDataManager(new HttpEpitechStudentDataApi((path, signal) => session.readSchool(path, signal))));
  const [google] = useState(createGoogleCalendarManager);
  const schoolState = useSyncExternalStore(school.subscribe, school.getSnapshot, school.getSnapshot);
  const googleState = useSyncExternalStore(google.subscribe, google.getSnapshot, google.getSnapshot);
  const [tab, setTab] = useState<'projects' | 'timetable'>('projects');
  const [filter, setFilter] = useState('ongoing');
  const [offset, setOffset] = useState(0);
  const [registeredOnly, setRegisteredOnly] = useState(false);
  const [projectVisible, setProjectVisible] = useState(30);
  const [eventsVisible, setEventsVisible] = useState(50);
  const range = useMemo(() => timetableWindow(offset), [offset]);
  useEffect(() => {
    school.setAccount(login);
    void google.restore(login);
    return () => { school.suspend(); google.suspend(); };
  }, [school, google, login]);
  useEffect(() => { void school.refresh(range.from, range.to); }, [school, login, range]);

  const data = schoolState.account === login ? schoolState.data : null;
  const linked = !!googleState.account && googleState.status !== 'linking';
  const googleBusy = ['linking', 'exporting'].includes(googleState.status);
  const exportEntry = (entry: CalendarEntry) => { void google.exportEntry(login, entry); };
  const exported = googleState.lastExport;

  return <View style={styles.section}>
    <Text style={styles.heading}>Your school information</Text>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Google Calendar</Text>
      <Text style={styles.body}>{linked ? `Connected as ${googleState.account!.email}. Selected items go to your app-created Epitech calendar.` : 'Optional. Connect your Google account to add selected classes and deadlines to an Epitech calendar.'}</Text>
      {googleState.error ? <Text accessibilityRole="alert" style={styles.error}>{googleState.error}</Text> : null}
      {googleState.status === 'error' && googleState.account ? <Button label="Reconnect Google Calendar" secondary disabled={googleBusy} onPress={() => void google.connect(login)} /> : null}
      {googleBusy ? <ActivityIndicator accessibilityLabel="Working with Google Calendar" /> : null}
      {linked ? <Button label="Disconnect Google Calendar" secondary disabled={googleBusy} onPress={() => void google.disconnect()} /> : <Button label="Connect Google Calendar" disabled={googleBusy} onPress={() => void google.connect(login)} />}
      {exported ? <Text accessibilityLiveRegion="polite" style={styles.success}>{exported.result === 'already_added' ? 'Already in your calendar.' : exported.result === 'updated' ? 'Calendar event updated.' : 'Added to your calendar.'}</Text> : null}
    </View>
    <View accessibilityRole="tablist" style={styles.row}>
      <Button label="Projects & deadlines" secondary={tab !== 'projects'} onPress={() => setTab('projects')} />
      <Button label="Timetable" secondary={tab !== 'timetable'} onPress={() => setTab('timetable')} />
    </View>
    {tab === 'timetable' ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Dates {range.from.slice(0, 10)} – {range.to.slice(0, 10)}</Text>
      <Text style={styles.small}>The range starts and ends at 00:00 UTC; the ending date is excluded. Class times below use the source timezone when known.</Text>
      <View style={styles.row}><Button label="Previous 2 weeks" secondary onPress={() => setOffset(x => x - 1)} /><Button label="Next 2 weeks" secondary onPress={() => setOffset(x => x + 1)} /></View>
      <Button label="Back to today" secondary onPress={() => setOffset(0)} />
      <View style={styles.row}><Button label="All accessible events" secondary={registeredOnly} onPress={() => setRegisteredOnly(false)} /><Button label="My registrations" secondary={!registeredOnly} onPress={() => setRegisteredOnly(true)} /></View>
    </View> : <View style={styles.row}>{['ongoing', 'upcoming', 'finished', 'all'].map(status => <Button key={status} label={status === 'all' ? 'All projects' : status[0]!.toUpperCase() + status.slice(1)} secondary={filter !== status} onPress={() => { setFilter(status); setProjectVisible(30); }} />)}</View>}
    <Button label="Refresh school information" secondary disabled={schoolState.status === 'loading'} onPress={() => void school.refresh(range.from, range.to)} />
    {schoolState.status === 'loading' ? <View style={styles.row}><ActivityIndicator /><Text style={styles.body}>Collecting accessible school information…</Text></View> : null}
    {schoolState.issue ? <Text accessibilityRole="alert" style={styles.error}>{schoolState.issue}</Text> : null}
    {data?.warnings.map((warning, i) => <Text key={i} style={styles.warning}>{warning}</Text>)}
    {data && !data.complete ? <Text style={styles.warning}>Collection is incomplete. The items below are the records that could be read safely.</Text> : null}
    {data ? <Text style={styles.small}>Loaded {data.projects.length} projects and {data.events.length} timetable entries. Some entries may be shared activities you have not registered for. Refresh to check for changes.</Text> : null}
    {tab === 'projects' && data ? <>
      {data.projects.filter(p => filter === 'all' || p.status === filter).slice(0, projectVisible).map(project => <View key={project.id} style={styles.card}>
        <Text style={styles.cardTitle}>{project.title}</Text>
        <Text style={styles.tag}>{project.status.toUpperCase()}{project.registered === true ? ' · REGISTERED' : ''}</Text>
        {project.startAt ? <Text style={styles.body}>Starts: {dateLabel(project.startAt.includes('T') ? { dateTime: project.startAt } : { date: project.startAt })}</Text> : null}
        {project.dueAt ? <Text style={styles.body}>Due: {dateLabel(project.dueAt.includes('T') ? { dateTime: project.dueAt } : { date: project.dueAt })}</Text> : <Text style={styles.small}>No validated due date available.</Text>}
        <Button label="View project on My Epitech" secondary onPress={() => { void Linking.openURL(project.sourceUrl); }} />
        {project.deadlines.map(entry => <Entry key={`${entry.sourceKind}:${entry.sourceId}`} entry={entry} linked={linked} busy={googleBusy} onExport={exportEntry} />)}
      </View>)}
      {data.projects.filter(p => filter === 'all' || p.status === filter).length > projectVisible ? <Button label="Show more projects" secondary onPress={() => setProjectVisible(x => x + 30)} /> : null}
      {data.projects.filter(p => filter === 'all' || p.status === filter).length === 0 ? <Text style={styles.body}>No projects in this group were returned. Check any coverage notice above.</Text> : null}
    </> : null}
    {tab === 'timetable' && data ? <>
      {data.events.filter(entry => !registeredOnly || entry.registered === true).slice(0, eventsVisible).map(entry => <View key={`${entry.sourceKind}:${entry.sourceId}`} style={styles.card}><Text style={styles.tag}>{entry.registered === true ? 'REGISTERED' : 'ACCESSIBLE EVENT'}</Text><Entry entry={entry} linked={linked} busy={googleBusy} onExport={exportEntry} /><Button label="View on My Epitech" secondary onPress={() => { void Linking.openURL(entry.sourceUrl); }} /></View>)}
      {data.events.filter(entry => !registeredOnly || entry.registered === true).length > eventsVisible ? <Button label="Show more events" secondary onPress={() => setEventsVisible(x => x + 50)} /> : null}
      {data.events.filter(entry => !registeredOnly || entry.registered === true).length === 0 ? <Text style={styles.body}>No timetable entries were returned for these dates. Check any coverage notice above or choose another range.</Text> : null}
    </> : null}
  </View>;
}

function Entry({ entry, linked, busy, onExport }: { entry: CalendarEntry; linked: boolean; busy: boolean; onExport(entry: CalendarEntry): void }) {
  return <View style={styles.entry}>
    <Text style={styles.cardTitle}>{entry.title}</Text>
    <Text style={styles.body}>{dateLabel(entry.start)}</Text>
    {'dateTime' in entry.end ? <Text style={styles.small}>Ends: {dateLabel(entry.end)}</Text> : <Text style={styles.small}>Through {new Date(Date.parse(`${entry.end.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)}</Text>}
    {entry.location ? <Text style={styles.body}>Room: {entry.location}</Text> : null}
    {entry.description ? <Text style={styles.small}>{entry.description}</Text> : null}
    {entry.cancelled ? <Text style={styles.error}>Cancelled at source. Existing exports are kept until you change them.</Text> : <Button label="Add / update in Google Calendar" disabled={!linked || busy} onPress={() => onExport(entry)} />}
    {!linked ? <Text style={styles.small}>Connect Google Calendar above to export this item.</Text> : null}
  </View>;
}

function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress(): void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  section: { gap: 16 }, heading: { color: '#17233a', fontSize: 24, fontWeight: '800' },
  card: { backgroundColor: '#fff', borderColor: '#e0e6f0', borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 },
  cardTitle: { color: '#17233a', fontSize: 17, lineHeight: 24, fontWeight: '700' },
  body: { color: '#58667e', fontSize: 14, lineHeight: 22 }, small: { color: '#718098', fontSize: 12, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: '#2454df', borderRadius: 9, justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  secondary: { backgroundColor: '#e9eefb' }, secondaryText: { color: '#3658a3' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.8 },
  error: { color: '#923a25', fontSize: 13, lineHeight: 21 }, warning: { color: '#825819', fontSize: 13, lineHeight: 21 },
  success: { color: '#208362', fontSize: 13 }, tag: { fontSize: 10, color: '#3658a3', fontWeight: '700' },
  entry: { gap: 8, paddingTop: 8 },
});
