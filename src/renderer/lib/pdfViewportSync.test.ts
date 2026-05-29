import { describe, expect, it } from 'vitest';
import { buildPdfScrollPosition, buildPdfViewportState } from './pdfViewportSync';

describe('pdf viewport synchronization', () => {
  it('converts scroll offsets to stable ratios and back to another viewer size', () => {
    const state = buildPdfViewportState({
      scrollTop: 500,
      scrollLeft: 100,
      scrollHeight: 2000,
      scrollWidth: 1000,
      clientHeight: 1000,
      clientWidth: 500
    }, 'left');

    expect(state).toEqual({
      topRatio: 0.5,
      leftRatio: 0.2,
      source: 'left'
    });

    expect(buildPdfScrollPosition(state, {
      scrollHeight: 3000,
      scrollWidth: 1500,
      clientHeight: 1000,
      clientWidth: 500
    })).toEqual({
      scrollTop: 1000,
      scrollLeft: 200
    });
  });

  it('clamps invalid or out-of-range scroll ratios', () => {
    expect(buildPdfViewportState({
      scrollTop: 500,
      scrollLeft: 50,
      scrollHeight: 400,
      scrollWidth: 200,
      clientHeight: 400,
      clientWidth: 200
    })).toEqual({
      topRatio: 0,
      leftRatio: 0,
      source: undefined
    });

    expect(buildPdfScrollPosition({ topRatio: 2, leftRatio: -1 }, {
      scrollHeight: 500,
      scrollWidth: 500,
      clientHeight: 100,
      clientWidth: 100
    })).toEqual({
      scrollTop: 400,
      scrollLeft: 0
    });
  });
});
