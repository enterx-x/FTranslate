import type { DailyBriefFeedback, DailyBriefPreferences, DailyBriefSnapshot } from '../../../shared/dailyBrief';
import type { IpcMainLike } from './types';

interface DailyBriefIpcService {
  getSnapshot: () => Promise<DailyBriefSnapshot>;
  savePreferences: (preferences: DailyBriefPreferences) => Promise<DailyBriefSnapshot>;
  run: () => Promise<DailyBriefSnapshot>;
  setFeedback: (feedback: DailyBriefFeedback) => Promise<DailyBriefSnapshot>;
  removeFeedback: (paperId: string) => Promise<DailyBriefSnapshot>;
}

export function registerDailyBriefIpcHandlers(ipcMain: IpcMainLike, service: DailyBriefIpcService): void {
  ipcMain.handle('daily-brief:snapshot', () => service.getSnapshot());
  ipcMain.handle('daily-brief:save-preferences', (_event, preferences) => service.savePreferences(preferences));
  ipcMain.handle('daily-brief:run', () => service.run());
  ipcMain.handle('daily-brief:feedback', (_event, feedback) => service.setFeedback(feedback));
  ipcMain.handle('daily-brief:remove-feedback', (_event, paperId) => service.removeFeedback(paperId));
}
