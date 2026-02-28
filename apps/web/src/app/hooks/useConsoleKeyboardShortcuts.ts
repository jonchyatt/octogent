import { useEffect } from "react";
import type { RefObject } from "react";

import type { PrimaryNavIndex } from "../constants";
import { isEditableEventTarget, parsePrimaryNavKey } from "../hotkeys";

type UseConsoleKeyboardShortcutsOptions = {
  setActivePrimaryNav: (index: PrimaryNavIndex) => void;
  tickerInputRef: RefObject<HTMLInputElement | null>;
};

export const useConsoleKeyboardShortcuts = ({
  setActivePrimaryNav,
  tickerInputRef,
}: UseConsoleKeyboardShortcutsOptions) => {
  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }

      const nextPrimaryNav = parsePrimaryNavKey(event.key);
      if (nextPrimaryNav !== null) {
        setActivePrimaryNav(nextPrimaryNav);
        event.preventDefault();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        tickerInputRef.current?.focus();
        tickerInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [setActivePrimaryNav, tickerInputRef]);
};
