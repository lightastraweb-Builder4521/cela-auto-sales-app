/* ==========================================================================
   Repository factory — the one switch between storage backends.

     APP.backend === 'supabase'  → Supabase adapter (shared, secured; staging/production)
     APP.backend === 'local'     → IndexedDB adapter (this browser only; offline development)

   Both adapters expose the same methods, so services and pages never change.
   The choice is made in js/config.js (BACKEND).
   ========================================================================== */
import { APP, STORAGE } from '../config.js';
import { createLocalRepository } from './local-repository.js';
import { createSupabaseRepository } from './supabase-repository.js';

let repository = null;

export function getRepository() {
  if (!repository) {
    if (APP.backend === 'supabase') {
      repository = createSupabaseRepository();
    } else if (APP.backend === 'local') {
      repository = createLocalRepository({ dbName: STORAGE.dbName, dbVersion: STORAGE.dbVersion });
    } else {
      throw new Error(`Unknown backend "${APP.backend}". Use "supabase" or "local" in js/config.js.`);
    }
  }
  return repository;
}
