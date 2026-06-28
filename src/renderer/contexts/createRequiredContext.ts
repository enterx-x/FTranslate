import { createContext, useContext } from 'react';

export function createRequiredContext<T>(name: string) {
  const Context = createContext<T | null>(null);

  function useRequiredContext(): T {
    const value = useContext(Context);
    if (!value) {
      throw new Error(`${name} must be used within ${name}.Provider`);
    }
    return value;
  }

  return [Context.Provider, useRequiredContext] as const;
}
