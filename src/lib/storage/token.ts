import { load } from "@tauri-apps/plugin-store";

const STORE_FILE = "config.json";
const PAT_KEY = "github-pat";

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} });
}

export async function storeToken(token: string): Promise<void> {
  const store = await getStore();
  await store.set(PAT_KEY, token);
  await store.save();
}

export async function getToken(): Promise<string | null> {
  const store = await getStore();
  const value = await store.get<string>(PAT_KEY);
  return value ?? null;
}

export async function clearToken(): Promise<void> {
  const store = await getStore();
  await store.delete(PAT_KEY);
  await store.save();
}
