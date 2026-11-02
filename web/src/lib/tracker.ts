/**
 * Application tracker. Lives ONLY in this browser's localStorage — never in the repository —
 * so private notes stay private. Export/import JSON to back up or move between devices.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Job } from './data';

export const STATUSES = ['new', 'saved', 'applied', 'recruiter_responded', 'interview', 'rejected', 'not_interested'] as const;
export type AppStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<AppStatus, string> = {
  new: 'New',
  saved: 'Saved',
  applied: 'Applied',
  recruiter_responded: 'Recruiter responded',
  interview: 'Interview',
  rejected: 'Rejected',
  not_interested: 'Not interested',
};

export interface Application {
  status: AppStatus;
  notes: string;
  appliedAt: string | null;
  updatedAt: string;
  company: string;
  title: string;
  url: string;
}
export interface TrackerState {
  version: 1;
  applications: Record<string, Application>;
}

const KEY = 'job-radar:tracker:v1';
const empty: TrackerState = { version: 1, applications: {} };

function load(): TrackerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 && parsed.applications ? parsed : empty;
  } catch {
    return empty;
  }
}
function save(s: TrackerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — state lives for this session only */
  }
}

export function useTracker() {
  const [state, setState] = useState<TrackerState>(load);
  useEffect(() => save(state), [state]);

  const update = useCallback((job: Job, patch: Partial<Pick<Application, 'status' | 'notes' | 'appliedAt'>>) => {
    setState((s) => {
      const prev = s.applications[job.id] ?? { status: 'new' as AppStatus, notes: '', appliedAt: null, updatedAt: '', company: job.company, title: job.title, url: job.officialUrl };
      const next: Application = { ...prev, ...patch, updatedAt: new Date().toISOString(), company: job.company, title: job.title, url: job.officialUrl };
      if (patch.status === 'applied' && !prev.appliedAt && patch.appliedAt === undefined) next.appliedAt = new Date().toISOString().slice(0, 10);
      return { ...s, applications: { ...s.applications, [job.id]: next } };
    });
  }, []);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `applications-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [state]);

  const importJson = useCallback(async (file: File): Promise<string> => {
    const parsed = JSON.parse(await file.text());
    if (parsed?.version !== 1 || typeof parsed.applications !== 'object') throw new Error('This file is not a Job Radar tracker export.');
    let merged = 0;
    const apps = { ...state.applications };
    for (const [id, a] of Object.entries(parsed.applications as Record<string, Application>)) {
      if (!STATUSES.includes(a.status)) continue;
      if (!apps[id] || Date.parse(a.updatedAt) > Date.parse(apps[id].updatedAt)) { apps[id] = a; merged++; }
    }
    setState({ ...state, applications: apps });
    return `Imported ${merged} application records (newer entries win).`;
  }, [state]);

  const statusOf = useCallback((id: string): AppStatus => state.applications[id]?.status ?? 'new', [state]);
  return { state, update, exportJson, importJson, statusOf };
}
