import { describe, expect, it } from 'vitest';
import {
  buildDefaultAppSettings,
  describeReferenceStrategy,
  parseAppSettings,
  serializeAppSettings,
  updateExportPath
} from './appSettings';

describe('app settings', () => {
  it('keeps backward compatibility when stored settings are incomplete', () => {
    const settings = parseAppSettings(
      JSON.stringify({
        exportPaths: {
          bilingualPdfExportPath: 'D:/exports/bilingual'
        },
        layout: {
          aiAssistantMainRatio: 0.95
        }
      })
    );

    expect(settings.exportPaths.bilingualPdfExportPath).toBe('D:/exports/bilingual');
    expect(settings.exportPaths.askBeforeExport).toBe(true);
    expect(settings.pdf.referenceTranslationStrategy).toBe('keep-original');
    expect(settings.layout.aiAssistantMainRatio).toBe(0.78);
  });

  it('serializes updated export paths without dropping other categories', () => {
    const settings = updateExportPath(
      buildDefaultAppSettings(),
      'knowledgeGraphJsonExportPath',
      'D:/graph/json'
    );
    const restored = parseAppSettings(serializeAppSettings(settings));

    expect(restored.knowledgeGraph.defaultMaxNodes).toBe(80);
    expect(restored.exportPaths.knowledgeGraphJsonExportPath).toBe('D:/graph/json');
  });

  it('describes reference translation strategy as a stable formatting safeguard', () => {
    expect(describeReferenceStrategy('keep-original')).toContain('保持参考文献原文');
    expect(describeReferenceStrategy('skip')).toContain('跳过参考文献翻译');
  });
});
