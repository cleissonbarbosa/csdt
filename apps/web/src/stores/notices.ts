/** Transient status messages shown in a polite live region. */
import { create } from 'zustand';

export interface Notice {
  id: number;
  tone: 'info' | 'error';
  message: string;
}

interface NoticeState {
  notices: Notice[];
  push: (tone: Notice['tone'], message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const LIFETIME_MS = 6000;

export const useNotices = create<NoticeState>((set) => ({
  notices: [],
  push: (tone, message) => {
    const id = nextId++;
    set((state) => ({ notices: [...state.notices.slice(-3), { id, tone, message }] }));
    setTimeout(
      () => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
      LIFETIME_MS,
    );
  },
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
}));
