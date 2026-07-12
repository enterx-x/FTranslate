import { describe, expect, it } from 'vitest';
import { createArxivSearchSessionController, tryBeginArxivSearchSession } from './arxivSearchSession';

describe('createArxivSearchSessionController', () => {
  it('issues monotonically increasing sessions and only accepts the current session', () => {
    const controller = createArxivSearchSessionController();

    expect(controller.current()).toBeNull();

    const firstSession = controller.begin();
    const secondSession = controller.begin();

    expect(Number.isSafeInteger(firstSession)).toBe(true);
    expect(secondSession).toBe(firstSession + 1);
    expect(controller.current()).toBe(secondSession);
    expect(controller.isCurrent(firstSession)).toBe(false);
    expect(controller.isCurrent(secondSession)).toBe(true);
  });

  it('leaves a current request active when an invalid search is rejected', () => {
    const controller = createArxivSearchSessionController();
    const activeSession = controller.begin();

    expect(tryBeginArxivSearchSession(controller, false)).toBeNull();
    expect(controller.current()).toBe(activeSession);
    expect(controller.isCurrent(activeSession)).toBe(true);
  });
});
