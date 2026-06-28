import { describe, expect, it } from 'vitest';
import { appendStatusMessage } from './useStatusQueue';

describe('appendStatusMessage', () => {
  it('keeps the latest messages in insertion order', () => {
    const first = appendStatusMessage([], '保存成功', 1, 3);
    const second = appendStatusMessage(first, '正在翻译...', 2, 3);
    const third = appendStatusMessage(second, '翻译完成', 3, 3);
    const fourth = appendStatusMessage(third, '已导出 PDF', 4, 3);

    expect(fourth.map((item) => item.text)).toEqual(['正在翻译...', '翻译完成', '已导出 PDF']);
    expect(fourth.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it('ignores empty messages', () => {
    const queue = appendStatusMessage([{ id: 1, text: '已有消息' }], '   ', 2, 3);

    expect(queue).toEqual([{ id: 1, text: '已有消息' }]);
  });
});
