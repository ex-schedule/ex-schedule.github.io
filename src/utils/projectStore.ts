import { doc, runTransaction, serverTimestamp } from '../storage';
import { db } from '../storage';
import { LEAD_MEMBERS, getDaysInMonth } from '../constants';
import type { MonthData, ProjectItem, ScheduleItem } from '../types';
import { cleanFirestorePayload, detectProjectMetadata, isNonEventVenue, isSameVenue, parseTimeRange, projectCoversDate, projectDates, sameProjectName } from './venue';
import { collectClientNames, mergeProjectChanges, mergeSameNameProjects, sameProjectValue } from './projectChanges';

export async function saveProjectChanges(monthKey: string, desired: ProjectItem[], baseline: ProjectItem[]): Promise<ProjectItem[]> {
  const ref = doc(db, 'months', monthKey);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = (snap.exists() ? snap.data() : {}) as Partial<MonthData>;
    let projects = mergeProjectChanges(data.projects || [], baseline, desired);
    const added = desired.filter(item => !baseline.some(p => p.id === item.id));
    for (const item of added) {
      if (isNonEventVenue(item.venue)) throw new Error('商談・内定式・運転・搬入・搬出などは案件として登録できません。');
      const previousId = (data.projects || []).find(p => sameProjectName(p.venue, item.venue))?.id;
      projects = mergeSameNameProjects(projects, item.venue, previousId);
    }
    const clientNames = collectClientNames({ saved: { ...data, projects }, previous: { projects: data.projects || [] } });
    tx.set(ref, cleanFirestorePayload({ projects, clientNames, updatedAt: serverTimestamp() }), { merge: true });
    return projects;
  });
}

export async function saveScheduleClient(
  monthKey: string, member: string, dayIdx: number, client: string,
  expected: ScheduleItem, editorName: string = ''
): Promise<void> {
  const [year, monthNumber] = monthKey.split('-').map(Number);
  const days = getDaysInMonth(year, monthNumber - 1);
  if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12 ||
      !Number.isInteger(dayIdx) || dayIdx < 0 || dayIdx >= days) throw new Error('日付を確認してください。');
  const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`;
  const nextClient = client.trim();
  const newId = globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ref = doc(db, 'months', monthKey);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = (snap.exists() ? snap.data() : {}) as Partial<MonthData>;
    const raw = data.schedule?.[member] || [];
    const schedule = Array.from({ length: days }, (_, i) => raw[i] || { type: 'rest' as const, detail: '' });
    const current = schedule[dayIdx];
    if (current.type !== 'event' || !current.detail?.trim()) throw new Error('イベント名を入力してからクライアントを登録してください。');
    if (current.type !== expected.type || current.detail !== expected.detail ||
        (!sameProjectValue(current.client || '', expected.client || '') && current.client !== nextClient)) {
      throw new Error('予定が他の人に更新されました。最新の内容を確認して再度入力してください。');
    }
    let projects = [...(data.projects || [])];
    const isProject = !isNonEventVenue(current.detail);
    const venue = detectProjectMetadata(current.detail).cleanVenue || current.detail;
    const dateMatches = isProject ? projects.filter(p => isSameVenue(p.venue, current.detail) && projectCoversDate(p, date)) : [];
    if (dateMatches.length > 1 && !dateMatches.every(p => sameProjectName(p.venue, venue))) {
      throw new Error('同じ日・会場の案件が複数あります。案件共有で対象を確認して登録してください。');
    }
    const sameName = isProject ? projects.filter(p => sameProjectName(p.venue, venue)) : [];
    if (sameName.length > 1) projects = mergeSameNameProjects(projects, venue, sameName[0].id);
    const match = projects.find(p => p.id === dateMatches[0]?.id) || projects.find(p => sameProjectName(p.venue, venue));
    const at = new Date().toISOString();
    if (match) {
      const index = projects.findIndex(p => p.id === match.id);
      const staff = Object.entries(data.schedule || {})
        .filter(([, items]) => items?.[dayIdx]?.type === 'event' && isSameVenue(items[dayIdx].detail, current.detail))
        .map(([name]) => name);
      projects[index] = {
        ...match, client: nextClient,
        date: nextClient ? [match.date, date].sort()[0] : match.date,
        dateEnd: nextClient ? [match.dateEnd || match.date, date].sort().at(-1) : match.dateEnd,
        occurrenceDates: nextClient ? [...new Set([...projectDates(match), date])].sort() : match.occurrenceDates,
        headcount: Math.max(match.headcount || 0, staff.length),
        leads: [...new Set([...match.leads, ...staff.filter(name => LEAD_MEMBERS.includes(name))])],
        members: [...new Set([...match.members, ...staff.filter(name => !LEAD_MEMBERS.includes(name))])],
        updatedAt: at,
      };
    } else if (nextClient && isProject) {
      const meta = detectProjectMetadata(current.detail);
      let dayTime = data.dailyTimes?.[dayIdx + 1];
      if (dayTime === undefined) {
        const settings = await tx.get(doc(db, 'settings', 'global'));
        dayTime = settings.exists() ? settings.data().dailyTimes?.[dayIdx + 1] : undefined;
      }
      const time = parseTimeRange(dayTime || current.detail);
      const staff = Object.entries(data.schedule || {})
        .filter(([, items]) => items?.[dayIdx]?.type === 'event' && isSameVenue(items[dayIdx].detail, current.detail))
        .map(([name]) => name);
      projects.push({
        id: newId, date, dateEnd: date, occurrenceDates: [date], timeStart: time.start, timeEnd: time.end,
        client: nextClient, carrier: meta.carrier || '', venue: meta.cleanVenue || current.detail,
        content: meta.content || '', headcount: staff.length || 1, directors: [],
        leads: staff.filter(name => LEAD_MEMBERS.includes(name)),
        members: staff.filter(name => !LEAD_MEMBERS.includes(name)), comment: '', layout: [], updatedAt: at,
      });
    }
    schedule[dayIdx] = { ...current, client: nextClient };
    const clientNames = collectClientNames({ previous: data, next: { projects, schedule: { [member]: schedule } } });
    const history = (data.history || []).slice();
    if ((current.client || '') !== nextClient) history.unshift({
      at, by: editorName.trim(), member, day: dayIdx + 1,
      field: 'client', from: current.client || '', to: nextClient,
    });
    tx.set(ref, cleanFirestorePayload({
      schedule: { [member]: schedule }, projects, clientNames, history: history.slice(0, 300),
      updatedAt: serverTimestamp(),
    }), { merge: true });
  });
}
