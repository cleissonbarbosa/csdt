/** Transient status messages shown in a polite live region. */
import { create } from 'zustand';

/** Something a notice offers to do about what it says. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: number;
  tone: 'info' | 'error';
  message: string;
  action?: NoticeAction;
}

interface NoticeState {
  notices: Notice[];
  push: (tone: Notice['tone'], message: string, action?: NoticeAction) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const LIFETIME_MS = 6000;
/** A notice that offers something stays long enough to be taken up on it. */
const ACTION_LIFETIME_MS = 14_000;

export const useNotices = create<NoticeState>((set) => ({
  notices: [],
  push: (tone, message, action) => {
    const id = nextId++;
    set((state) => ({
      notices: [...state.notices.slice(-3), { id, tone, message, ...(action ? { action } : {}) }],
    }));
    setTimeout(
      () => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
      action ? ACTION_LIFETIME_MS : LIFETIME_MS,
    );
  },
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
}));
