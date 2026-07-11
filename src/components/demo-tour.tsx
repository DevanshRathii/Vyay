"use client";

import { useCallback, useRef } from "react";
import { driver } from "driver.js";
import { signIn } from "next-auth/react";
import "driver.js/dist/driver.css";

interface TourStep {
  page: string;
  /** CSS selector to highlight, or null for a centered popover (the final step). */
  selector: string | null;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    page: "/",
    selector: '[data-tour="overview-stats"]',
    title: "Overview",
    description:
      "Total spent, received, and net for the selected date range, plus where the money went by category, merchant, and channel.",
  },
  {
    page: "/ledger",
    selector: '[data-tour="ledger-search"]',
    title: "Ledger",
    description:
      "Every parsed transaction, searchable and filterable by category, channel, and direction. Tap a row to open it, change its category, add a note, or delete/restore it.",
  },
  {
    page: "/categories",
    selector: '[data-tour="categories-list"]',
    title: "Categories",
    description:
      "Built-in categories cover most spending automatically. You can also add your own merchant rules — \"if merchant contains X, use category Y\" — and apply them retroactively.",
  },
  {
    page: "/matches",
    selector: '[data-tour="matches-list"]',
    title: "Matches",
    description:
      "Log a cash or card expense from your phone with the Apple Shortcut, and Vyay pairs it with the matching bank email automatically. When more than one transaction could match, you pick the right one here.",
  },
  {
    page: "/settings",
    selector: '[data-tour="settings-gmail"]',
    title: "Settings",
    description:
      "Connect the Gmail account that receives your bank alerts — read-only access, encrypted tokens, nothing is ever sent or deleted. This is also where you export to Excel and manage Apple Shortcut tokens.",
  },
  {
    page: "/settings",
    selector: '[data-tour="urgent-feedback"]',
    title: "Stuck on something?",
    description:
      "Any signed-in user can flag a blocking bug from here — it goes straight to Devansh, no support ticket needed.",
  },
  {
    page: "/settings",
    selector: null,
    title: "Ready to see your own money?",
    description: "This was sample data. Sign in with Google to connect your real Gmail and build your own ledger.",
  },
];

/** Poll via rAF for the next step's target element to exist (SWR data + React render need a tick). */
function waitForElement(selector: string | null, cb: () => void, attempt = 0) {
  if (!selector || document.querySelector(selector) || attempt > 15) {
    cb();
    return;
  }
  requestAnimationFrame(() => waitForElement(selector, cb, attempt + 1));
}

/**
 * Drives a driver.js tour across DemoShell's virtual "pages". Each step gets
 * its own fresh driver.js instance (rather than one multi-step `.drive()`
 * call) so page switches — which are async React state updates, not real
 * navigation — always land before the next element is highlighted.
 */
export function useDemoTour(page: string, setPage: (p: string) => void) {
  const activeRef = useRef<ReturnType<typeof driver> | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  const showStep = useCallback(
    (index: number) => {
      activeRef.current?.destroy();
      if (index < 0 || index >= TOUR_STEPS.length) return;
      const step = TOUR_STEPS[index];

      const begin = () => {
        waitForElement(step.selector, () => {
          const isFirst = index === 0;
          const isLast = index === TOUR_STEPS.length - 1;
          const d = driver({
            showProgress: true,
            progressText: `${index + 1} / ${TOUR_STEPS.length}`,
            allowClose: true,
            overlayOpacity: 0.55,
            popoverClass: "vyay-tour-popover",
            steps: [
              {
                element: step.selector ?? undefined,
                popover: {
                  title: step.title,
                  description: step.description,
                  showButtons: isFirst ? ["next", "close"] : ["next", "previous", "close"],
                  nextBtnText: isLast ? "Sign in with Google" : "Next",
                  onNextClick: () => {
                    if (isLast) {
                      d.destroy();
                      signIn("google", { callbackUrl: "/" });
                    } else {
                      // Deferred: driver.js runs its own post-click cleanup
                      // (this instance has no next step, so it self-destroys)
                      // right after this handler returns. Creating the next
                      // instance synchronously here races that cleanup and
                      // can get the new instance destroyed too — defer a
                      // tick so driver.js finishes tearing down first.
                      setTimeout(() => showStep(index + 1), 0);
                    }
                  },
                  onPrevClick: () => setTimeout(() => showStep(index - 1), 0),
                  onCloseClick: () => d.destroy(),
                },
              },
            ],
          });
          activeRef.current = d;
          d.drive();
        });
      };

      if (pageRef.current !== step.page) {
        setPage(step.page);
        requestAnimationFrame(begin);
      } else {
        begin();
      }
    },
    [setPage],
  );

  const start = useCallback(() => showStep(0), [showStep]);
  const stop = useCallback(() => activeRef.current?.destroy(), []);

  return { start, stop };
}
