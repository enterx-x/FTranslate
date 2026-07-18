import { useState } from 'react';
import type { MobileTranslationSession } from './mobileTypes';
import { validateMobileTranslationSession } from './mobileTranslation';

interface MobileTranslationSettingsDialogProps {
  session: MobileTranslationSession;
  title?: string;
  submitLabel?: string;
  requireApiKey?: boolean;
  onClose: () => void;
  onSave: (session: MobileTranslationSession) => Promise<void>;
}

export function MobileTranslationSettingsDialog({
  session,
  title = '翻译设置',
  submitLabel = '保存设置',
  requireApiKey = false,
  onClose,
  onSave
}: MobileTranslationSettingsDialogProps) {
  const [form, setForm] = useState(session);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const normalizedForm = {
        baseURL: form.baseURL.trim().replace(/\/+$/u, ''),
        model: form.model.trim(),
        apiKey: form.apiKey.trim()
      };
      const validationError = validateMobileTranslationSession(normalizedForm, requireApiKey);
      if (validationError) {
        throw new Error(validationError);
      }
      await onSave(normalizedForm);
    } catch (saveError) {
      setError(`保存失败：${formatError(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mobile-dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="mobile-translation-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="mobile-dialog-handle" />
        <header><strong>{title}</strong><button type="button" onClick={onClose}>关闭</button></header>
        <p>支持允许浏览器访问的 OpenAI 兼容接口。Base URL、模型和 API Key 都只保存在当前浏览器/手机本地，不会上传到 FTranslate 或 Vercel；清空 API Key 后保存即可移除本地记录。</p>
        <label>Base URL<input value={form.baseURL} onChange={(event) => setForm((value) => ({ ...value, baseURL: event.target.value }))} /></label>
        <label>Model<input value={form.model} onChange={(event) => setForm((value) => ({ ...value, model: event.target.value }))} /></label>
        <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm((value) => ({ ...value, apiKey: event.target.value }))} placeholder="保存在当前设备" autoComplete="off" /></label>
        {error ? <p className="mobile-dialog-error" role="alert">{error}</p> : null}
        <button type="button" className="mobile-dialog-primary" disabled={saving} onClick={() => void handleSave()}>{saving ? '保存中…' : submitLabel}</button>
      </section>
    </div>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
