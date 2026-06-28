import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AI_PROVIDER_MODEL_OPTIONS,
  AI_PROVIDER_PRESETS,
  mergeAiModelOptions,
  withDefaultAiRuntimeOptions,
  type AiModelOption,
  type AiProviderId
} from '../../shared/aiTranslation';
import type { AiFormState } from '../components/AiModePanel';
import type { AiBalanceResult, AiSettingsView } from '../types/electron';

type BuiltInProviderId = Exclude<AiProviderId, 'custom'>;
type RuntimeModelOptions = Partial<Record<BuiltInProviderId, AiModelOption[]>>;

export function getModelOptionsForProvider(
  provider: AiProviderId,
  runtimeModelOptions: RuntimeModelOptions
): AiModelOption[] {
  return provider === 'custom'
    ? []
    : runtimeModelOptions[provider] ?? AI_PROVIDER_MODEL_OPTIONS[provider];
}

export function useAiSettings(setStatusMessage: (message: string) => void) {
  const [aiSettings, setAiSettings] = useState<AiSettingsView | null>(null);
  const [aiBalance, setAiBalance] = useState<AiBalanceResult | null>(null);
  const [runtimeModelOptions, setRuntimeModelOptions] = useState<RuntimeModelOptions>({});
  const [aiForm, setAiForm] = useState<AiFormState>(() => ({
    ...withDefaultAiRuntimeOptions(AI_PROVIDER_PRESETS.deepseek),
    apiKey: ''
  }));
  const [isAiBusy, setIsAiBusy] = useState(false);

  useEffect(() => {
    window.electronAPI
      .loadAiSettings()
      .then((settings) => {
        setAiSettings(settings);
        setAiForm({
          ...withDefaultAiRuntimeOptions(settings),
          apiKey: ''
        });
        setAiBalance(null);
      })
      .catch((error) => {
        setStatusMessage(`读取 AI 设置失败：${String(error)}`);
      });
  }, [setStatusMessage]);

  const handleProviderChange = useCallback((provider: AiProviderId): void => {
    setAiBalance(null);
    if (provider === 'custom') {
      setAiForm((value) => ({ ...value, provider }));
      return;
    }

    const preset = AI_PROVIDER_PRESETS[provider];
    setAiForm((value) => ({
      ...value,
      ...withDefaultAiRuntimeOptions({
        provider,
        baseURL: preset.baseURL,
        model: preset.model
      })
    }));
  }, []);

  const handleAiFormChange = useCallback((patch: Partial<AiFormState>): void => {
    if (
      patch.provider ||
      patch.baseURL ||
      patch.model ||
      patch.apiKey ||
      patch.thinkingMode ||
      patch.reasoningEffort ||
      patch.temperature !== undefined ||
      patch.topP !== undefined ||
      patch.maxTokens !== undefined
    ) {
      setAiBalance(null);
    }
    setAiForm((value) => {
      const next = { ...value, ...patch };
      if (patch.provider || patch.model || patch.thinkingMode) {
        const nextDefaults = withDefaultAiRuntimeOptions({
          ...next,
          temperature: undefined,
          topP: undefined
        });
        return {
          ...next,
          ...nextDefaults,
          apiKey: next.apiKey
        };
      }
      return next;
    });
  }, []);

  const handleSaveAiSettings = useCallback(async (): Promise<void> => {
    try {
      setIsAiBusy(true);
      const settings = await window.electronAPI.saveAiSettings(aiForm);
      setAiSettings(settings);
      setAiBalance(null);
      setAiForm({
        ...withDefaultAiRuntimeOptions(settings),
        apiKey: ''
      });
      setStatusMessage('AI 设置已保存。');
    } catch (error) {
      setStatusMessage(`保存 AI 设置失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }, [aiForm, setStatusMessage]);

  const handleTestAiConnection = useCallback(async (): Promise<void> => {
    try {
      setIsAiBusy(true);
      setStatusMessage('正在测试 AI 连接...');
      const result = await window.electronAPI.testAiConnection();
      setStatusMessage(result.ok ? `AI 连接成功：${result.message}` : `AI 连接失败：${result.message}`);
    } catch (error) {
      setStatusMessage(`AI 连接测试失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }, [setStatusMessage]);

  const handleRefreshAiBalance = useCallback(async (): Promise<void> => {
    try {
      setIsAiBusy(true);
      setStatusMessage('正在查询 API 余额...');
      const balance = await window.electronAPI.getAiBalance();
      setAiBalance(balance);
      setStatusMessage(balance.supported ? `API 余额：${balance.message}` : balance.message);
    } catch (error) {
      setStatusMessage(`API 余额查询失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }, [setStatusMessage]);

  const handleRefreshAiModels = useCallback(async (): Promise<void> => {
    try {
      setIsAiBusy(true);
      setStatusMessage('正在刷新当前 Provider 的模型列表...');
      const result = await window.electronAPI.getAiModels();
      if (result.supported && result.provider !== 'custom') {
        const provider = result.provider as BuiltInProviderId;
        setRuntimeModelOptions((value) => ({
          ...value,
          [provider]: mergeAiModelOptions(
            AI_PROVIDER_MODEL_OPTIONS[provider],
            result.options,
            aiForm.model
          )
        }));
      }
      setStatusMessage(result.message);
    } catch (error) {
      setStatusMessage(`模型列表刷新失败：${String(error)}`);
    } finally {
      setIsAiBusy(false);
    }
  }, [aiForm.model, setStatusMessage]);

  const modelOptions = useMemo(
    () => getModelOptionsForProvider(aiForm.provider, runtimeModelOptions),
    [aiForm.provider, runtimeModelOptions]
  );

  return {
    aiSettings,
    aiBalance,
    aiForm,
    setAiForm,
    isAiBusy,
    setIsAiBusy,
    runtimeModelOptions,
    modelOptions,
    handleProviderChange,
    handleAiFormChange,
    handleSaveAiSettings,
    handleTestAiConnection,
    handleRefreshAiBalance,
    handleRefreshAiModels
  };
}
