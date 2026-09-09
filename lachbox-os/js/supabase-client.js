/* ============================================================
   LACHBOX OS — SUPABASE-CLIENT (Milestone 8a)
   Eén gedeelde client-instantie voor de hele app — storage.js
   (database), auth.js (login) en state.js (Realtime) gebruiken
   allemaal dezelfde `LachboxOS.supabaseClient`.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};

if (!window.supabase || typeof window.supabase.createClient !== "function"){
  console.error("Supabase-js kon niet geladen worden (CDN-script). Lachbox OS kan niet starten zonder verbinding met de database.");
} else if (!window.LACHBOX_SUPABASE_URL || !window.LACHBOX_SUPABASE_ANON_KEY){
  console.error("Supabase is niet geconfigureerd — js/supabase-config.js ontbreekt of is leeg.");
} else {
  LachboxOS.supabaseClient = window.supabase.createClient(
    window.LACHBOX_SUPABASE_URL,
    window.LACHBOX_SUPABASE_ANON_KEY
  );
}

})();
