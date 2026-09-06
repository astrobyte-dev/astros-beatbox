import { useSyncExternalStore } from "react";
import { StudioClient } from "../../src/studio-client";

export const client = new StudioClient();
export const useProject = () =>
  useSyncExternalStore(client.subscribe, client.getSnapshot);
export const useConnection = () =>
  useSyncExternalStore(client.subscribeStatus, client.getStatus);

export const accent = (slot: number) =>
  ["coral", "yellow", "mint", "lilac"][(slot - 1) % 4];
export const trackName = (name: string, slot: number) =>
  !name || /^d\d+$/.test(name) ? `Instrument ${slot}` : name;
