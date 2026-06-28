import { useEffect, useMemo } from 'react';

export interface RecentProject {
  pdfPath?: string;
  translationPath?: string;
  aiCachePath?: string;
}

export const RECENT_PROJECT_KEY = 'pdfTranslationReader:lastProject';

export function shouldPersistRecentProject(project: RecentProject): boolean {
  return Boolean(project.pdfPath || project.translationPath);
}

export function useRecentProject(project: RecentProject): RecentProject {
  const recentProject = useMemo(
    () => project,
    [project.aiCachePath, project.pdfPath, project.translationPath]
  );

  useEffect(() => {
    if (!shouldPersistRecentProject(recentProject)) {
      return;
    }

    localStorage.setItem(RECENT_PROJECT_KEY, JSON.stringify(recentProject));
  }, [recentProject]);

  return recentProject;
}
