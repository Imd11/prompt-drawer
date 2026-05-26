import { useEffect, useRef, useState } from "react";
import { getFrontmostApp, getCurrentInputTarget, showPromptButton, hidePromptButton, showPromptPopover, hidePromptPopover } from "../platform/platformApi";
import type { FrontmostApp } from "../platform/platformApi";

interface InputTarget {
  frame: { x: number; y: number; width: number; height: number };
  window_frame: { x: number; y: number; width: number; height: number };
  button_position: [number, number];
  app: FrontmostApp | null;
}

type OverlayPlacement = {
  buttonOffset: { x: number; y: number } | null;
};

export function useInputTargetPolling(
  blacklist: string[] = [],
  overlayPlacement: OverlayPlacement = { buttonOffset: null }
) {
  const [target, setTarget] = useState<InputTarget | null>(null);
  const [showAttached, setShowAttached] = useState(false);
  const lastTargetAppRef = useRef<FrontmostApp | null>(null);
  const lastButtonPositionRef = useRef<[number, number] | null>(null);
  const lastTargetAtRef = useRef(0);
  const pollingRef = useRef<boolean>(true);

  useEffect(() => {
    const poll = async () => {
      if (!pollingRef.current) return;

      try {
        const app = await getFrontmostApp();

        if (app && blacklist.includes(app.bundle_id)) {
          setShowAttached(false);
          await hidePromptButton();
          await hidePromptPopover();
          return;
        }

        const inputTarget = await getCurrentInputTarget() as InputTarget | null;

        if (inputTarget && app) {
          setTarget(inputTarget);
          setShowAttached(true);
          lastTargetAppRef.current = inputTarget.app;
          const [x, y] = inputTarget.button_position;
          const offset = overlayPlacement.buttonOffset;
          const displayX = offset ? x + offset.x : x;
          const displayY = offset ? y + offset.y : y;
          lastButtonPositionRef.current = [displayX, displayY];
          lastTargetAtRef.current = Date.now();
          await showPromptButton(displayX, displayY);
        } else if (app && app.name === "Prompt Picker" && lastTargetAtRef.current > 0 && lastButtonPositionRef.current) {
          // Grace period during overlay self-interaction
          const recentlyHadTarget = Date.now() - lastTargetAtRef.current < 3000;
          if (recentlyHadTarget) {
            const [x, y] = lastButtonPositionRef.current;
            await showPromptButton(x, y);
            setTimeout(poll, 500 + Math.random() * 500);
            return;
          }
          setTarget(null);
          setShowAttached(false);
          await hidePromptButton();
        } else {
          setTarget(null);
          setShowAttached(false);
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
  }, [blacklist, overlayPlacement]);

  const openPopover = async () => {
    if (target) {
      const [x, y] = target.button_position;
      await showPromptPopover(x + 40, y);
    }
  };

  return { showAttached, openPopover, lastTargetApp: lastTargetAppRef.current };
}