// Modified for portable distribution: generic team configuration; original source notices retained.
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ChevronRight, Info, Save, ChevronLeft, ChevronRight as ChevronRightIcon, AlertCircle, X, BarChart3, StickyNote, ArrowLeftToLine, CalendarDays, ClipboardList, History, Search, Eye, LayoutGrid, RefreshCw, Users } from 'lucide-react';
import { TRAINING_LABELS, TRAINING_LOCATIONS, MEMBERS, LEAD_MEMBERS, StatusType, TYPE_LABEL, TYPE_CLASS, GoalRow, INITIAL_SCHEDULE_DATA, getDaysInMonth, getStartOffset } from './constants';
import { db } from './storage';
import { doc, collection, onSnapshot, setDoc, updateDoc, runTransaction, FieldPath, serverTimestamp, getDocFromServer } from './storage';
import type { ScheduleItem, MonthData, StorageErrorInfo, PendingRequestItem, HistoryEntry } from './types';
import { cleanFirestorePayload, getDow, getType, clientColor, clientShortName, eventClientFor, buildProjectCandidates, normalizeVenue } from './utils/venue';
import { getHoliday } from './utils/holidays';
import { LocalInput, LocalTextarea, Legend, ToolbarButton } from './components/common';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MemberTabs } from './components/MemberTabs';
import { MemberManagementModal } from './components/MemberManagementModal';
import { addTeamMember, renameTeamMember, deleteTeamMember, updateTeamMemberRoleOrOrder } from './utils/memberStore';
import { DailyView } from './components/DailyView';
import { extractAllPendingRequests, isPendingRequestItem } from './utils/requests';
import { RequestsView } from './components/RequestsView';
import { HistoryView } from './components/HistoryView';
import { ProjectsView } from './components/ProjectsView';
import { collectClientNames } from './utils/projectChanges';
import { saveProjectChanges, saveScheduleClient } from './utils/projectStore';
import { saveScheduleField, saveScheduleMapField } from './utils/scheduleStore';
import { readScheduleMonth } from './utils/navigation';
import { SummaryView } from './components/SummaryView';
export { normalizeVenueKey, isSameVenue, detectProjectMetadata, splitVenuesFromText, formatProjectDateRange, projectTitle, buildProjectCandidates } from './utils/venue';

// --- Types ---
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [initialProjectId] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('project');
  });
  const [activeTab, setActiveTab] = useState<'schedule' | 'daily' | 'overall' | 'summary' | 'projects' | 'requests' | 'history' | 'memo'>(
    () => (typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('tab') === 'projects' || new URLSearchParams(window.location.search).get('project')) ? 'projects' : 'schedule')
  );
  const [overallQuery, setOverallQuery] = useState('');
  const [isReadOnly] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('readonly') === '1';
  });
  const canEdit = !isReadOnly;

  const [globalMembers, setGlobalMembers] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_members');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(x => typeof x === 'string')) {
            return parsed;
          }
        }
      } catch (e) {}
    }
    return MEMBERS;
  });

  const [globalLeadMembers, setGlobalLeadMembers] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_lead_members');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
            return parsed;
          }
        }
      } catch (e) {}
    }
    return LEAD_MEMBERS;
  });

  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [currentSchedMember, setCurrentSchedMember] = useState(() => globalMembers[0] || MEMBERS[0]);

  useEffect(() => {
    if (globalMembers.length > 0 && !globalMembers.includes(currentSchedMember)) {
      setCurrentSchedMember(globalMembers[0]);
    }
  }, [globalMembers, currentSchedMember]);
  
  const [initialMonth] = useState(() => readScheduleMonth(''));
  const [currentYear, setCurrentYear] = useState(initialMonth.year);
  const [currentMonth, setCurrentMonth] = useState(initialMonth.month);

  // Only explicit month links retain a month in the URL. Normal launches stay current.
  useEffect(() => {
    document.title = `共有スケジュール スケジュール管理 ${currentYear}.${String(currentMonth + 1).padStart(2, '0')}`;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('year') && !url.searchParams.has('month')) return;
    url.searchParams.set('year', currentYear.toString());
    url.searchParams.set('month', (currentMonth + 1).toString());
    window.history.replaceState({}, '', url.toString());
  }, [currentYear, currentMonth]);

  // Handle URL changes (optional, but good for back button)
  useEffect(() => {
    const handlePopState = () => {
      const { year, month } = readScheduleMonth(window.location.search);
      setCurrentYear(year);
      setCurrentMonth(month);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Follow real calendar rollover, while allowing manual browsing within a month.
  useEffect(() => {
    let observedYear = initialMonth.year;
    let observedMonth = initialMonth.month;
    let timer: ReturnType<typeof setTimeout>;
    const checkMonth = () => {
      clearTimeout(timer);
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      if (year !== observedYear || month !== observedMonth) {
        observedYear = year;
        observedMonth = month;
        setCurrentYear(year);
        setCurrentMonth(month);
      }
      // Cap the delay to avoid the browser's maximum timer delay on long months.
      const nextMonth = new Date(year, month + 1, 1);
      timer = setTimeout(checkMonth, Math.min(nextMonth.getTime() - now.getTime(), 86400000));
    };
    checkMonth();
    window.addEventListener('focus', checkMonth);
    window.addEventListener('pageshow', checkMonth);
    document.addEventListener('visibilitychange', checkMonth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', checkMonth);
      window.removeEventListener('pageshow', checkMonth);
      document.removeEventListener('visibilitychange', checkMonth);
    };
  }, [initialMonth]);

  // Data States with Fast-Boot Local Storage Cache
  const [allData, setAllData] = useState<Record<string, MonthData>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_months_data');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (e) {
        console.warn('Failed to parse cached data:', e);
      }
    }
    return {};
  });

  const [globalStations, setGlobalStations] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_stations');
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }
    return {};
  });

  const [globalLocations, setGlobalLocations] = useState<Record<number, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_locations');
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }
    return {};
  });

  const [globalTimes, setGlobalTimes] = useState<Record<number, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_times');
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }
    return {};
  });

  // If local cache already exists, do not block the UI with a full-screen spinner (0-second fast launch!)
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('ex_portable_cached_months_data');
        if (cached && Object.keys(JSON.parse(cached) || {}).length > 0) {
          return false;
        }
      } catch (e) {}
    }
    return true;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaveOk, setShowSaveOk] = useState<Record<string, boolean>>({});

  const handleStorageError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: StorageErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      operationType,
      path
    }
    console.error('Storage Error detailed: ', JSON.stringify(errInfo));
    
    // Firestore attaches a machine-readable code (e.g. "unavailable"); surface it
    // so a failure is identifiable instead of a generic "通信エラー".
    const code = typeof (error as any)?.code === 'string' ? (error as any).code.replace(/^firestore\//, '') : '';
    const haystack = `${code} ${errInfo.error}`.toLowerCase();
    const matches = (...needles: string[]) => needles.some(needle => haystack.includes(needle));

    let userMessage = "通信エラーが発生しました。";
    if (matches("permission-denied", "insufficient permissions", "unauthenticated")) {
      userMessage = "編集権限がありません。管理者にお問い合わせください。";
    } else if (matches("offline", "unavailable")) {
      userMessage = "サーバーに接続できません。通信環境を確認してください。";
    } else if (matches("quota exceeded", "resource-exhausted")) {
      userMessage = "保存容量の上限を超えました。管理担当に連絡してください。";
    } else if (matches("deadline-exceeded")) {
      userMessage = "サーバーの応答がありませんでした。もう一度お試しください。";
    } else if (matches("invalid-argument", "failed-precondition")) {
      userMessage = "保存データの形式が不正なため保存できませんでした。";
    } else if (matches("not-found")) {
      userMessage = "対象のデータが見つかりませんでした。";
    } else if (matches("aborted", "already-exists")) {
      userMessage = "他の編集と競合しました。画面を更新して再度お試しください。";
    }
    if (code) {
      userMessage += `（${code}）`;
    }
    
    if (operationType === OperationType.GET) {
      setError(userMessage);
    } else {
      setSaveError(userMessage);
      // Auto-clear save error
      setTimeout(() => setSaveError(null), 8000);
    }
    
    setIsLoading(false);
    setIsSaving(false);
  };

  const monthKey = `${currentYear}-${currentMonth + 1}`;

  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();
  }, []);

  // Current Month Data
  const currentMonthData = useMemo(() => {
    const rawData = allData[monthKey] || {} as MonthData;
    
    // Migration: Handle literal dotted keys if they were created by a previous bug
    // e.g. "schedule.Member Name" instead of schedule: { "Member Name": ... }
    const data = { ...rawData };
    if (!data.schedule) data.schedule = {};
    
    Object.keys(data).forEach(key => {
      if (key.includes('.') && (key.startsWith('schedule.') || key.startsWith('memos.') || key.startsWith('dones.') || key.startsWith('goals.'))) {
        const [parent, child] = key.split('.');
        const parentKey = parent as keyof MonthData;
        if (!data[parentKey]) (data as any)[parentKey] = {};
        if (!(data[parentKey] as any)[child]) {
          (data[parentKey] as any)[child] = (data as any)[key];
        }
      }
    });

    const isApril2026 = currentYear === 2026 && currentMonth === 3;
    const isAfterApril2026 = currentYear > 2026 || (currentYear === 2026 && currentMonth > 3);

    const migratedSched: Record<string, { type: StatusType, detail: string }[]> = {};
    

    // Migrate schedule
    for (const member of globalMembers) {
      let s = data.schedule?.[member];
      

      const daysInMonth = getDaysInMonth(currentYear, currentMonth);
      
      if (Array.isArray(s) && s.length > 0) {
        migratedSched[member] = s.map((item: any) => {
          if (typeof item === 'object' && item !== null) {
            if ('type' in item) return item as { type: StatusType, detail: string };
            const detail = item.detail || item.status || '';
            return { type: getType(detail), detail: String(detail) };
          }
          return { type: getType(item), detail: String(item || '') };
        });
        
        // Ensure correct length
        if (migratedSched[member].length < daysInMonth) {
          const extra = Array(daysInMonth - migratedSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
          migratedSched[member] = [...migratedSched[member], ...extra];
        } else if (migratedSched[member].length > daysInMonth) {
          migratedSched[member] = migratedSched[member].slice(0, daysInMonth);
        }
      } else {
        // Fallback to initial data for April 2026 if missing or empty
        if (isApril2026 && INITIAL_SCHEDULE_DATA[member]) {
          const initial = INITIAL_SCHEDULE_DATA[member];
          migratedSched[member] = initial.map(s => ({ type: getType(s), detail: s }));
          
          // Ensure correct length
          if (migratedSched[member].length < daysInMonth) {
            const extra = Array(daysInMonth - migratedSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
            migratedSched[member] = [...migratedSched[member], ...extra];
          } else if (migratedSched[member].length > daysInMonth) {
            migratedSched[member] = migratedSched[member].slice(0, daysInMonth);
          }
        } else {
          migratedSched[member] = Array(daysInMonth).fill(null).map(() => ({ type: 'rest', detail: '' }));
        }
      }
    }

    // Migrate other fields
    const migratedMemos = { ...(data.memos || {}) };
    const migratedDones = { ...(data.dones || {}) };
    const migratedGoals = { ...(data.goals || {}) };
    const migratedNextPlan = { ...(data.nextPlan || {}) };
    const migratedStations = { ...(data.memberStations || {}) };


    return {
      ...data,
      schedule: migratedSched,
      memos: migratedMemos,
      dones: migratedDones,
      goals: migratedGoals,
      nextPlan: migratedNextPlan,
      teamGoal: data.teamGoal || '',
      overallMemo: data.overallMemo || '',
      trainingLabels: data.trainingLabels || (isAfterApril2026 ? {} : TRAINING_LABELS),
      trainingLocations: data.trainingLocations || (isAfterApril2026 ? {} : TRAINING_LOCATIONS),
      memberStations: migratedStations,
      dailyLocations: { ...globalLocations, ...(data.dailyLocations || {}) },
      dailyTimes: { ...globalTimes, ...(data.dailyTimes || {}) },
    } as MonthData;
  }, [allData, monthKey, currentMonth, currentYear, globalLocations, globalTimes, globalMembers]);

  // Load data from Firestore (listen to collection to keep all months synchronized in real time)
  useEffect(() => {
    // Failsafe timer: even on slow networks, never keep the user waiting on a blank spinner for more than 2 seconds
    const failsafeTimer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    const unsubscribe = onSnapshot(collection(db, 'months'), (snapshot) => {
      clearTimeout(failsafeTimer);
      const monthsObj: Record<string, MonthData> = {};
      snapshot.forEach(docSnap => {
        if (docSnap.id && !docSnap.id.includes('NaN')) {
          monthsObj[docSnap.id] = docSnap.data() as MonthData;
        }
      });
      setAllData(prev => {
        const next = { ...prev, ...monthsObj };
        try {
          localStorage.setItem('ex_portable_cached_months_data', JSON.stringify(next));
        } catch (e) {}
        return next;
      });
      setIsLoading(false);
      setError(null);
    }, (err) => {
      clearTimeout(failsafeTimer);
      console.error('Firestore Error:', err);
      // If we already have cached data, don't break the user's view with an error
      if (Object.keys(allData).length === 0) {
        // handleStorageError sets the user-facing message; setting the raw
        // Firebase text first would only ever be overwritten in the same batch.
        handleStorageError(err, OperationType.GET, 'months');
      }
      setIsLoading(false);
    });

    return () => {
      clearTimeout(failsafeTimer);
      unsubscribe();
    };
  }, []);

  // Load global settings (stations & members)
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (Array.isArray(data.members) && data.members.length > 0 && data.members.every((x: unknown) => typeof x === 'string')) {
          setGlobalMembers(data.members);
          try { localStorage.setItem('ex_portable_cached_members', JSON.stringify(data.members)); } catch (e) {}
        }
        if (Array.isArray(data.leadMembers) && data.leadMembers.every((x: unknown) => typeof x === 'string')) {
          setGlobalLeadMembers(data.leadMembers);
          try { localStorage.setItem('ex_portable_cached_lead_members', JSON.stringify(data.leadMembers)); } catch (e) {}
        }
        if (data.memberStations) {
          setGlobalStations(data.memberStations);
          try { localStorage.setItem('ex_portable_cached_stations', JSON.stringify(data.memberStations)); } catch (e) {}
        }
        if (data.dailyLocations) {
          setGlobalLocations(data.dailyLocations);
          try { localStorage.setItem('ex_portable_cached_locations', JSON.stringify(data.dailyLocations)); } catch (e) {}
        }
        if (data.dailyTimes) {
          setGlobalTimes(data.dailyTimes);
          try { localStorage.setItem('ex_portable_cached_times', JSON.stringify(data.dailyTimes)); } catch (e) {}
        }
      } else {
        // Fallback: If global settings don't exist yet, try to pull from April 2026
        const loadAprilFallback = async () => {
          try {
            const aprilDoc = await getDocFromServer(doc(db, 'months', '2026-4'));
            if (aprilDoc.exists()) {
              const data = aprilDoc.data() as MonthData;
              if (data.memberStations) {
                setGlobalStations(data.memberStations);
                try { localStorage.setItem('ex_portable_cached_stations', JSON.stringify(data.memberStations)); } catch (e) {}
              }
            }
          } catch (e) {
            console.error('April fallback failed:', e);
          }
        };
        loadAprilFallback();
      }
    }, (err) => {
      console.error('Global Settings Error:', err);
    });

    return () => unsubscribe();
  }, []);

  const saveData = async (rawUpdates: Record<string, any>) => {
    if (isReadOnly) return;
    if (!monthKey || monthKey.includes('NaN')) {
      console.error('Invalid monthKey for saving:', monthKey);
      return;
    }
    const updates = cleanFirestorePayload(rawUpdates);
    if (!updates || Object.keys(updates).length === 0) {
      return;
    }
    setIsSaving(true);
    const path = `months/${monthKey}`;
    try {
      const docRef = doc(db, 'months', monthKey);
      
      // Expand dotted keys for potential setDoc usage or debugging
      const expandKeys = (obj: Record<string, any>) => {
        const res: any = {};
        Object.keys(obj).forEach(key => {
          if (key.includes('.')) {
            const parts = key.split('.');
            let current = res;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!current[parts[i]]) current[parts[i]] = {};
              current = current[parts[i]];
            }
            if (obj[key] !== undefined) {
              current[parts[parts.length - 1]] = cleanFirestorePayload(obj[key]);
            }
          } else if (obj[key] !== undefined) {
            res[key] = cleanFirestorePayload(obj[key]);
          }
        });
        return res;
      };

      const hasDots = Object.keys(updates).some(k => k.includes('.'));
      
      if (hasDots) {
        try {
          // updateDoc is preferred for nested updates
          await updateDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
          });
        } catch (e: any) {
          // If updateDoc fails for ANY reason (doc not found, or nested path doesn't exist, etc.)
          // we fallback to setDoc with merge and expanded keys, which ensures the structure.
          try {
            const expanded = expandKeys({
              ...updates,
              updatedAt: serverTimestamp()
            });
            await setDoc(docRef, expanded, { merge: true });
          } catch (e2) {
            throw e2;
          }
        }
      } else {
        await setDoc(docRef, {
          ...updates,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      console.log('Saved successfully:', updates);
    } catch (e: any) {
      console.error('Save failed:', e);
      handleStorageError(e, OperationType.WRITE, path);
    } finally {
      setIsSaving(false);
    }
  };

  const triggerSaveOk = (id: string) => {
    setShowSaveOk(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setShowSaveOk(prev => ({ ...prev, [id]: false }));
    }, 2000);
  };

  // --- Handlers ---
  const updateCurrentMonthData = (updates: Partial<MonthData>) => {
    if (isReadOnly) return;
    setAllData(prev => ({
      ...prev,
      [monthKey]: { ...(prev[monthKey] || {} as MonthData), ...updates }
    }));
    saveData(updates);
  };

  const typeSavesInFlight = useRef(new Set<string>());
  const [savingScheduleTypes, setSavingScheduleTypes] = useState(new Set<string>());
  const handleScheduleTypeChange = async (member: string, dayIdx: number, type: StatusType) => {
    if (isReadOnly) return;
    const key = `${monthKey}:${member}:${dayIdx}`;
    if (typeSavesInFlight.current.has(key)) return;
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const fallback = currentMonthData.schedule[member] || Array(daysInMonth).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
    const expected = fallback[dayIdx] || { type: 'rest' as StatusType, detail: '' };
    if ((expected.type || 'rest') === type) return;
    typeSavesInFlight.current.add(key);
    setSavingScheduleTypes(new Set(typeSavesInFlight.current));
    try {
      await saveScheduleField(monthKey, member, dayIdx, 'type', type, expected, fallback);
      triggerSaveOk('type-saved');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '予定を保存できませんでした。再度お試しください。');
      setTimeout(() => setSaveError(null), 8000);
    } finally {
      typeSavesInFlight.current.delete(key);
      setSavingScheduleTypes(new Set(typeSavesInFlight.current));
    }
  };

  const handleScheduleDetailChange = async (member: string, dayIdx: number, detail: string): Promise<boolean> => {
    if (isReadOnly) return false;
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const fallback = currentMonthData.schedule[member] || Array(daysInMonth).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
    const expected = fallback[dayIdx] || { type: 'rest' as StatusType, detail: '' };
    if ((expected.detail || '') === detail) return true;
    try {
      await saveScheduleField(monthKey, member, dayIdx, 'detail', detail, expected, fallback);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '詳細を保存できませんでした。再度お試しください。');
      setTimeout(() => setSaveError(null), 8000);
      return false;
    }
  };

  const clientSuggestions = useMemo(() => collectClientNames(allData), [allData]);
  const clientSavesInFlight = useRef(new Set<string>());
  const handleScheduleClientChange = async (member: string, dayIdx: number, client: string): Promise<boolean> => {
    if (isReadOnly) return false;
    const expected = currentMonthData.schedule[member]?.[dayIdx];
    if (!expected || expected.client === client.trim()) return true;
    const nextClient = client.trim();
    if (!nextClient && expected.client?.trim()) {
      if (!window.confirm('クライアント名を空にします。同じ日・会場の案件共有に登録されているクライアント名も空になります。よろしいですか？')) {
        return false;
      }
    }
    const key = `${monthKey}:${member}:${dayIdx}`;
    if (clientSavesInFlight.current.has(key)) {
      setSaveError('この予定を保存中です。完了後にもう一度入力してください。');
      return false;
    }
    clientSavesInFlight.current.add(key);
    try {
      await saveScheduleClient(monthKey, member, dayIdx, client, expected);
      triggerSaveOk('client-saved');
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'クライアントを保存できませんでした。再度入力してください。');
      return false;
    } finally {
      clientSavesInFlight.current.delete(key);
    }
  };

  const handleRestoreInitial = () => {
    if (currentYear !== 2026 || currentMonth !== 3) return;
    if (!window.confirm("4月のスケジュールを初期データに復元しますか？（現在の入力内容は上書きされます）")) return;
    
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const newSched: Record<string, { type: StatusType, detail: string }[]> = {};
    for (const member of globalMembers) {
      const initial = INITIAL_SCHEDULE_DATA[member] || [];
      newSched[member] = initial.map(s => ({ type: getType(s), detail: s }));
      
      // Ensure correct length
      if (newSched[member].length < daysInMonth) {
        const extra = Array(daysInMonth - newSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
        newSched[member] = [...newSched[member], ...extra];
      } else if (newSched[member].length > daysInMonth) {
        newSched[member] = newSched[member].slice(0, daysInMonth);
      }
    }
    updateCurrentMonthData({ 
      schedule: newSched,
      trainingLabels: TRAINING_LABELS,
      trainingLocations: TRAINING_LOCATIONS
    });
  };




  type PendingProcessType = 'request' | 'normal' | 'rest';

  const MAX_HISTORY = 300;

  // 同一申請の二重処理(連打・二重コミット)を抑止するための処理中IDセット
  const processingRequestIdsRef = useRef<Set<string>>(new Set());

  function pendingItemDedupeKey(req: PendingRequestItem): string {
    return req.requestId
      ? `id:${req.requestId}`
      : `at:${req.monthKey}:${req.member}:${req.dayIdx}:${req.requestedAt}`;
  }

  // schedule.<member> は配列想定だが、Firestore経由で numeric-key object 化されている場合があるため正規化する
  function normalizeMemberSchedule(raw: unknown, targetDays: number): ScheduleItem[] {
    const items = (raw && typeof raw === 'object' ? raw : {}) as Record<number, ScheduleItem>;
    return Array.from({ length: targetDays }, (_, i) => items[i] || { type: 'rest', detail: '' });
  }

  async function processPendingItem(
    req: PendingRequestItem,
    nextType: PendingProcessType,
    saveOkTag: string
  ) {
    if (isReadOnly) return;

    const dedupeKey = pendingItemDedupeKey(req);
    if (processingRequestIdsRef.current.has(dedupeKey)) return;
    processingRequestIdsRef.current.add(dedupeKey);

    try {
      if (!Number.isInteger(req.month) || req.month < 0 || req.month > 11 || !Number.isInteger(req.year) || req.monthKey !== `${req.year}-${req.month + 1}`) {
        throw new Error('invalid-month');
      }
      const targetDays = getDaysInMonth(req.year, req.month);
      if (!targetDays || !Number.isInteger(req.dayIdx) || req.dayIdx < 0 || req.dayIdx >= targetDays) {
        throw new Error('invalid-day-index');
      }

      const docRef = doc(db, 'months', req.monthKey);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) {
          throw new Error('month-not-found');
        }

        const data = snap.data() as { schedule?: Record<string, unknown>; history?: HistoryEntry[] };
        const memberSched = normalizeMemberSchedule(data.schedule?.[req.member], targetDays);
        const currentItem = memberSched[req.dayIdx];

        if (!isPendingRequestItem(currentItem)) {
          throw new Error('not-pending');
        }
        if (req.requestId) {
          if ((currentItem.requestId || `${req.monthKey}-${req.member}-${req.dayIdx}-${currentItem.requestedAt || ''}`) !== req.requestId) {
            throw new Error('request-id-mismatch');
          }
        } else if ((currentItem.requestedAt || '') !== (req.requestedAt || '')) {
          throw new Error('requested-at-mismatch');
        }

        const prevType = currentItem.type;
        memberSched[req.dayIdx] = { ...currentItem, type: nextType };

        const history = Array.isArray(data.history) ? [...data.history] : [];
        const entry: HistoryEntry = {
          at: new Date().toISOString(),
          by: '',
          member: req.member,
          day: req.dayIdx + 1,
          field: 'type',
          from: prevType || 'pending',
          to: nextType,
        };
        const nextHistory = [entry, ...history].slice(0, MAX_HISTORY);

        // 他メンバーの配列は再送せず、対象メンバーのschedule配列のみをドット記法で部分更新する
        tx.update(docRef,
          new FieldPath('schedule', req.member), cleanFirestorePayload(memberSched),
          'history', nextHistory,
          'updatedAt', serverTimestamp()
        );
      });

      triggerSaveOk(saveOkTag);
    } catch (e) {
      console.error('Failed to process pending item:', e);
      setSaveError(`${req.month + 1}月${req.dayIdx + 1}日（${req.member}）の処理を保存できませんでした。通信状態と最新の申請状況を確認して再度お試しください。`);
    } finally {
      processingRequestIdsRef.current.delete(dedupeKey);
    }
  }

  const handleApprovePendingItem = async (req: PendingRequestItem) => {
    await processPendingItem(req, 'request', 'request-approved');
  };

  const handleSetNormalPendingItem = async (req: PendingRequestItem) => {
    await processPendingItem(req, 'normal', 'request-approved');
  };

  const handleRejectPendingItem = async (req: PendingRequestItem) => {
    await processPendingItem(req, 'rest', 'request-rejected');
  };

  const handleApproveRequest = (member: string, dayIdx: number) => {
    handleScheduleTypeChange(member, dayIdx, 'request');
  };

  const handleSetNormalRequest = (member: string, dayIdx: number) => {
    handleScheduleTypeChange(member, dayIdx, 'normal');
  };

  const handleRejectRequest = (member: string, dayIdx: number) => {
    handleScheduleTypeChange(member, dayIdx, 'rest');
  };

  const handleClearHistory = () => {
    if (isReadOnly) return;
    if (!window.confirm('変更履歴を全て消去しますか？')) return;
    setAllData(prev => ({
      ...prev,
      [monthKey]: { ...(prev[monthKey] || {} as MonthData), history: [] }
    }));
    saveData({ history: [] });
  };

  const projectCandidates = useMemo(
    () =>
      buildProjectCandidates(
        globalMembers,
        currentMonthData.schedule,
        currentYear,
        currentMonth,
        getDaysInMonth(currentYear, currentMonth),
        currentMonthData.dailyTimes || {}
      ),
    [globalMembers, currentMonthData.schedule, currentMonthData.dailyTimes, currentYear, currentMonth]
  );

  const overallScrollRef = useRef<HTMLDivElement>(null);
  const [overallScrollPercent, setOverallScrollPercent] = useState(0);

  useEffect(() => setOverallScrollPercent(0), [monthKey, activeTab]);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;
  const todayDate = today.getDate();

  const scrollOverall = (direction: -1 | 1) => {
    const el = overallScrollRef.current;
    if (!el) return;
    const stickyWidth = el.querySelector<HTMLElement>('[data-sticky-col]')?.offsetWidth || 0;
    const cells = el.querySelectorAll<HTMLElement>('th[data-day]');
    if (!cells.length) return;
    const positions: number[] = [];
    cells.forEach(cell => positions.push(Math.max(0, cell.offsetLeft - stickyWidth - 4)));
    let currentIndex = 0;
    for (let i = 1; i < positions.length; i++) {
      if (Math.abs(positions[i] - el.scrollLeft) < Math.abs(positions[currentIndex] - el.scrollLeft)) currentIndex = i;
    }
    const nextIndex = Math.max(0, Math.min(cells.length - 1, currentIndex + direction));
    el.scrollTo({ left: positions[nextIndex], behavior: 'auto' });
  };

  const scrollOverallToPercent = (percent: number) => {
    const el = overallScrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollTo({ left: maxScroll * percent / 100, behavior: 'auto' });
    setOverallScrollPercent(percent);
  };

  const scrollOverallToDay = (day: number) => {
    const el = overallScrollRef.current;
    if (!el) return;
    const cell = el.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (!cell) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    const stickyWidth = el.querySelector<HTMLElement>('[data-sticky-col]')?.offsetWidth || 0;
    el.scrollTo({ left: Math.max(0, cell.offsetLeft - stickyWidth - 4), behavior: 'smooth' });
  };




  const handleIndividualGoalChange = (member: string, index: number, field: keyof GoalRow, val: any) => {
    const newGoals = { ...currentMonthData.goals };
    const memberGoals = [...(newGoals[member] || [])];
    memberGoals[index] = { ...memberGoals[index], [field]: val };
    newGoals[member] = memberGoals;
    updateCurrentMonthData({ goals: newGoals });
  };

  const addGoalRow = (member: string) => {
    const newGoals = { ...currentMonthData.goals };
    const memberGoals = [...(newGoals[member] || [])];
    memberGoals.push({ content: '', person: '', deadline: '', stars: 0, note: '' });
    newGoals[member] = memberGoals;
    updateCurrentMonthData({ goals: newGoals });
  };

  const deleteGoalRow = (member: string, index: number) => {
    const newGoals = { ...currentMonthData.goals };
    const memberGoals = [...(newGoals[member] || [])];
    memberGoals.splice(index, 1);
    newGoals[member] = memberGoals;
    updateCurrentMonthData({ goals: newGoals });
  };

  const handleGoalSave = (member: string) => {
    // Already auto-saving, but can show feedback
    triggerSaveOk('goal');
  };

  const handleNextPlanChange = (member: string, val: string) => {
    const newNextPlan = { ...currentMonthData.nextPlan, [member]: val };
    updateCurrentMonthData({ nextPlan: newNextPlan });
  };

  const handleMemberStationChange = async (member: string, val: string): Promise<boolean> => {
    if (isReadOnly) return false;
    const current = globalStations[member] ?? currentMonthData.memberStations?.[member] ?? '';
    const value = val || '';
    if (current === value) return true;
    try {
      await saveScheduleMapField('settings', 'global', 'memberStations', member, value, current, current);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '駅情報を保存できませんでした。再度お試しください。');
      setTimeout(() => setSaveError(null), 8000);
      return false;
    }
  };

  const handleGlobalLocationChange = async (day: number, val: string): Promise<boolean> => {
    if (isReadOnly) return false;
    const current = currentMonthData.dailyLocations?.[day] || '';
    const value = val || '';
    if (current === value) return true;
    try {
      await saveScheduleMapField('months', monthKey, 'dailyLocations', String(day), value, current, current);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '場所を保存できませんでした。再度お試しください。');
      setTimeout(() => setSaveError(null), 8000);
      return false;
    }
  };

  const handleGlobalTimeChange = async (day: number, val: string): Promise<boolean> => {
    if (isReadOnly) return false;
    const current = currentMonthData.dailyTimes?.[day] || '';
    const value = val || '';
    if (current === value) return true;
    try {
      await saveScheduleMapField('months', monthKey, 'dailyTimes', String(day), value, current, current);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '時間を保存できませんでした。再度お試しください。');
      setTimeout(() => setSaveError(null), 8000);
      return false;
    }
  };

  const moveMonth = (delta: number) => {
    const date = new Date(currentYear, currentMonth + delta, 1);
    setCurrentYear(date.getFullYear());
    setCurrentMonth(date.getMonth());
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startOffset = getStartOffset(currentYear, currentMonth);
  
  const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;

  const allPendingRequests = useMemo(() => {
    return extractAllPendingRequests(allData, globalMembers);
  }, [allData, globalMembers]);
  
  // 現在選択中の月（当月）の未処理申請
  const currentMonthPendingRequests = useMemo(() => {
    return allPendingRequests.filter(r => r.year === currentYear && r.month === currentMonth);
  }, [allPendingRequests, currentYear, currentMonth]);

  // メンバーごとの未処理申請数バッジ（翌月分も含む）
  const memberRequestBadges = useMemo(() => {
    const map: Record<string, number> = {};
    allPendingRequests.forEach(r => {
      map[r.member] = (map[r.member] || 0) + 1;
    });
    return map;
  }, [allPendingRequests]);

  // 選択中メンバーの翌月（9月等）の希望休・申請中リスト
  const selectedMemberNextMonthLeaves = useMemo(() => {
    const nextMonthKey = `${nextYear}-${nextMonth + 1}`;
    const nextData = allData[nextMonthKey];
    if (!nextData?.schedule?.[currentSchedMember]) return [];
    const rawSched = nextData.schedule[currentSchedMember];
    const days = getDaysInMonth(nextYear, nextMonth);
    const items: ({ type?: StatusType; detail?: string } | undefined)[] = Array.isArray(rawSched)
      ? rawSched
      : Array.from({ length: days }).map((_, i) => (rawSched as any)?.[i]);
    
    const leaves: { day: number; type: StatusType; detail?: string }[] = [];
    items.slice(0, days).forEach((item, i) => {
      if (item?.type === 'pending' || item?.type === 'request') {
        leaves.push({ day: i + 1, type: item.type, detail: item.detail });
      }
    });
    return leaves;
  }, [allData, nextYear, nextMonth, currentSchedMember]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg p-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm w-full bg-white p-6 rounded-2xl shadow-lg border border-border">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <div>
            <p className="text-text font-bold text-sm">データを同期中...</p>
            <p className="text-text3 text-[11px] mt-1">数秒で自動的に起動します</p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-[11px] text-accent font-bold hover:underline bg-accent/5 px-3 py-1.5 rounded-lg border border-accent/20 transition-all flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-bold text-text mb-2">エラーが発生しました</h2>
          <p className="text-text2 text-sm mb-6">{error}</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent-d transition-all"
            >
              再読み込み
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-[100dvh] bg-bg text-text font-sans pb-20 ${isReadOnly ? 'readonly-mode' : ''}`}>
      {/* Non-blocking Save Error Banner */}
      <AnimatePresence>
        {saveError && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-500 text-white px-4 py-2 text-xs font-bold flex items-center justify-between relative z-[100] shadow-md"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={14} />
              {saveError}
            </div>
            <button onClick={() => setSaveError(null)}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1800px] w-full mx-auto px-2 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-1 sm:gap-4">
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent/20">
              <Calendar size={24} />
            </div>
            <div>
              <h1 className="sr-only min-[340px]:not-sr-only text-base sm:text-lg font-bold tracking-tight whitespace-nowrap">EX事業部スケジュール</h1>
              <p className="hidden sm:block text-[10px] text-text2 font-medium uppercase tracking-widest">Schedule Management</p>
            </div>
          </div>

          {/* Month Selector */}
          <div className="flex items-center gap-1 sm:gap-2 bg-bg rounded-lg p-0.5 sm:p-1 border border-border shrink-0">
            <button
              onClick={() => moveMonth(-1)}
              className="p-1 sm:p-1.5 hover:bg-white rounded-md transition-colors text-text2 hover:text-accent"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="font-mono text-xs sm:text-sm font-bold px-1 sm:px-3 min-w-[64px] sm:min-w-[100px] text-center whitespace-nowrap">
              {currentYear}.{String(currentMonth + 1).padStart(2, '0')}
            </span>
            <button
              onClick={() => moveMonth(1)}
              className="p-1 sm:p-1.5 hover:bg-white rounded-md transition-colors text-text2 hover:text-accent"
            >
              <ChevronRightIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCurrentYear(now.getFullYear());
                setCurrentMonth(now.getMonth());
              }}
              className="px-1 sm:px-2 py-1.5 text-xs whitespace-nowrap rounded-md text-text2 hover:bg-white hover:text-accent"
            >
              今月
            </button>
          </div>
          
          <div className="flex items-center gap-0.5 sm:gap-4 shrink-0">
            {isSaving && (
              <div className="flex items-center gap-1.5 text-[10px] text-accent font-bold animate-pulse">
                <Save size={12} />
                <span className="hidden sm:inline">保存中...</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              title="再読み込み"
              className="p-1 sm:p-1.5 text-text3 hover:text-accent hover:bg-bg rounded-lg transition-colors flex items-center gap-1 text-[11px]"
            >
              <RefreshCw size={14} />
              <span className="hidden md:inline">再同期</span>
            </button>
            {canEdit && (
              <button
                type="button"
                data-edit-only
                onClick={() => setIsMemberModalOpen(true)}
                title="メンバーの追加・編集・削除"
                className="px-2 sm:px-2.5 py-1.5 text-accent bg-accent/5 hover:bg-accent hover:text-white border border-accent/25 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-bold"
              >
                <Users size={13} />
                <span className="hidden md:inline">メンバー管理</span>
              </button>
            )}
            {isReadOnly ? (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg border border-slate-200 text-[10px] font-bold">
                <Eye size={12} />
                閲覧専用モード
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 text-[10px] font-bold">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                パブリック編集モード
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-border px-2 sm:px-4 flex overflow-x-auto shadow-sm sticky top-14 sm:top-16 z-40 hide-scrollbar">
        <div className="max-w-[1800px] w-full mx-auto flex">
          {[
            { id: 'schedule', label: 'スケジュール', icon: Calendar },
            { id: 'daily', label: '日別ビュー', icon: CalendarDays },
            { id: 'overall', label: '全体表示', icon: Info },
            { id: 'summary', label: 'ステータス集計', icon: BarChart3 },
            { id: 'projects', label: '案件共有', icon: LayoutGrid },
            { id: 'requests', label: '希望休申請', icon: ClipboardList, badge: allPendingRequests.length },
            { id: 'history', label: '変更履歴', icon: History },
            { id: 'memo', label: '全体メモ', icon: StickyNote },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 sm:px-5 py-2.5 sm:py-3.5 text-xs sm:text-sm font-medium transition-all border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === tab.id 
                  ? 'text-accent border-accent font-bold bg-accent/5' 
                  : 'text-text2 border-transparent hover:text-accent hover:bg-bg'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="p-2.5 sm:p-4 max-w-[1800px] mx-auto w-full flex-grow">
        <>
          {activeTab === 'schedule' && (
            <motion.div
              key={`schedule-${monthKey}-${currentSchedMember}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <MemberTabs 
                members={globalMembers} 
                current={currentSchedMember} 
                onSelect={setCurrentSchedMember} 
                requestBadges={memberRequestBadges}
                canEdit={canEdit}
                onManageMembers={() => setIsMemberModalOpen(true)}
              />

              {/* 翌月（9月等）の希望休・申請中プレビュー通知バー */}
              {selectedMemberNextMonthLeaves.length > 0 && (
                <div className="bg-blue-50/90 border border-blue-200 rounded-xl p-2.5 px-4 text-xs flex items-center justify-between gap-3 flex-wrap shadow-2xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-blue-900 flex items-center gap-1.5">
                      <Info size={14} className="text-blue-600 shrink-0" />
                      {currentSchedMember.replace('　', '')}さんの翌月（{nextMonth + 1}月）の希望休:
                    </span>
                    {selectedMemberNextMonthLeaves.map(leave => (
                      <span
                        key={leave.day}
                        className={`px-2 py-0.5 rounded font-bold font-mono text-xs ${
                          leave.type === 'pending'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-pink-100 text-pink-900 border border-pink-200'
                        }`}
                      >
                        {nextMonth + 1}/{leave.day} ({leave.type === 'pending' ? '申請中' : '確定◎'})
                        {leave.detail ? ` ${leave.detail}` : ''}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setCurrentMonth(nextMonth);
                      if (nextYear !== currentYear) setCurrentYear(nextYear);
                    }}
                    className="text-blue-700 hover:text-blue-950 font-bold text-[11px] underline flex items-center gap-0.5 shrink-0"
                  >
                    {nextMonth + 1}月のスケジュールを開く
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}

              <Legend />
              
              <div className="bg-white rounded-xl shadow-sm p-4 md:p-5 border border-border overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-text">{currentYear}年{currentMonth + 1}月</span>
                    {currentYear === 2026 && currentMonth === 3 && (
                      <button
                        data-edit-only
                        onClick={handleRestoreInitial}
                        className="px-3 py-1 rounded-md text-xs transition-all border bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100"
                      >
                        初期データに復元
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-text3 flex items-center gap-1">
                    <ChevronRight size={12} className="animate-pulse" />
                    横スクロールで全体表示
                  </div>
                </div>

                {/* Scrollable Calendar Container */}
                <div className="overflow-x-auto md:overflow-x-visible pb-2 -mx-4 px-4 md:mx-0 md:px-0">
                  <div className="min-w-[700px] md:min-w-0">
                    {/* Calendar Grid Header */}
                    <div className="grid grid-cols-7 gap-1 md:gap-2 mb-1">
                      {['月', '火', '水', '木', '金', '土', '日'].map((day, i) => (
                        <div key={day} className={`text-center text-[11px] font-bold py-1 font-mono ${
                          i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-text2'
                        }`}>
                          {day}
                        </div>
                      ))}
                    </div>

                    {/* Calendar Grid Body */}
                    <div className="grid grid-cols-7 gap-1 md:gap-2">
                      {/* Offset cells */}
                      {Array.from({ length: startOffset }).map((_, i) => (
                        <div key={`offset-${i}`} className="min-h-[100px] md:min-h-[130px]" />
                      ))}

                      {/* Day cells */}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const dow = getDow(currentYear, currentMonth, day);
                        const item = currentMonthData.schedule[currentSchedMember]?.[i] || { type: 'rest', detail: '' };
                        const type = item.type;
                        const detail = item.detail;
                        const date = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const eventClient = type === 'event' ? item.client ?? eventClientFor(currentMonthData.projects || [], date, detail) : '';
                        const eventColor = clientColor(eventClient);
                        const holiday = getHoliday(currentYear, currentMonth, day);
                        const isSat = dow === 5;
                        const isSun = dow === 6;
                        const isRed = isSun || !!holiday;


                        return (
                          <div
                            key={day}
                            className={`border border-border rounded-lg p-1.5 md:p-2 min-h-[100px] md:min-h-[130px] transition-all relative flex flex-col bg-white ${
                              isRed ? 'bg-red-50/30' : isSat ? 'bg-blue-50/30' : ''
                            }`}
                          >
                            <span className={`font-mono text-xs font-bold mb-0.5 ${
                              isRed ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-accent'
                            }`}>
                              {day}
                            </span>
                            {holiday && (
                              <span className="text-[8px] font-bold text-red-600 leading-tight mb-1 truncate" title={holiday}>
                                {holiday}
                              </span>
                            )}

                            <div className="flex flex-col gap-1 mb-1">
                              {eventClient && eventColor && (
                                <span
                                  className="w-full px-1 py-0.5 rounded text-[8px] font-extrabold truncate"
                                  style={{ backgroundColor: eventColor.soft, color: eventColor.text, borderLeft: `3px solid ${eventColor.accent}` }}
                                  title={eventClient}
                                >
                                  {clientShortName(eventClient)}
                                </span>
                              )}
                              <select
                                data-status-select
                                className={`w-full px-1 py-0.5 rounded text-[8.5px] font-bold outline-none border border-transparent focus:border-accent/30 transition-all ${TYPE_CLASS[type]}`}
                                value={type}
                                disabled={!canEdit || savingScheduleTypes.has(`${monthKey}:${currentSchedMember}:${i}`)}
                                onChange={(e) => handleScheduleTypeChange(currentSchedMember, i, e.target.value as StatusType)}
                              >
                                {Object.keys(TYPE_LABEL).map(t => (
                                  <option key={t} value={t}>{TYPE_LABEL[t as StatusType]}</option>
                                ))}
                              </select>
                              {(type !== 'normal' && type !== 'request' && type !== 'rest') && (
                                <LocalInput
                                  className="w-full px-1.5 py-0.5 rounded border border-border text-[9px] md:text-[10px] outline-none focus:border-accent"
                                  size={9.5}
                                  value={detail}
                                  disabled={!canEdit}
                                  onChange={(val: string) => handleScheduleDetailChange(currentSchedMember, i, val)}
                                  placeholder="詳細..."
                                  list="status-suggestions"
                                />
                              )}
                            </div>


                          </div>
                        );
                      })}
                    </div>
                    <datalist id="status-suggestions">
                      {Object.keys(currentMonthData.trainingLabels || {}).map(k => (
                        <option key={k} value={k}>{currentMonthData.trainingLabels?.[k]}</option>
                      ))}
                      <option value="待機(海浜幕張)" />
                      <option value="待機(鳥浜)" />
                      <option value="海浜幕張" />
                      <option value="鳥浜" />
                      <option value="外販ミステリー1" />
                      <option value="イベントメンバー選抜" />
                      <option value="VR" />
                      <option value="販売" />
                    </datalist>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'overall' && (
            <motion.div
              key={`overall-${monthKey}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
                <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-bold text-text">
                    <div className="w-1 h-4 bg-accent rounded-full" />
                    全体稼働状況 ({currentYear}年{currentMonth + 1}月)
                  </div>
                  {currentMonthData.teamGoal && (
                    <div className="text-[10px] text-text2 font-bold truncate max-w-xs">
                      今月の全体目標: <span className="text-accent">{currentMonthData.teamGoal}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap" data-no-print>
                    <div className="flex items-center rounded-lg border border-border2 overflow-hidden">
                      <button
                        onClick={() => scrollOverall(-1)}
                        title="1日戻る"
                        className="px-3 py-2.5 sm:px-2 sm:py-1.5 text-text2 hover:text-accent hover:bg-accent-l/40 transition-colors"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        onClick={() => scrollOverallToDay(1)}
                        title="月初へ"
                        className="px-3 py-2.5 sm:px-2 sm:py-1.5 border-x border-border2 text-text2 hover:text-accent hover:bg-accent-l/40 transition-colors"
                      >
                        <ArrowLeftToLine size={14} />
                      </button>
                      <button
                        onClick={() => scrollOverall(1)}
                        title="1日進む"
                        className="px-3 py-2.5 sm:px-2 sm:py-1.5 text-text2 hover:text-accent hover:bg-accent-l/40 transition-colors"
                      >
                        <ChevronRightIcon size={14} />
                      </button>
                    </div>
                    {isCurrentMonth && (
                      <ToolbarButton
                        icon={CalendarDays}
                        label={`今日へ (${todayDate}日)`}
                        onClick={() => scrollOverallToDay(todayDate)}
                      />
                    )}
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border2">
                      <Search size={12} className="text-text3" />
                      <input
                        className="outline-none text-[11px] bg-transparent"
                        style={{ fontSize: '16px', width: '120px' }}
                        value={overallQuery}
                        onChange={e => setOverallQuery(e.target.value)}
                        data-view-control
                        placeholder="メンバー検索"
                      />
                    </div>
                    {canEdit && (
                      <ToolbarButton
                        icon={Users}
                        label="メンバー管理"
                        onClick={() => setIsMemberModalOpen(true)}
                      />
                    )}
                  </div>
                </div>

                <div
                  ref={overallScrollRef}
                  onScroll={e => {
                    const el = e.currentTarget;
                    const maxScroll = el.scrollWidth - el.clientWidth;
                    setOverallScrollPercent(maxScroll > 0 ? Math.round(el.scrollLeft / maxScroll * 100) : 0);
                  }}
                  className="overflow-x-auto scroll-x-strong -mx-5 px-5 relative border-b border-border"
                >
                  <table className="w-full text-[9px] border-separate border-spacing-0 min-w-[max-content]">
                    <thead className="relative z-30">
                      <tr className="bg-accent-l text-accent">
                        <th data-sticky-col className="p-1 border border-border font-bold sticky left-0 top-0 bg-accent-l z-50 min-w-[48px] text-[8px] text-left leading-tight">
                          人 / 累計
                        </th>
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                          const day = i + 1;
                          const dow = getDow(currentYear, currentMonth, day);
                          const holiday = getHoliday(currentYear, currentMonth, day);
                          const isSat = dow === 5;
                          const isSun = dow === 6;
                          const isRed = isSun || !!holiday;
                          const isToday = isCurrentMonth && day === todayDate;
                          return (
                            <th key={day} data-day={day} title={holiday || undefined} className={`p-0.5 border font-bold text-center min-w-[42px] text-[8px] sticky top-0 z-30 ${
                              isToday ? 'border-accent bg-accent text-white' : 'border-border'
                            } ${
                              isToday ? '' : isRed ? 'text-red-600 bg-red-50' : isSat ? 'text-blue-600 bg-blue-50' : 'bg-accent-l'
                            }`}>
                              {day}({['月','火','水','木','金','土','日'][dow]})
                              {holiday && <span className="block text-[6px] font-bold text-red-600 leading-none truncate">{holiday}</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Row for Global Location (場所) */}
                      <tr className="bg-orange-50/30">
                        <td className="p-1 border border-border sticky left-0 bg-orange-50 z-20 font-bold text-orange-800 text-[8px]">
                          場所 (固定表示)
                        </td>
                        {Array.from({ length: daysInMonth }).map((_, i) => (
                          <td key={i} className="p-0.5 border border-border min-w-[42px]">
                            <LocalInput
                              className="w-full px-0.5 py-0.5 rounded border border-orange-200 text-[7.5px] outline-none focus:border-orange-500 bg-white/50 focus:bg-white h-5 text-center font-bold text-orange-700"
                              size={7.5}
                              value={currentMonthData.dailyLocations?.[i + 1] || ''}
                              disabled={!canEdit}
                              onChange={(val: string) => handleGlobalLocationChange(i + 1, val)}
                              placeholder="場所"
                            />
                          </td>
                        ))}
                      </tr>

                      {/* Row for Global Time (時間) */}
                      <tr className="bg-blue-50/30">
                        <td className="p-1 border border-border sticky left-0 bg-blue-50 z-20 font-bold text-blue-800 text-[8px]">
                          時間 (固定表示)
                        </td>
                        {Array.from({ length: daysInMonth }).map((_, i) => (
                          <td key={i} className="p-0.5 border border-border min-w-[42px]">
                            <LocalInput
                              className="w-full px-0.5 py-0.5 rounded border border-blue-200 text-[7.5px] outline-none focus:border-blue-500 bg-white/50 focus:bg-white h-5 text-center font-bold text-blue-700"
                              size={7.5}
                              value={currentMonthData.dailyTimes?.[i + 1] || ''}
                              disabled={!canEdit}
                              onChange={(val: string) => handleGlobalTimeChange(i + 1, val)}
                              placeholder="時間"
                            />
                          </td>
                        ))}
                      </tr>

                      {/* Row for workingCount (稼働数) */}
                      <tr className="bg-bg/50">
                        <td className="p-1 border border-border sticky left-0 bg-bg z-20 font-bold text-text text-[8px]">
                          稼働人数 (合計)
                        </td>
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                          let count = 0;
                          globalMembers.forEach(name => {
                            const item = currentMonthData.schedule[name]?.[i] || { type: 'rest' };
                            if (item.type !== 'normal' && item.type !== 'request' && item.type !== 'rest' && item.type !== 'absence') {
                              count++;
                            }
                          });
                          return (
                            <td key={i} className="p-0.5 border border-border text-center font-bold text-text text-[8px] min-w-[42px]">
                              {count}人
                            </td>
                          );
                        })}
                      </tr>

                      {/* Staff rows */}
                      {globalMembers.filter(name => normalizeVenue(name).includes(normalizeVenue(overallQuery))).map(name => {
                        const schedule = currentMonthData.schedule[name] || [];
                        const normalCount = schedule.filter(s => s.type === 'normal').length;
                        const requestCount = schedule.filter(s => s.type === 'request').length;
                        return (
                          <tr key={name} className="hover:bg-bg/40 transition-colors">
                            <td className="p-0.5 border border-border sticky left-0 bg-white z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between gap-0.25">
                                  <div className="font-bold text-accent text-[7.5px] truncate max-w-[32px]">{name.replace('　', '')}</div>
                                  <div className="flex flex-col text-[6px] font-bold leading-tight shrink-0">
                                    <span className="text-gray-400">公{normalCount}</span>
                                    <span className="text-pink-400">希{requestCount}</span>
                                  </div>
                                </div>
                                <LocalInput
                                  className="w-full px-0.5 py-0 rounded border border-accent/10 text-[6.5px] outline-none focus:border-accent bg-white/50 font-normal h-2.5"
                                  size={6.5}
                                  value={globalStations[name] ?? currentMonthData.memberStations?.[name] ?? ''}
                                  disabled={!canEdit}
                                  onChange={(val: string) => handleMemberStationChange(name, val)}
                                  placeholder="駅"
                                />
                              </div>
                            </td>
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                              const item = currentMonthData.schedule[name]?.[i] || { type: 'rest', detail: '' };
                              const date = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                              const eventClient = item.type === 'event' ? item.client ?? eventClientFor(currentMonthData.projects || [], date, item.detail || '') : '';
                              const eventColor = clientColor(eventClient);
                              return (
                                <td key={i} className="p-0.5 border border-border min-w-[42px]">
                                  <div className="flex flex-col gap-0.5 min-w-full w-max text-center justify-center mx-auto" style={eventColor ? { borderTop: `3px solid ${eventColor.accent}` } : undefined} title={[item.detail, eventClient].filter(Boolean).join(' / ') || undefined}>
                                    {item.type === 'event' && (
                                      <div
                                        className="min-w-full w-max rounded"
                                        style={eventColor ? { backgroundColor: eventColor.soft } : undefined}
                                      >
                                        <LocalInput
                                          className="min-w-full w-max px-0.5 py-0 rounded border border-border2 text-[6.5px] leading-tight outline-none focus:border-accent h-3 text-center font-bold"
                                          size={6.5}
                                          value={item.client ?? eventClient}
                                          disabled={!canEdit}
                                          onChange={(val: string) => handleScheduleClientChange(name, i, val)}
                                          normalize={(value: string) => value.trim()}
                                          placeholder="クライアント"
                                          list="client-suggestions"
                                          title="クライアント名（日付・会場が一致する案件共有にも反映）"
                                          style={eventColor ? { color: eventColor.text } : undefined}
                                        />
                                      </div>
                                    )}
                                    <select
                                      data-status-select
                                      className={`w-full px-0.5 py-0 rounded text-[7px] leading-tight font-bold outline-none border border-transparent focus:border-accent/30 transition-all ${TYPE_CLASS[item.type]}`}
                                      value={item.type}
                                      disabled={!canEdit || savingScheduleTypes.has(`${monthKey}:${name}:${i}`)}
                                      onChange={(e) => handleScheduleTypeChange(name, i, e.target.value as StatusType)}
                                    >
                                      {Object.keys(TYPE_LABEL).map(t => (
                                        <option key={t} value={t}>{TYPE_LABEL[t as StatusType].split('(')[0]}</option>
                                      ))}
                                    </select>
                                    <LocalInput
                                      className="min-w-full w-max px-0.5 py-0.5 rounded border border-border text-[7.5px] outline-none focus:border-accent bg-white/50 focus:bg-white h-4 text-center justify-center mx-auto"
                                      size={7.5}
                                      value={item.detail || ''}
                                      disabled={!canEdit}
                                      onChange={(val: string) => handleScheduleDetailChange(name, i, val)}
                                      placeholder="..."
                                    />
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              </div>
              <datalist id="client-suggestions">
                {clientSuggestions.map(client => (
                  <option key={client} value={client} />
                ))}
              </datalist>
            </motion.div>
          )}
          {activeTab === 'daily' && (
            <motion.div
              key="daily"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <DailyView
                members={globalMembers}
                schedule={currentMonthData.schedule}
                year={currentYear}
                month={currentMonth}
                daysInMonth={daysInMonth}
                dailyLocations={currentMonthData.dailyLocations || {}}
                dailyTimes={currentMonthData.dailyTimes || {}}
              />
            </motion.div>
          )}

          {activeTab === 'summary' && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <SummaryView
                members={globalMembers}
                schedule={currentMonthData.schedule}
                daysInMonth={daysInMonth}
                year={currentYear}
                month={currentMonth}
              />
            </motion.div>
          )}

          {activeTab === 'projects' && (
            <motion.div
              key="projects"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ProjectsView
                projects={currentMonthData.projects || []}
                members={globalMembers}
                leadMembers={globalLeadMembers}
                candidates={projectCandidates}
                year={currentYear}
                month={currentMonth}
                canEdit={!isReadOnly}
                initialProjectId={initialProjectId}
                clientSuggestions={clientSuggestions}
                onSaveProjects={async (projects, baseline) => {
                  if (isReadOnly) throw new Error('閲覧専用のため保存できません。');
                  return saveProjectChanges(monthKey, projects, baseline);
                }}
              />
            </motion.div>
          )}

          {activeTab === 'requests' && (
            <motion.div
              key="requests"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <RequestsView
                allPendingRequests={allPendingRequests}
                allData={allData}
                members={globalMembers}
                currentYear={currentYear}
                currentMonth={currentMonth}
                canEdit={!isReadOnly}
                onApprove={handleApprovePendingItem}
                onReject={handleRejectPendingItem}
                onSetNormal={handleSetNormalPendingItem}
              />
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <HistoryView
                history={currentMonthData.history || []}
                onClear={handleClearHistory}
              />
            </motion.div>
          )}
          {activeTab === 'memo' && (
            <motion.div
              key="memo"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
                <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-bold text-text">
                    <div className="w-1 h-4 bg-accent rounded-full" />
                    全体メモ / 連絡事項 ({currentYear}年{currentMonth + 1}月)
                  </div>
                  <button
                    data-edit-only
                    onClick={() => {
                      updateCurrentMonthData({ overallMemo: currentMonthData.overallMemo });
                      triggerSaveOk('overall-memo');
                    }}
                    className="bg-accent text-white px-4 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 hover:bg-accent-d transition-colors"
                  >
                    <Save size={12} />
                    メモを保存
                  </button>
                </div>

                <div className="mb-4">
                  <div className="text-[10px] font-bold text-text2 mb-1">今月の全体目標</div>
                  <div className="flex items-center gap-2">
                    <LocalInput
                      className="w-full px-3 py-2 rounded-lg border border-accent/20 bg-accent-l/30 focus:bg-white outline-none text-xs font-bold"
                      size={12}
                      value={currentMonthData.teamGoal}
                      onChange={(val: string) => updateCurrentMonthData({ teamGoal: val })}
                      placeholder="今月の全体目標を入力..."
                    />
                    {showSaveOk['team-goal'] && (
                      <span className="text-[10px] text-green-600 font-bold whitespace-nowrap">✓ 保存</span>
                    )}
                  </div>
                </div>

                <LocalTextarea
                  className="w-full border border-accent/20 rounded-xl p-4 text-xs bg-white focus:border-accent outline-none min-h-[420px] leading-relaxed font-bold text-text"
                  placeholder="全体に向けた連絡事項や、月間の特記事項を入力してください..."
                  value={currentMonthData.overallMemo || ''}
                  onChange={(val: string) => {
                    updateCurrentMonthData({ overallMemo: val });
                  }}
                />
                {showSaveOk['overall-memo'] && (
                  <div className="mt-2 text-right text-[10px] text-green-600 font-bold animate-pulse">
                    ✓ 全体メモを保存しました
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </>
      </main>

      {activeTab === 'overall' && (
        <div
          data-no-print
          className="hidden md:flex fixed bottom-4 right-4 z-50 items-center gap-2 rounded-xl border border-border2 bg-white/95 px-3 py-2 shadow-xl backdrop-blur"
        >
          <button
            type="button"
            onClick={() => scrollOverall(-1)}
            aria-label="全体表示を1日戻す"
            title="1日戻る"
            className="p-2 rounded-lg text-text2 hover:bg-accent-l hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs font-bold text-text2">月初</span>
          <input
            data-view-control
            type="range"
            min="0"
            max="100"
            value={overallScrollPercent}
            onChange={e => scrollOverallToPercent(Number(e.target.value))}
            aria-label="全体表示を左右に移動"
            title="ドラッグして左右へ移動"
            className="w-36 cursor-ew-resize accent-blue-600"
          />
          <span className="text-xs font-bold text-text2">月末</span>
          <button
            type="button"
            onClick={() => scrollOverall(1)}
            aria-label="全体表示を1日進める"
            title="1日進む"
            className="p-2 rounded-lg text-text2 hover:bg-accent-l hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
      )}

      <MemberManagementModal
        open={isMemberModalOpen}
        members={globalMembers}
        leadMembers={globalLeadMembers}
        canEdit={canEdit}
        onClose={() => setIsMemberModalOpen(false)}
        onAddMember={async (name, isLead) => {
          const res = await addTeamMember(name, isLead, globalMembers, globalLeadMembers);
          setGlobalMembers(res.members);
          setGlobalLeadMembers(res.leadMembers);
          try {
            localStorage.setItem('ex_portable_cached_members', JSON.stringify(res.members));
            localStorage.setItem('ex_portable_cached_lead_members', JSON.stringify(res.leadMembers));
          } catch (e) {}
        }}
        onRenameMember={async (oldName, newName, isLead) => {
          const knownMonths = Array.from(new Set([monthKey, ...Object.keys(allData)]));
          const res = await renameTeamMember(oldName, newName, isLead, globalMembers, globalLeadMembers, knownMonths);
          setGlobalMembers(res.members);
          setGlobalLeadMembers(res.leadMembers);
          if (currentSchedMember === oldName) {
            setCurrentSchedMember(newName.trim());
          }
          try {
            localStorage.setItem('ex_portable_cached_members', JSON.stringify(res.members));
            localStorage.setItem('ex_portable_cached_lead_members', JSON.stringify(res.leadMembers));
          } catch (e) {}
        }}
        onDeleteMember={async (targetName) => {
          const knownMonths = Array.from(new Set([monthKey, ...Object.keys(allData)]));
          const res = await deleteTeamMember(targetName, globalMembers, globalLeadMembers, knownMonths);
          setGlobalMembers(res.members);
          setGlobalLeadMembers(res.leadMembers);
          if (currentSchedMember === targetName && res.members.length > 0) {
            setCurrentSchedMember(res.members[0]);
          }
          try {
            localStorage.setItem('ex_portable_cached_members', JSON.stringify(res.members));
            localStorage.setItem('ex_portable_cached_lead_members', JSON.stringify(res.leadMembers));
          } catch (e) {}
        }}
        onUpdateOrderOrRole={async (nextMembers, nextLeads) => {
          const res = await updateTeamMemberRoleOrOrder(nextMembers, nextLeads);
          setGlobalMembers(res.members);
          setGlobalLeadMembers(res.leadMembers);
          try {
            localStorage.setItem('ex_portable_cached_members', JSON.stringify(res.members));
            localStorage.setItem('ex_portable_cached_lead_members', JSON.stringify(res.leadMembers));
          } catch (e) {}
        }}
      />

      {/* Footer Info */}
      <footer className="bg-white border-t border-border p-4 text-center">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-[10px] text-text3">
          <div className="flex items-center gap-1.5">
            <Info size={12} />
            <span>データはサーバーにリアルタイム保存されます。</span>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-accent hover:underline flex items-center gap-1 font-medium transition-colors"
          >
            <RefreshCw size={10} />
            起動が重い・表示が遅い時は再読み込み
          </button>
        </div>
      </footer>
    </div>
  );
}
