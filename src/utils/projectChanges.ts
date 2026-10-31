import type { MonthData, ProjectItem } from '../types';
import { projectDates, sameProjectName } from './venue';

const canonical = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(k => (value as any)[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') + '}';
};
export const sameProjectValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const content = ({ updatedAt, ...rest }: ProjectItem) => rest;

/** Apply only this editor's changes to the latest server copy. */
export function mergeProjectChanges(latest: ProjectItem[], baseline: ProjectItem[], desired: ProjectItem[]): ProjectItem[] {
  const byId = (items: ProjectItem[]) => {
    const map = new Map<string, ProjectItem>();
    for (const item of items) {
      if (!item.id || map.has(item.id)) throw new Error('案件IDが重複しています。最新内容を読み込んでください。');
      map.set(item.id, item);
    }
    return map;
  };
  const base = byId(baseline), next = byId(desired), current = byId(latest);
  const result = new Map(current);
  const conflict = () => new Error('他の人が同じ案件の項目を変更しました。入力内容を控え、最新内容を読み込んで確認してください。');
  for (const [id, previous] of base) {
    const edited = next.get(id), server = current.get(id);
    if (!edited) {
      if (!server) continue;
      if (!sameProjectValue(content(server), content(previous))) throw conflict();
      result.delete(id);
      continue;
    }
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(edited)])]
      .filter(k => k !== 'id' && k !== 'updatedAt');
    const changed = keys.filter(k => !sameProjectValue((previous as any)[k], (edited as any)[k]));
    if (!changed.length) continue;
    if (!server) throw new Error('この案件は他の人が削除しました。入力内容は保持しています。');
    const merged = { ...server };
    for (const key of changed) {
      const oldValue = (previous as any)[key], newValue = (edited as any)[key], serverValue = (server as any)[key];
      if (!sameProjectValue(serverValue, oldValue) && !sameProjectValue(serverValue, newValue)) throw conflict();
      if (newValue === undefined) delete (merged as any)[key];
      else (merged as any)[key] = newValue;
    }
    merged.updatedAt = new Date().toISOString();
    result.set(id, merged);
  }
  for (const [id, item] of next) {
    if (base.has(id)) continue;
    const existing = current.get(id);
    if (existing && !sameProjectValue(content(existing), content(item))) throw conflict();
    if (!existing) result.set(id, { ...item, updatedAt: new Date().toISOString() });
  }
  return [...result.values()];
}

/** Combine records with the same project name without discarding entered details. */
export function mergeSameNameProjects(projects: ProjectItem[], venue: string, preferredId?: string): ProjectItem[] {
  const matches = projects.filter(p => sameProjectName(p.venue, venue));
  if (matches.length < 2) return projects;
  const primary = matches.find(p => p.id === preferredId) || matches[0];
  const unique = (values: string[]) => [...new Set(values)];
  const text = (a: string, b: string) => unique([a, b].filter(Boolean)).join('\n');
  const compatible = (a: string, b: string, field: string) => {
    if (a && b && a !== b) throw new Error(`同名案件の${field}が異なるため、自動統合できません。案件共有で内容を確認してください。`);
    return a || b;
  };
  let merged = { ...primary };
  for (const item of matches) {
    if (item.id === primary.id) continue;
    const firstLayout = merged.layout || [], secondLayout = item.layout || [];
    if (firstLayout.length && secondLayout.length && !sameProjectValue(firstLayout, secondLayout)) {
      throw new Error('同名案件の配置図が異なるため、自動統合できません。案件共有で内容を確認してください。');
    }
    merged = {
      ...merged,
      date: [merged.date, item.date].filter(Boolean).sort()[0] || '',
      dateEnd: [merged.dateEnd || merged.date, item.dateEnd || item.date].filter(Boolean).sort().at(-1) || '',
      occurrenceDates: unique([...projectDates(merged), ...projectDates(item)]).sort(),
      timeStart: [merged.timeStart, item.timeStart].filter(Boolean).sort()[0] || '',
      timeEnd: [merged.timeEnd, item.timeEnd].filter(Boolean).sort().at(-1) || '',
      client: compatible(merged.client, item.client, 'クライアント'),
      carrier: compatible(merged.carrier, item.carrier, 'キャリア'),
      content: text(merged.content, item.content),
      comment: text(merged.comment, item.comment),
      headcount: Math.max(merged.headcount || 0, item.headcount || 0),
      directors: unique([...(merged.directors || []), ...(item.directors || [])]),
      leads: unique([...(merged.leads || []), ...(item.leads || [])]),
      members: unique([...(merged.members || []), ...(item.members || [])]),
      layout: firstLayout.length ? firstLayout : secondLayout,
    };
  }
  const ids = new Set(matches.map(p => p.id));
  return projects.filter(p => !ids.has(p.id) || p.id === primary.id)
    .map(p => p.id === primary.id ? merged : p);
}

export function collectClientNames(allData: Record<string, Partial<MonthData>>): string[] {
  const names = new Set<string>();
  const add = (name: unknown) => { if (typeof name === 'string' && name.trim()) names.add(name.trim()); };
  for (const month of Object.values(allData)) {
    (month.clientNames || []).forEach(add);
    (month.projects || []).forEach(p => add(p.client));
    Object.values(month.schedule || {}).forEach(schedule => Object.values(schedule || {}).forEach(item => add(item?.client)));
  }
  return [...names].sort((a,b) => a.localeCompare(b, 'ja'));
}
