import { useCallback, useMemo, useRef, useState } from "react";

export function useDebouncedCallback<T extends (...args: any[]) => void>(callback: T, delay = 300) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callback(...args), delay);
    },
    [callback, delay],
  );
}

export function useUndoRedo<T>(initialValue: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState(initialValue);
  const [future, setFuture] = useState<T[]>([]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const set = useCallback((next: T) => {
    setPast((previousPast) => [...previousPast, present]);
    setPresent(next);
    setFuture([]);
  }, [present]);

  const undo = useCallback(() => {
    setPast((previousPast) => {
      const previous = previousPast.at(-1);
      if (previous === undefined) return previousPast;
      setFuture((previousFuture) => [present, ...previousFuture]);
      setPresent(previous);
      return previousPast.slice(0, -1);
    });
  }, [present]);

  const redo = useCallback(() => {
    setFuture((previousFuture) => {
      const next = previousFuture[0];
      if (next === undefined) return previousFuture;
      setPast((previousPast) => [...previousPast, present]);
      setPresent(next);
      return previousFuture.slice(1);
    });
  }, [present]);

  return useMemo(() => ({ present, set, undo, redo, canUndo, canRedo }), [present, set, undo, redo, canUndo, canRedo]);
}
