/* ============================================================
   LACHBOX OS — BOOTSTRAP
   Wacht eerst op de auth-gate (js/auth.js): geen sessie -> loginscherm,
   wel sessie -> laadt de data, zet de sidebar/logo en start de router.
   Alle modules hebben zichzelf op dit punt al bij navigation.js
   geregistreerd (scriptvolgorde in index.html).
   ============================================================ */
(function(){
"use strict";

async function startApp(){
  const utils = LachboxOS.utils;
  try{
    await LachboxOS.state.refreshAll();
  }catch(e){
    console.error("Kon data niet laden uit de database:", e);
    utils.showToast("Kon data niet laden. Herlaad de pagina.", "error");
    return;
  }
  LachboxOS.state.initRealtime();

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

  if (LachboxOS.search) LachboxOS.search.init();
  LachboxOS.navigation.init();
}

async function boot(){
  await LachboxOS.auth.init(startApp);
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();
