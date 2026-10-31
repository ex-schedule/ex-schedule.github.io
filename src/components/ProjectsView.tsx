import { useState, useRef, useMemo } from 'react';
import { LEAD_MEMBERS, NON_EVENT_KEYWORDS } from '../constants';
import type { ProjectItem, ProjectCandidate } from '../types';
import { genId, todayString, isNonEventVenue, isSameVenue, sameProjectName, detectProjectMetadata, projectCoversDate, projectDates } from '../utils/venue';
import { ProjectsListView } from './ProjectsListView';
import { ProjectDetailView } from './ProjectDetailView';
import { mergeSameNameProjects } from '../utils/projectChanges';


export const ProjectsView = ({
  projects,
  members,
  leadMembers,
  candidates,
  year,
  month,
  canEdit,
  initialProjectId,
  clientSuggestions,
  onSaveProjects,
}: {
  projects: ProjectItem[];
  members: string[];
  leadMembers?: string[];
  candidates: ProjectCandidate[];
  year: number;
  month: number;
  canEdit: boolean;
  initialProjectId?: string | null;
  clientSuggestions: string[];
  onSaveProjects: (next: ProjectItem[], baseline: ProjectItem[]) => Promise<ProjectItem[]>;
}) => {
  const activeLeadMembers = leadMembers || LEAD_MEMBERS;
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId || null);
  const [newProjectDraft, setNewProjectDraft] = useState<ProjectItem | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const registerPendingRef = useRef<Set<string>>(new Set());
  const registerAllPendingRef = useRef(false);
  const [myName, setMyName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('ex-my-name') || '';
  });

  const handleChangeMyName = (name: string) => {
    setMyName(name);
    try {
      window.localStorage.setItem('ex-my-name', name);
    } catch (e) {
      console.error('名前の保存に失敗しました', e);
    }
  };

  const today = todayString();
  const isCurrentProject = (p: ProjectItem) => {
    const lastDate = [p.date, p.dateEnd, ...(p.occurrenceDates || [])].filter(Boolean).sort().at(-1);
    return !lastDate || lastDate >= today;
  };

  const { displayProjects, sourceIdsById, mergeErrors } = useMemo(() => {
    const trimPastDates = (p: ProjectItem): ProjectItem | null => {
      const allDates = projectDates(p);
      if (allDates.length === 0) return p;
      const futureDates = allDates.filter(d => d >= today);
      if (futureDates.length === 0) return null;
      if (futureDates.length === allDates.length) return p;
      return {
        ...p,
        date: futureDates[0],
        dateEnd: futureDates[futureDates.length - 1],
        ...(p.occurrenceDates?.length ? { occurrenceDates: futureDates } : {}),
      };
    };

    const currentOnly = projects
      .filter(p => !isNonEventVenue(p.venue) && isCurrentProject(p))
      .map(trimPastDates)
      .filter((p): p is ProjectItem => p !== null);

    const displayProjects: ProjectItem[] = [];
    const sourceIdsById = new Map<string, string[]>();
    const mergeErrors: string[] = [];
    const visited = new Set<string>();
    for (const project of currentOnly) {
      if (visited.has(project.id)) continue;
      const matches = currentOnly.filter(p => sameProjectName(p.venue, project.venue));
      matches.forEach(p => visited.add(p.id));
      if (matches.length < 2) {
        displayProjects.push(project);
        sourceIdsById.set(project.id, [project.id]);
        continue;
      }
      try {
        const merged = mergeSameNameProjects(matches, project.venue, project.id)[0];
        displayProjects.push(merged);
        sourceIdsById.set(merged.id, matches.map(p => p.id));
      } catch (error) {
        displayProjects.push(...matches);
        matches.forEach(p => sourceIdsById.set(p.id, [p.id]));
        mergeErrors.push(error instanceof Error ? error.message : '同名案件を統合できませんでした。');
      }
    }
    return { displayProjects, sourceIdsById, mergeErrors };
  }, [projects, today]);

  const visibleProjects = displayProjects;

  const selectedSnapshot = useRef<ProjectItem | null>(null);
  const liveSelected = visibleProjects.find(p => p.id === selectedId || sourceIdsById.get(p.id)?.includes(selectedId || ''));
  if (liveSelected) selectedSnapshot.current = liveSelected;
  const selectedCandidate = liveSelected || (newProjectDraft?.id === selectedId ? newProjectDraft : null)
    || (selectedSnapshot.current?.id === selectedId ? selectedSnapshot.current : null);
  const selected = selectedCandidate && isCurrentProject(selectedCandidate) ? selectedCandidate : null;
  const directorOptions = members;
  const leadOptions = members.filter(m => activeLeadMembers.includes(m));
  const memberOptions = members;

  const addProject = () => {
    if (!canEdit) return;
    const isCurrentYearMonth = new Date().getFullYear() === year && new Date().getMonth() === month;
    const defaultDate = isCurrentYearMonth ? today : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const created: ProjectItem = {
      id: genId(),
      date: defaultDate,
      dateEnd: defaultDate,
      timeStart: '10:00',
      timeEnd: '18:00',
      client: '',
      carrier: '',
      venue: '',
      content: '',
      headcount: 1,
      directors: [],
      leads: [],
      members: [],
      comment: '',
      layout: [],
      updatedAt: new Date().toISOString(),
    };
    setNewProjectDraft(created);
    setSelectedId(created.id);
  };

  const removeProject = async (baseline: ProjectItem) => {
    if (!canEdit) throw new Error("閲覧専用のため保存できません。");
    if (newProjectDraft?.id === baseline.id) {
      setNewProjectDraft(null);
      setSelectedId(null);
      return;
    }
    const baselineArray = projects;
    const sourceIds = new Set(sourceIdsById.get(baseline.id) || [baseline.id]);
    const nextArray = projects.filter(p => !sourceIds.has(p.id));
    await onSaveProjects(nextArray, baselineArray);
    setSelectedId(null);
  };

  const projectFromCandidate = (c: ProjectCandidate): ProjectItem => {
    const meta = detectProjectMetadata(c.venue);
    return {
      id: genId(),
      date: c.date,
      dateEnd: c.dateEnd || c.date,
      occurrenceDates: c.dates,
      timeStart: c.timeStart || '10:00',
      timeEnd: c.timeEnd || '18:00',
      client: c.detectedClient || meta.client || '',
      carrier: c.detectedCarrier || meta.carrier || '',
      venue: meta.cleanVenue || c.venue,
      content: meta.content || '',
      headcount: c.members.length || 1,
      directors: [],
      leads: c.members.filter(m => activeLeadMembers.includes(m)),
      members: c.members.filter(m => !activeLeadMembers.includes(m)),
      comment: '',
      layout: [],
      updatedAt: new Date().toISOString(),
    };
  };

  // 同名の既存案件が候補の日付範囲をまだ含まない場合は、統合候補として出す
  const openCandidates = candidates.filter(
    c =>
      (c.dates.length ? [...c.dates].sort().at(-1)! : c.dateEnd || c.date) >= today &&
      !displayProjects.some(
        p =>
          sameProjectName(p.venue, c.venue) &&
          c.dates.every(date => projectCoversDate(p, date))
      )
  );

  /** 搬入・運転・前泊などイベント本体ではなく、かつ人が何も書き込んでいない案件か */
  const isEmptyNonEvent = (p: ProjectItem) =>
    (isNonEventVenue(p.venue) || NON_EVENT_KEYWORDS.some(word => p.venue.includes(word))) &&
    !p.client &&
    !p.carrier &&
    !p.content &&
    !p.comment &&
    (p.layout || []).length === 0;

  const registerCandidate = async (c: ProjectCandidate) => {
    if (!canEdit || registerAllPendingRef.current || registerPendingRef.current.has(c.key)) return;
    registerPendingRef.current.add(c.key);
    setListError(null);
    const created = projectFromCandidate(c);
    try {
      const result = await onSaveProjects([...projects, created], projects);
      const savedItem = result.find(p => p.id === created.id) || result.find(p => sameProjectName(p.venue, created.venue));
      if (!savedItem) throw new Error('保存結果に該当案件が見つかりません。');
      selectedSnapshot.current = savedItem;
      setSelectedId(savedItem.id);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '案件の登録に失敗しました。');
    } finally {
      registerPendingRef.current.delete(c.key);
    }
  };

  const registerAllCandidates = async () => {
    if (!canEdit || openCandidates.length === 0 || registerPendingRef.current.size > 0) return;
    if (registerAllPendingRef.current) return;
    registerAllPendingRef.current = true;
    setListError(null);
    try {
      await onSaveProjects([...projects, ...openCandidates.map(projectFromCandidate)], projects);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '一括登録に失敗しました。');
    } finally {
      registerAllPendingRef.current = false;
    }
  };

  const matchedCandidate = selected
    ? candidates.find(
        c =>
          isSameVenue(c.venue, selected.venue) &&
          c.dates.some(date => projectCoversDate(selected, date))
      ) || null
    : null;

  const syncMembers = (): Partial<ProjectItem> | null => {
    if (!selected || !matchedCandidate) return null;
    return {
      headcount: matchedCandidate.members.length,
      leads: matchedCandidate.members.filter(m => activeLeadMembers.includes(m)),
      members: matchedCandidate.members.filter(m => !activeLeadMembers.includes(m)),
    };
  };

  const saveDetail = async (saved: ProjectItem, baseline: ProjectItem): Promise<ProjectItem> => {
    if (!canEdit) throw new Error("閲覧専用のため保存できません。");
    const isNew = newProjectDraft?.id === baseline.id;
    const sourceIds = new Set(isNew ? [] : sourceIdsById.get(baseline.id) || [baseline.id]);
    const baselineArray = isNew || sourceIds.size !== 1
      ? projects
      : [...projects.filter(p => p.id !== baseline.id), baseline];
    const nextArray = [...projects.filter(p => !sourceIds.has(p.id)), saved];
    const result = await onSaveProjects(nextArray, baselineArray);
    const savedItem = result.find(p => p.id === saved.id) || (isNew ? result.find(p => sameProjectName(p.venue, saved.venue)) : null);
    if (!savedItem) throw new Error('保存結果に該当案件が見つかりません。');
    selectedSnapshot.current = savedItem;
    if (isNew) {
      setNewProjectDraft(null);
      setSelectedId(savedItem.id);
    }
    return savedItem;
  };

  if (selected) {
    return (
      <ProjectDetailView
        project={selected}
        directorOptions={directorOptions}
        leadOptions={leadOptions}
        memberOptions={memberOptions}
        clientSuggestions={clientSuggestions}
        year={year}
        month={month}
        canEdit={canEdit}
        onBack={() => setSelectedId(null)}
        onSave={saveDetail}
        onDelete={removeProject}
        onSyncMembers={syncMembers}
        syncCount={matchedCandidate ? matchedCandidate.members.length : null}
        mergePending={(sourceIdsById.get(selected.id)?.length || 0) > 1}
      />
    );
  }

  return (
    <>
      {mergeErrors.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
          {mergeErrors.length}組の同名案件は内容が異なるため自動統合できません。詳細を確認してください。
        </div>
      )}
      {listError && (
        <div
          className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 text-[11px] font-bold"
          data-no-print
        >
          <span>{listError}</span>
          <button
            type="button"
            onClick={() => setListError(null)}
            className="px-2 font-black text-red-700"
          >
            ×
          </button>
        </div>
      )}
      <ProjectsListView
        projects={visibleProjects}
        candidates={openCandidates}
        members={members}
        year={year}
        month={month}
        canEdit={canEdit}
        myName={myName}
        onChangeMyName={handleChangeMyName}
        onSelect={setSelectedId}
        onAdd={addProject}
        onRegister={registerCandidate}
        onRegisterAll={registerAllCandidates}
      />
    </>
  );
};
