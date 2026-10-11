import { create } from "zustand";

import type { LocalCommentSend } from "./tmsCommentModel";

const EMPTY: ReadonlyArray<LocalCommentSend> = [];

interface TmsCommentSendState {
  /** Sends not yet seen in the thread, by scoped thread key. Outlives the panel. */
  readonly byThread: Readonly<Record<string, ReadonlyArray<LocalCommentSend>>>;
  put: (threadKey: string, send: LocalCommentSend) => void;
  remove: (threadKey: string, messageId: string) => void;
}

export const useTmsCommentSendStore = create<TmsCommentSendState>((set) => ({
  byThread: {},
  put: (threadKey, send) =>
    set((state) => {
      const existing = state.byThread[threadKey] ?? EMPTY;
      return {
        byThread: {
          ...state.byThread,
          [threadKey]: [...existing.filter((entry) => entry.messageId !== send.messageId), send],
        },
      };
    }),
  remove: (threadKey, messageId) =>
    set((state) => {
      const existing = state.byThread[threadKey];
      if (existing === undefined) return state;
      return {
        byThread: {
          ...state.byThread,
          [threadKey]: existing.filter((entry) => entry.messageId !== messageId),
        },
      };
    }),
}));

export const useLocalCommentSends = (threadKey: string | null) =>
  useTmsCommentSendStore((state) =>
    threadKey === null ? EMPTY : (state.byThread[threadKey] ?? EMPTY),
  );
