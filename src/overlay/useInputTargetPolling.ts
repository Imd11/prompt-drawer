import { useEffect, useRef, useState } from "react";
import { getFrontmostApp, getCurrentInputTarget, showPromptButton, hidePromptButton, showPromptPopover, hidePromptPopover } from "../platform/platformApi";
import type { FrontmostApp } from "../platform/platformApi";

interface InputTarget {
  frame: { x: number; y: number; width: number; height: number };
  button_position: [number, number];
  app: FrontmostApp | null;
}

export function useInputTargetPolling(blacklist: string[] = []) {
  const [target, setTarget] = useState<InputTarget | null>(null);
  const [showAttached, setShowAttached] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const pollingRef = useRef<boolean>(true);

  useEffect(() => {
    const poll = async () => {
      if (!pollingRef.current) return;

      try {
        const app = await getFrontmostApp();

        if (app && blacklist.includes(app.bundle_id)) {
          setShowAttached(false);
          setShowFallback(false);
          await hidePromptButton();
          await hidePromptPopover();
          return;
        }

        const inputTarget = await getCurrentInputTarget() as InputTarget | null;

        if (inputTarget && app) {
          setTarget(inputTarget);
          setShowAttached(true);
          setShowFallback(false);
          const [x, y] = inputTarget.button_position;
          await showPromptButton(x, y);
        } else {
          setTarget(null);
          setShowAttached(false);
          setShowFallback(true);
          await hidePromptButton();
        }
      } catch (e) {
        console.error("Polling error:", e);
      }

      if (pollingRef.current) {
        setTimeout(poll, 500 + Math.random() * 500);
      }
    };

    poll();

    return () => {
      pollingRef.current = false;
    };
  }, [blacklist]);

  const openPopover = async () => {
    if (target) {
      const [x, y] = target.button_position;
      await showPromptPopover(x + 40, y);
    } else {
      await showPromptPopover(100, 100);
    }
  };

  return { showAttached, showFallback, openPopover };
}