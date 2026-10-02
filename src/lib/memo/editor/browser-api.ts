// The MemoApi bound to the browser Supabase client, created on first use so
// that the server render of the editor never builds a browser client.
import { createClient } from "@/lib/supabase/client";
import { type MemoApi, supabaseMemoApi } from "./api";

let api: MemoApi | undefined;
const get = (): MemoApi => (api ??= supabaseMemoApi(createClient()));

export const browserMemoApi: MemoApi = {
  insert: (...a) => get().insert(...a),
  update: (...a) => get().update(...a),
  fetch: (...a) => get().fetch(...a),
  upsertAnswer: (...a) => get().upsertAnswer(...a),
  setStatus: (...a) => get().setStatus(...a),
  remove: (...a) => get().remove(...a),
};
