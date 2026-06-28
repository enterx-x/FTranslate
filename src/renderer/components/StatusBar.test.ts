import { describe, expect, it } from 'vitest';
import { getVisibleStatusMessages } from './StatusBar';

describe('getVisibleStatusMessages', () => {
  it('uses the latest three queued messages before falling back to a single status text', () => {
    const messages = [
      { id: 1, text: '已打开 PDF' },
      { id: 2, text: '正在翻译' },
      { id: 3, text: '已保存缓存' },
      { id: 4, text: '导出完成' }
    ];

    expect(getVisibleStatusMessages('备用消息', messages).map((item) => item.text)).toEqual([
      '正在翻译',
      '已保存缓存',
      '导出完成'
    ]);
    expect(getVisibleStatusMessages('备用消息', [])).toEqual([
      { id: 'fallback-status-message', text: '备用消息' }
    ]);
  });
});
