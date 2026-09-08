import type { AiFormState } from './AiModePanel';
import type { AiProviderId } from '../../shared/aiTranslation';

interface Props {
  form: AiFormState;
  configured: boolean;
  busy: boolean;
  message: string;
  onProviderChange: (provider: AiProviderId) => void;
  onChange: (patch: Partial<AiFormState>) => void;
  onSave: () => Promise<void>;
  onTest: () => Promise<void>;
}

export function AiConnectionSettings(props: Props) {
  const connectionMessage = /^(?:AI |读取 AI|保存 AI|正在测试 AI)/u.test(props.message) ? props.message : '';
  return <section aria-label="AI 服务连接">
    <div className="settings-form-grid">
      <label>服务商<select value={props.form.provider} disabled={props.busy}
        onChange={(event) => props.onProviderChange(event.target.value as AiProviderId)}>
        <option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option>
        <option value="kimi">Kimi</option><option value="custom">自定义兼容服务</option>
      </select></label>
      <label>接口地址<input value={props.form.baseURL} disabled={props.busy} type="url"
        onChange={(event) => props.onChange({ baseURL: event.target.value })} /></label>
      <label>模型名称<input value={props.form.model} disabled={props.busy}
        onChange={(event) => props.onChange({ model: event.target.value })} /></label>
      <label>API Key<input value={props.form.apiKey} disabled={props.busy} type="password" autoComplete="off"
        placeholder={props.configured ? '同一服务留空保留原 Key' : '填写服务商提供的 Key'}
        onChange={(event) => props.onChange({ apiKey: event.target.value })} /></label>
    </div>
    <p className="inline-message" style={{ fontSize: 12, lineHeight: 1.6 }}>更换服务商或接口域名后需填写新 Key。保存后，连接测试使用已保存的配置。每日简报的 AI 增强仍需在「今日」单独开启。</p>
    <div className="settings-header-actions">
      <button type="button" className="primary-button" disabled={props.busy || !props.form.baseURL.trim() || !props.form.model.trim()} onClick={() => void props.onSave()}>保存 AI 配置</button>
      <button type="button" className="secondary-button" disabled={props.busy || !props.configured} onClick={() => void props.onTest()}>测试已保存的连接</button>
    </div>
    {connectionMessage ? <p className="inline-message" role="status" style={{ fontSize: 12 }}>{connectionMessage}</p> : null}
  </section>;
}
