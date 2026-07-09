import { useEffect, useRef, useState } from 'react';

export function buildAppMainClassName(extraClassName = '', isTransitioning = false): string {
  return ['app-main', extraClassName, isTransitioning ? 'is-view-transitioning' : '']
    .filter(Boolean)
    .join(' ');
}

export function useViewTransition<TView>(view: TView, durationMs = 260) {
  const [isViewTransitioning, setIsViewTransitioning] = useState(false);
  const previousViewRef = useRef(view);

  useEffect(() => {
    if (previousViewRef.current === view) {
      return;
    }

    previousViewRef.current = view;
    setIsViewTransitioning(true);
    const timeout = window.setTimeout(() => {
      setIsViewTransitioning(false);
    }, durationMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [durationMs, view]);

  const getAppMainClassName = (extraClassName = '') =>
    buildAppMainClassName(extraClassName, isViewTransitioning);

  return {
    isViewTransitioning,
    getAppMainClassName
  };
}
