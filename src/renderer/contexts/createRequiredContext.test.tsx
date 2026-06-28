import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { createRequiredContext } from './createRequiredContext';

describe('createRequiredContext', () => {
  it('throws a clear error when a context consumer is rendered outside its provider', () => {
    const [, useExampleContext] = createRequiredContext<{ label: string }>('ExampleContext');

    function Consumer() {
      useExampleContext();
      return createElement('span', null, 'unreachable');
    }

    expect(() => renderToString(createElement(Consumer))).toThrow(
      'ExampleContext must be used within ExampleContext.Provider'
    );
  });

  it('returns the provider value to consumers', () => {
    const [ExampleProvider, useExampleContext] = createRequiredContext<{ label: string }>('ExampleContext');

    function Consumer() {
      const value = useExampleContext();
      return createElement('span', null, value.label);
    }

    expect(
      renderToString(
        createElement(
          ExampleProvider,
          { value: { label: 'ready' } },
          createElement(Consumer)
        )
      )
    ).toContain('ready');
  });
});
