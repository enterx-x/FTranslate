import { useMemo, useState, type ReactNode } from 'react';
import settingsIcon from '../assets/icons/duotone/settings.svg';
import saveIcon from '../assets/icons/duotone/save.svg';
import refreshIcon from '../assets/icons/duotone/refresh.svg';
import folderIcon from '../assets/icons/duotone/download.svg';
import {
  APP_SETTINGS_KEY,
  buildDefaultAppSettings,
  describeReferenceStrategy,
  parseAppSettings,
  serializeAppSettings,
  updateExportPath,
  type AppSettings,
  type ExportPathSettings,
  type ReferenceTranslationStrategy
} from '../lib/appSettings';

type SettingsCategory =
  | 'general'
  | 'pdf'
  | 'ai'
  | 'web'
  | 'sheet'
  | 'notes'
  | 'graph'
  | 'export'
  | 'data';

interface SettingsPageProps {
  onBackHome: () => void;
  onOpenAiAssistant: () => void;
}

const categories: Array<{ id: SettingsCategory; title: string; caption: string }> = [
  { id: 'general', title: '通用设置', caption: '主题、缩放、首页和自动保存' },
  { id: 'pdf', title: 'PDF 阅读设置', caption: '阅读模式、缩放、参考文献策略' },
  { id: 'ai', title: 'AI 设置', caption: 'Provider、模型和高级参数入口' },
  { id: 'web', title: '联网查新设置', caption: '查新范围和引用格式' },
  { id: 'sheet', title: '研究表格设置', caption: '公式、行高、预览和缩放' },
  { id: 'notes', title: '笔记设置', caption: 'Markdown、公式和自动关联' },
  { id: 'graph', title: '知识图谱设置', caption: '默认来源、节点和标签策略' },
  { id: 'export', title: '导出与路径', caption: 'PDF、双语 PDF、图谱和笔记路径' },
  { id: 'data', title: '数据与缓存', caption: '本地存储、缓存和危险操作' }
];

const exportPathFields: Array<{ key: keyof ExportPathSettings; label: string; hint: string }> = [
  { key: 'defaultExportPath', label: '默认导出路径', hint: '未指定时使用系统保存对话框' },
  { key: 'pdfExportPath', label: 'PDF 导出路径', hint: '原文 PDF 或副本导出目录' },
  { key: 'bilingualPdfExportPath', label: '双语 PDF 导出路径', hint: 'PDFMathTranslate 输出或手动导出的目录' },
  { key: 'translationJsonExportPath', label: '翻译 JSON 导出路径', hint: 'AI 缓存和段落译文 JSON' },
  { key: 'knowledgeGraphImageExportPath', label: '知识图谱图片导出路径', hint: 'SVG/PNG 图谱图片' },
  { key: 'knowledgeGraphJsonExportPath', label: '知识图谱 JSON 导出路径', hint: '图谱节点和边数据' },
  { key: 'notesExportPath', label: '笔记导出路径', hint: 'Markdown/文本笔记导出目录' },
  { key: 'researchSheetExportPath', label: '研究表格导出路径', hint: 'Excel 工作簿导出目录' }
];

export function SettingsPage(props: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('export');
  const [settings, setSettings] = useState<AppSettings>(() =>
    parseAppSettings(localStorage.getItem(APP_SETTINGS_KEY))
  );
  const [savedMessage, setSavedMessage] = useState('');
  const localStorageUsage = useMemo(() => calculateLocalStorageUsage(), [savedMessage]);

  function saveSettings(nextSettings = settings): void {
    localStorage.setItem(APP_SETTINGS_KEY, serializeAppSettings(nextSettings));
    setSavedMessage(`已保存设置 · ${new Date().toLocaleTimeString()}`);
  }

  function updateSettings(updater: (value: AppSettings) => AppSettings): void {
    setSettings((current) => {
      const next = updater(current);
      localStorage.setItem(APP_SETTINGS_KEY, serializeAppSettings(next));
      setSavedMessage('已自动保存');
      return next;
    });
  }

  function resetSettings(): void {
    const defaults = buildDefaultAppSettings();
    setSettings(defaults);
    saveSettings(defaults);
  }

  return (
    <main className="settings-page">
      <header className="settings-header">
        <div className="page-title-block">
          <img className="panel-title-icon" src={settingsIcon} alt="" />
          <div>
            <span className="eyebrow">Settings</span>
            <h1>设置</h1>
            <p>集中管理导出路径、PDF 阅读、AI 参数、研究表格、笔记和知识图谱偏好。</p>
          </div>
        </div>
        <div className="page-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={props.onOpenAiAssistant}>
            <img className="button-icon" src={settingsIcon} alt="" />
            <span>AI 助手配置</span>
          </button>
          <button type="button" className="primary-button button-with-icon" onClick={() => saveSettings()}>
            <img className="button-icon" src={saveIcon} alt="" />
            <span>保存设置</span>
          </button>
          <button type="button" className="secondary-button" onClick={props.onBackHome}>
            返回工作台
          </button>
        </div>
      </header>

      <section className="settings-layout">
        <aside className="settings-nav" aria-label="设置分类">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activeCategory === category.id ? 'active' : ''}
              onClick={() => setActiveCategory(category.id)}
            >
              <strong>{category.title}</strong>
              <span>{category.caption}</span>
            </button>
          ))}
        </aside>

        <section className="settings-content">
          {activeCategory === 'export' ? (
            <SettingsCard
              title="导出与路径"
              badge="本机 localStorage"
              description="第一版先保存路径偏好；导出时仍会兼容现有保存对话框。后续可接入系统目录选择器。"
            >
              <div className="settings-path-grid">
                {exportPathFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <div className="path-input-row">
                      <input
                        value={String(settings.exportPaths[field.key] ?? '')}
                        placeholder="例如 D:\\FTranslate\\exports"
                        onChange={(event) =>
                          updateSettings((current) =>
                            updateExportPath(current, field.key, event.target.value)
                          )
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        title="目录选择器 TODO：后续接入 Electron dialog"
                        aria-label="选择目录"
                        disabled
                      >
                        <img className="button-icon" src={folderIcon} alt="" />
                      </button>
                    </div>
                    <small>{field.hint}</small>
                  </label>
                ))}
              </div>
              <div className="settings-toggle-grid">
                <CheckboxSetting
                  label="每次导出前询问路径"
                  checked={settings.exportPaths.askBeforeExport}
                  onChange={(checked) =>
                    updateSettings((current) => updateExportPath(current, 'askBeforeExport', checked))
                  }
                />
                <CheckboxSetting
                  label="按论文标题自动创建文件夹"
                  checked={settings.exportPaths.createFolderByPaperTitle}
                  onChange={(checked) =>
                    updateSettings((current) => updateExportPath(current, 'createFolderByPaperTitle', checked))
                  }
                />
                <CheckboxSetting
                  label="按日期创建子文件夹"
                  checked={settings.exportPaths.createDateSubfolder}
                  onChange={(checked) =>
                    updateSettings((current) => updateExportPath(current, 'createDateSubfolder', checked))
                  }
                />
              </div>
            </SettingsCard>
          ) : null}

          {activeCategory === 'pdf' ? (
            <SettingsCard
              title="PDF 阅读与翻译"
              badge="参考文献默认保持原文"
              description="这些设置只影响后续默认偏好，不会改变已经生成的 PDF 或现有论文记录。"
            >
              <div className="settings-form-grid">
                <label>
                  默认阅读模式
                  <select
                    value={settings.pdf.defaultMode}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        pdf: { ...current.pdf, defaultMode: event.target.value as AppSettings['pdf']['defaultMode'] }
                      }))
                    }
                  >
                    <option value="source">原文 PDF</option>
                    <option value="parallel">左右双语</option>
                    <option value="translated">双语 PDF</option>
                  </select>
                </label>
                <label>
                  默认缩放比例
                  <input
                    type="number"
                    min="0.35"
                    max="2.4"
                    step="0.05"
                    value={settings.pdf.defaultScale}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        pdf: { ...current.pdf, defaultScale: Number(event.target.value) || 1 }
                      }))
                    }
                  />
                </label>
                <label>
                  参考文献翻译策略
                  <select
                    value={settings.pdf.referenceTranslationStrategy}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        pdf: {
                          ...current.pdf,
                          referenceTranslationStrategy: event.target.value as ReferenceTranslationStrategy
                        }
                      }))
                    }
                  >
                    <option value="keep-original">保持参考文献原文</option>
                    <option value="translate-title">只翻译参考文献标题</option>
                    <option value="skip">跳过参考文献翻译</option>
                  </select>
                </label>
                <label>
                  PDFMathTranslate 路径
                  <input
                    value={settings.pdf.pdfMathTranslatePath}
                    placeholder="留空则自动检测 uv / pdf2zh"
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        pdf: { ...current.pdf, pdfMathTranslatePath: event.target.value }
                      }))
                    }
                  />
                </label>
              </div>
              <p className="inline-message">{describeReferenceStrategy(settings.pdf.referenceTranslationStrategy)}</p>
            </SettingsCard>
          ) : null}

          {activeCategory === 'sheet' ? (
            <SettingsCard title="研究表格设置" badge="公式帮助已折叠" description="表格本体仍由 Univer 管理，这里只保存默认偏好。">
              <div className="settings-form-grid">
                <label>
                  默认字号
                  <input
                    type="number"
                    min="8"
                    max="32"
                    value={settings.researchSheet.defaultFontSize}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        researchSheet: { ...current.researchSheet, defaultFontSize: Number(event.target.value) || 12 }
                      }))
                    }
                  />
                </label>
                <label>
                  默认行高
                  <input
                    type="number"
                    min="20"
                    max="120"
                    value={settings.researchSheet.defaultRowHeight}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        researchSheet: { ...current.researchSheet, defaultRowHeight: Number(event.target.value) || 28 }
                      }))
                    }
                  />
                </label>
                <label>
                  公式渲染模式
                  <select
                    value={settings.researchSheet.formulaRenderMode}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        researchSheet: {
                          ...current.researchSheet,
                          formulaRenderMode: event.target.value as AppSettings['researchSheet']['formulaRenderMode']
                        }
                      }))
                    }
                  >
                    <option value="blur-preview">失焦/预览渲染</option>
                    <option value="preview-only">只在预览渲染</option>
                    <option value="source">始终显示源码</option>
                  </select>
                </label>
              </div>
              <div className="settings-toggle-grid">
                <CheckboxSetting
                  label="启用公式渲染"
                  checked={settings.researchSheet.formulaRenderEnabled}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      researchSheet: { ...current.researchSheet, formulaRenderEnabled: checked }
                    }))
                  }
                />
                <CheckboxSetting
                  label="启用单元格预览面板"
                  checked={settings.researchSheet.enableCellPreview}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      researchSheet: { ...current.researchSheet, enableCellPreview: checked }
                    }))
                  }
                />
              </div>
            </SettingsCard>
          ) : null}

          {activeCategory === 'graph' ? (
            <SettingsCard title="知识图谱设置" badge="默认 80 节点" description="图谱页面会优先使用这些默认展示偏好。">
              <div className="settings-form-grid">
                <label>
                  默认数据来源
                  <select
                    value={settings.knowledgeGraph.defaultSource}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        knowledgeGraph: {
                          ...current.knowledgeGraph,
                          defaultSource: event.target.value as AppSettings['knowledgeGraph']['defaultSource']
                        }
                      }))
                    }
                  >
                    <option value="merged">研究表格 + 论文库</option>
                    <option value="workbook">研究表格</option>
                    <option value="library">论文库</option>
                  </select>
                </label>
                <label>
                  默认最大节点数
                  <input
                    type="number"
                    min="30"
                    max="200"
                    value={settings.knowledgeGraph.defaultMaxNodes}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        knowledgeGraph: { ...current.knowledgeGraph, defaultMaxNodes: Number(event.target.value) || 80 }
                      }))
                    }
                  />
                </label>
                <label>
                  标签显示策略
                  <select
                    value={settings.knowledgeGraph.labelStrategy}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        knowledgeGraph: {
                          ...current.knowledgeGraph,
                          labelStrategy: event.target.value as AppSettings['knowledgeGraph']['labelStrategy']
                        }
                      }))
                    }
                  >
                    <option value="core">核心节点</option>
                    <option value="hover">选中和悬停邻居</option>
                    <option value="all">全部显示</option>
                  </select>
                </label>
              </div>
              <div className="settings-toggle-grid">
                <CheckboxSetting
                  label="启用神经元式布局"
                  checked={settings.knowledgeGraph.neuronLayout}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      knowledgeGraph: { ...current.knowledgeGraph, neuronLayout: checked }
                    }))
                  }
                />
                <CheckboxSetting
                  label="显示作者节点"
                  checked={settings.knowledgeGraph.showAuthorNodes}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      knowledgeGraph: { ...current.knowledgeGraph, showAuthorNodes: checked }
                    }))
                  }
                />
              </div>
            </SettingsCard>
          ) : null}

          {activeCategory === 'notes' ? (
            <SettingsCard title="笔记设置" badge="Markdown + 公式" description="笔记编辑区支持源码/预览，预览使用 Markdown 和 KaTeX 渲染。">
              <div className="settings-toggle-grid">
                <CheckboxSetting
                  label="Markdown 预览"
                  checked={settings.notes.markdownPreview}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      notes: { ...current.notes, markdownPreview: checked }
                    }))
                  }
                />
                <CheckboxSetting
                  label="公式渲染"
                  checked={settings.notes.formulaRender}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      notes: { ...current.notes, formulaRender: checked }
                    }))
                  }
                />
                <CheckboxSetting
                  label="自动关联当前 PDF 页码"
                  checked={settings.notes.autoLinkPdfPage}
                  onChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      notes: { ...current.notes, autoLinkPdfPage: checked }
                    }))
                  }
                />
              </div>
            </SettingsCard>
          ) : null}

          {activeCategory === 'general' || activeCategory === 'ai' || activeCategory === 'web' || activeCategory === 'data' ? (
            <SettingsCard
              title={categories.find((category) => category.id === activeCategory)?.title ?? '设置'}
              badge={activeCategory === 'data' ? `${localStorageUsage} KB` : '兼容旧数据'}
              description="这部分先提供统一入口和摘要，具体 Provider、模型、余额和联网查新参数仍在 AI 助手中编辑。"
            >
              <div className="settings-summary-list">
                <p><strong>主题模式</strong><span>{settings.general.themeMode}</span></p>
                <p><strong>界面缩放</strong><span>{settings.general.uiScale}</span></p>
                <p><strong>自动保存</strong><span>{settings.general.autoSave ? '开启' : '关闭'}</span></p>
                <p><strong>AI 高级参数</strong><span>请在 AI 助手中编辑并测试连接</span></p>
              </div>
              <div className="settings-actions">
                <button type="button" className="secondary-button button-with-icon" onClick={props.onOpenAiAssistant}>
                  <img className="button-icon" src={settingsIcon} alt="" />
                  <span>前往 AI 助手</span>
                </button>
                <button type="button" className="danger-button button-with-icon" onClick={resetSettings}>
                  <img className="button-icon" src={refreshIcon} alt="" />
                  <span>重置 UI 设置</span>
                </button>
              </div>
            </SettingsCard>
          ) : null}

          <p className="settings-save-state">{savedMessage || '设置会保存到本机 localStorage，不影响现有论文库和研究表格数据。'}</p>
        </section>
      </section>
    </main>
  );
}

function SettingsCard(props: {
  title: string;
  badge: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-card">
      <header>
        <div>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
        </div>
        <span className="badge">{props.badge}</span>
      </header>
      {props.children}
    </section>
  );
}

function CheckboxSetting(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-line">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function calculateLocalStorageUsage(): number {
  let total = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    total += key.length + (localStorage.getItem(key)?.length ?? 0);
  }
  return Math.round(total / 1024);
}
