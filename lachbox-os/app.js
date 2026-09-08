/* ============================================================
   LACHBOX OS — BOOTSTRAP
   Laadt de data, zet de sidebar/logo en start de router. Alle
   modules hebben zichzelf op dit punt al bij navigation.js
   geregistreerd (scriptvolgorde in index.html).
   ============================================================ */
(function(){
"use strict";

async function boot(){
  const utils = LachboxOS.utils;
  try{
    await LachboxOS.state.refreshAll();
  }catch(e){
    console.error("Kon data niet laden uit IndexedDB:", e);
    utils.showToast("Kon lokale data niet laden. Herlaad de pagina.", "error");
    return;
  }

  const settings = LachboxOS.state.cache.settings;
  const logoImg = utils.el("sidebarLogo");
  if (logoImg && settings && settings.company && settings.company.logoUrl){
    logoImg.src = settings.company.logoUrl;
  }

  const sidebar = utils.el("sidebar");
  const toggleBtn = utils.el("btnToggleSidebar");
  if (toggleBtn && sidebar){
    toggleBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
    utils.el("appContent").addEventListener("click", () => sidebar.classList.remove("open"));
  }

  LachboxOS.navigation.init();
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();
