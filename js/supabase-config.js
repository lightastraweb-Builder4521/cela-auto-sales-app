/* ==========================================================================
   Supabase connection — BROWSER-SAFE VALUES ONLY
   --------------------------------------------------------------------------
   This file is public by nature (the browser downloads it). It may contain
   ONLY:
     • the project URL
     • the publishable ("anon") key

   These are safe to expose ONLY because Row Level Security protects every
   table and the storage bucket (see supabase/migrations). The publishable key
   by itself can read nothing but published inventory and can write nothing.

   NEVER put any of these here (or in any file in this repository):
     ✗ service_role / secret key        ✗ database password
     ✗ Supabase access token            ✗ GitHub token
     ✗ employee passwords               ✗ Porkbun credentials
   ========================================================================== */

export const SUPABASE = Object.freeze({
  url: 'https://ktbabvoyhlihkppfravt.supabase.co',
  publishableKey: 'sb_publishable_L3LrCAJxMEvpEQJA3EOOww_GzAw7q-T',
  photoBucket: 'vehicle-photos',
  signedUrlSeconds: 3600
});
