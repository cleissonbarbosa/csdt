/**
 * The guide: the first-visit orientation and the challenges.
 *
 * What is remembered across visits is small: that the orientation has been
 * used or dismissed, and which challenges were solved. Kept apart from the
 * settings so that resetting those does not bring the orientation back.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Basis } from '@/lib/report';

/** One line of feedback, with the kind of statement it is when it has one. */
export interface FeedbackLine {
  basis?: Basis | 'observed' | 'cedar';
  text: string;
}

export interface Feedback {
  correct: boolean;
  headline: string;
  lines: FeedbackLine[];
}

export interface GuideState {
  /** The orientation has been used or dismissed; it does not come again. */
  oriented: boolean;
  /** Ids of the challenges solved. */
  completed: string[];
  /** Whether the guide card is on screen. */
  open: boolean;
  /** The challenge under way. */
  activeId: string | null;
  feedback: Feedback | null;

  setOriented: () => void;
  setOpen: (open: boolean) => void;
  begin: (id: string) => void;
  /** Back to the list of challenges. */
  leave: () => void;
  answer: (feedback: Feedback) => void;
}

export const useGuide = create<GuideState>()(
  persist(
    (set) => ({
      oriented: false,
      completed: [],
      open: false,
      activeId: null,
      feedback: null,

      setOriented: () => set({ oriented: true }),
      // Closing the card ends the challenge; opening it also counts as
      // having found one's way in.
      setOpen: (open) =>
        set(open ? { open, oriented: true } : { open, activeId: null, feedback: null }),
      begin: (activeId) => set({ activeId, feedback: null, open: true, oriented: true }),
      leave: () => set({ activeId: null, feedback: null }),
      answer: (feedback) =>
        set((state) => ({
          feedback,
          completed:
            feedback.correct && state.activeId && !state.completed.includes(state.activeId)
              ? [...state.completed, state.activeId]
              : state.completed,
        })),
    }),
    {
      name: 'aegis.guide.v1',
      version: 1,
      partialize: (state) => ({ oriented: state.oriented, completed: state.completed }),
    },
  ),
);
