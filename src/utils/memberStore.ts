import { db, doc, runTransaction, serverTimestamp } from '../storage';
import type { MonthData, ProjectItem, HistoryEntry } from '../types';
import { cleanFirestorePayload } from './venue';

const RESERVED_NAMES = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
]);

const hasOwn = (obj: unknown, key: string): boolean =>
  Boolean(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key));

export function normalizeMemberIdentityKey(name: string): string {
  return name.normalize('NFKC').replace(/[\s\u3000]+/g, ' ').trim();
}

export function validateMemberName(
  rawName: string,
  existingMembers: string[],
  ignoreName?: string
): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    throw new Error('メンバー名を入力してください。');
  }
  if (trimmed.length > 64) {
    throw new Error('メンバー名は64文字以内で入力してください。');
  }
  if (RESERVED_NAMES.has(trimmed) || RESERVED_NAMES.has(normalizeMemberIdentityKey(trimmed))) {
    throw new Error('使用できないメンバー名です。');
  }
  const targetKey = normalizeMemberIdentityKey(trimmed);
  if (
    existingMembers.some(
      m => m !== ignoreName && (m === trimmed || normalizeMemberIdentityKey(m) === targetKey)
    )
  ) {
    throw new Error(`「${trimmed}」は既に登録されています。`);
  }
  return trimmed;
}

function resolveAuthoritativeMembers(
  settingsData: Record<string, any>,
  fallbackMembers: string[],
  fallbackLeadMembers: string[]
): { baseMembers: string[]; baseLeadMembers: string[] } {
  const baseMembers =
    Array.isArray(settingsData.members) &&
    settingsData.members.length > 0 &&
    settingsData.members.every((x: unknown) => typeof x === 'string')
      ? [...settingsData.members]
      : [...fallbackMembers];
  const baseLeadMembers =
    Array.isArray(settingsData.leadMembers) &&
    settingsData.leadMembers.every((x: unknown) => typeof x === 'string')
      ? [...settingsData.leadMembers]
      : [...fallbackLeadMembers];
  return { baseMembers, baseLeadMembers };
}

export async function addTeamMember(
  rawName: string,
  isLead: boolean,
  currentMembers: string[],
  currentLeadMembers: string[],
  client: any = db
): Promise<{ members: string[]; leadMembers: string[] }> {
  // Fast pre-check before starting transaction
  validateMemberName(rawName, currentMembers);

  let committedMembers: string[] = [];
  let committedLeads: string[] = [];

  const settingsRef = doc(client, 'settings', 'global');
  await runTransaction(client, async tx => {
    const snap = await tx.get(settingsRef);
    const existing = snap.exists() ? snap.data() : {};
    const { baseMembers, baseLeadMembers } = resolveAuthoritativeMembers(
      existing,
      currentMembers,
      currentLeadMembers
    );
    const name = validateMemberName(rawName, baseMembers);
    const nextMembers = [...baseMembers, name];
    const nextLeads = isLead
      ? Array.from(new Set([...baseLeadMembers, name])).filter(m => nextMembers.includes(m))
      : baseLeadMembers.filter(m => nextMembers.includes(m));

    tx.set(
      settingsRef,
      cleanFirestorePayload({
        ...existing,
        members: nextMembers,
        leadMembers: nextLeads,
        updatedAt: serverTimestamp(),
      }),
      { merge: false }
    );
    committedMembers = nextMembers;
    committedLeads = nextLeads;
  });

  return { members: committedMembers, leadMembers: committedLeads };
}

export async function updateTeamMemberRoleOrOrder(
  nextMembers: string[],
  nextLeadMembers: string[],
  client: any = db
): Promise<{ members: string[]; leadMembers: string[] }> {
  if (!Array.isArray(nextMembers) || nextMembers.length === 0) {
    throw new Error('メンバーを0人にすることはできません。');
  }
  let committedMembers: string[] = [];
  let committedLeads: string[] = [];

  const settingsRef = doc(client, 'settings', 'global');
  await runTransaction(client, async tx => {
    const snap = await tx.get(settingsRef);
    const existing = snap.exists() ? snap.data() : {};
    const { baseMembers } = resolveAuthoritativeMembers(existing, nextMembers, nextLeadMembers);
    // Preserve any newly added concurrent members at the tail while applying the requested order
    const ordered = nextMembers.filter(m => baseMembers.includes(m));
    for (const m of baseMembers) {
      if (!ordered.includes(m)) ordered.push(m);
    }
    if (ordered.length === 0) {
      throw new Error('メンバーを0人にすることはできません。');
    }
    const validLeads = Array.from(new Set(nextLeadMembers)).filter(m => ordered.includes(m));

    tx.set(
      settingsRef,
      cleanFirestorePayload({
        ...existing,
        members: ordered,
        leadMembers: validLeads,
        updatedAt: serverTimestamp(),
      }),
      { merge: false }
    );
    committedMembers = ordered;
    committedLeads = validLeads;
  });
  return { members: committedMembers, leadMembers: committedLeads };
}

export async function renameTeamMember(
  oldName: string,
  rawNewName: string,
  isLead: boolean,
  currentMembers: string[],
  currentLeadMembers: string[],
  monthKeys: string[],
  client: any = db
): Promise<{ members: string[]; leadMembers: string[] }> {
  validateMemberName(rawNewName, currentMembers, oldName);

  let committedMembers: string[] = [];
  let committedLeads: string[] = [];

  const settingsRef = doc(client, 'settings', 'global');
  await runTransaction(client, async tx => {
    const settingsSnap = await tx.get(settingsRef);
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
    const { baseMembers, baseLeadMembers } = resolveAuthoritativeMembers(
      settingsData,
      currentMembers,
      currentLeadMembers
    );
    if (!baseMembers.includes(oldName)) {
      throw new Error('対象のメンバーが見つかりません。');
    }
    const newName = validateMemberName(rawNewName, baseMembers, oldName);
    const nextMembers = baseMembers.map(m => (m === oldName ? newName : m));
    const mappedLeads = baseLeadMembers
      .map(m => (m === oldName ? newName : m))
      .filter(m => nextMembers.includes(m));
    const nextLeads = isLead
      ? Array.from(new Set([...mappedLeads, newName]))
      : mappedLeads.filter(m => m !== newName);

    const stations = { ...(settingsData.memberStations || {}) };
    if (oldName !== newName && hasOwn(stations, oldName)) {
      stations[newName] = stations[oldName];
      delete stations[oldName];
    }

    const monthSnaps: { key: string; data: MonthData }[] = [];
    if (oldName !== newName) {
      for (const mKey of monthKeys) {
        if (!/^\d{4}-(?:[1-9]|1[0-2])$/.test(mKey)) continue;
        const mRef = doc(client, 'months', mKey);
        const mSnap = await tx.get(mRef);
        if (mSnap.exists()) {
          monthSnaps.push({ key: mKey, data: mSnap.data() as MonthData });
        }
      }
    }

    tx.set(
      settingsRef,
      cleanFirestorePayload({
        ...settingsData,
        members: nextMembers,
        leadMembers: nextLeads,
        memberStations: stations,
        updatedAt: serverTimestamp(),
      }),
      { merge: false }
    );

    if (oldName !== newName) {
      for (const { key, data } of monthSnaps) {
        const nextDoc: Record<string, any> = { ...data };
        let changed = false;

        for (const mapField of ['schedule', 'memos', 'dones', 'goals', 'nextPlan', 'memberStations'] as const) {
          const mapObj = nextDoc[mapField];
          if (mapObj && typeof mapObj === 'object' && hasOwn(mapObj, oldName)) {
            const copy = { ...mapObj };
            copy[newName] = copy[oldName];
            delete copy[oldName];
            nextDoc[mapField] = copy;
            changed = true;
          }
        }

        if (nextDoc.schedule && typeof nextDoc.schedule === 'object') {
          const updatedSchedule: Record<string, any> = { ...nextDoc.schedule };
          for (const [mKey, slots] of Object.entries(updatedSchedule)) {
            if (Array.isArray(slots) && slots.some((slot: any) => slot && slot.requestedBy === oldName)) {
              updatedSchedule[mKey] = slots.map((slot: any) =>
                slot && slot.requestedBy === oldName ? { ...slot, requestedBy: newName } : slot
              );
              changed = true;
            }
          }
          nextDoc.schedule = updatedSchedule;
        }

        if (Array.isArray(nextDoc.history) && nextDoc.history.some((h: HistoryEntry) => h.member === oldName)) {
          nextDoc.history = nextDoc.history.map((h: HistoryEntry) =>
            h.member === oldName ? { ...h, member: newName } : h
          );
          changed = true;
        }

        if (Array.isArray(nextDoc.projects) && nextDoc.projects.length > 0) {
          const replaceInList = (arr?: string[]) =>
            Array.isArray(arr) ? arr.map(x => (x === oldName ? newName : x)) : [];
          nextDoc.projects = nextDoc.projects.map((p: ProjectItem) => ({
            ...p,
            directors: replaceInList(p.directors),
            leads: replaceInList(p.leads),
            members: replaceInList(p.members),
          }));
          changed = true;
        }

        if (changed) {
          nextDoc.updatedAt = serverTimestamp();
          tx.set(doc(client, 'months', key), cleanFirestorePayload(nextDoc), { merge: false });
        }
      }
    }

    committedMembers = nextMembers;
    committedLeads = nextLeads;
  });

  return { members: committedMembers, leadMembers: committedLeads };
}

export async function deleteTeamMember(
  targetName: string,
  currentMembers: string[],
  currentLeadMembers: string[],
  monthKeys: string[],
  client: any = db
): Promise<{ members: string[]; leadMembers: string[] }> {
  let committedMembers: string[] = [];
  let committedLeads: string[] = [];

  const settingsRef = doc(client, 'settings', 'global');
  await runTransaction(client, async tx => {
    const settingsSnap = await tx.get(settingsRef);
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
    const { baseMembers, baseLeadMembers } = resolveAuthoritativeMembers(
      settingsData,
      currentMembers,
      currentLeadMembers
    );
    if (!baseMembers.includes(targetName)) {
      throw new Error('対象のメンバーが見つかりません。');
    }
    if (baseMembers.length <= 1) {
      throw new Error('メンバーを0人にすることはできません。');
    }

    const nextMembers = baseMembers.filter(m => m !== targetName);
    const nextLeads = baseLeadMembers.filter(m => m !== targetName && nextMembers.includes(m));

    const stations = { ...(settingsData.memberStations || {}) };
    if (hasOwn(stations, targetName)) {
      delete stations[targetName];
    }

    const monthSnaps: { key: string; data: MonthData }[] = [];
    for (const mKey of monthKeys) {
      if (!/^\d{4}-(?:[1-9]|1[0-2])$/.test(mKey)) continue;
      const mRef = doc(client, 'months', mKey);
      const mSnap = await tx.get(mRef);
      if (mSnap.exists()) {
        monthSnaps.push({ key: mKey, data: mSnap.data() as MonthData });
      }
    }

    tx.set(
      settingsRef,
      cleanFirestorePayload({
        ...settingsData,
        members: nextMembers,
        leadMembers: nextLeads,
        memberStations: stations,
        updatedAt: serverTimestamp(),
      }),
      { merge: false }
    );

    for (const { key, data } of monthSnaps) {
      const nextDoc: Record<string, any> = { ...data };
      let changed = false;

      for (const mapField of ['schedule', 'memos', 'dones', 'goals', 'nextPlan', 'memberStations'] as const) {
        const mapObj = nextDoc[mapField];
        if (mapObj && typeof mapObj === 'object' && hasOwn(mapObj, targetName)) {
          const copy = { ...mapObj };
          delete copy[targetName];
          nextDoc[mapField] = copy;
          changed = true;
        }
      }

      if (Array.isArray(nextDoc.projects) && nextDoc.projects.length > 0) {
        const removeFromList = (arr?: string[]) =>
          Array.isArray(arr) ? arr.filter(x => x !== targetName) : [];
        nextDoc.projects = nextDoc.projects.map((p: ProjectItem) => ({
          ...p,
          directors: removeFromList(p.directors),
          leads: removeFromList(p.leads),
          members: removeFromList(p.members),
        }));
        changed = true;
      }

      if (changed) {
        nextDoc.updatedAt = serverTimestamp();
        tx.set(doc(client, 'months', key), cleanFirestorePayload(nextDoc), { merge: false });
      }
    }

    committedMembers = nextMembers;
    committedLeads = nextLeads;
  });

  return { members: committedMembers, leadMembers: committedLeads };
}
