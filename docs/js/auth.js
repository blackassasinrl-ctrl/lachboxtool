/* ============================================================
   LACHBOX OS — AUTH (Milestone 8a)
   Login met magic link (Supabase Auth) + de auth-gate die bepaalt of
   de app of het loginscherm getoond wordt. Nieuwe accounts worden
   NIET hier aangemaakt (shouldCreateUser: false) — teamleden worden
   toegevoegd via het Supabase-dashboard (Authentication -> Users ->
   Invite user), zodat willekeurige e-mailadressen zich niet zelf
   kunnen aanmelden bij deze gedeelde workspace.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;

function client(){
  if (!LachboxOS.supabaseClient){
    throw new Error("Geen verbinding met Supabase — controleer js/supabase-config.js.");
  }
  return LachboxOS.supabaseClient;
}

function showLoginView(){
  utils().el("loginView").hidden = false;
  utils().el("appShell").hidden = true;
}
function showAppShell(){
  utils().el("loginView").hidden = true;
  utils().el("appShell").hidden = false;
}

function renderAccount(session){
  const wrap = utils().el("sidebarAccount");
  if (!wrap) return;
  utils().clear(wrap);
  wrap.appendChild(utils().make("div", "sidebar-account-email", session.user.email));
  const logoutBtn = utils().make("button", "sidebar-account-logout", "Uitloggen");
  logoutBtn.type = "button";
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    await client().auth.signOut();
  });
  wrap.appendChild(logoutBtn);
}

function wireLoginForm(){
  const form = utils().el("loginForm");
  const emailInput = utils().el("loginEmail");
  const submitBtn = utils().el("loginSubmitBtn");
  const messageEl = utils().el("loginMessage");
  const logoImg = utils().el("loginLogo");
  if (logoImg && LachboxOS.LOGO_DATA_URL) logoImg.src = LachboxOS.LOGO_DATA_URL;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    submitBtn.disabled = true;
    messageEl.className = "login-message";
    messageEl.textContent = "Bezig met versturen...";
    try{
      const { error } = await client().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error){
        messageEl.className = "login-message error";
        messageEl.textContent = error.message.toLowerCase().includes("signups")
          ? "Dit e-mailadres is nog niet toegevoegd aan Lachbox OS. Vraag Mats of Wout om je uit te nodigen."
          : "Er ging iets mis: " + error.message;
      } else {
        messageEl.className = "login-message success";
        messageEl.textContent = `Check je mail: er is een inloglink gestuurd naar ${email}.`;
      }
    }catch(e2){
      messageEl.className = "login-message error";
      messageEl.textContent = "Kon geen verbinding maken. Probeer het straks nog eens.";
    }
    submitBtn.disabled = false;
  });
}

// onAuthenticated wordt precies één keer aangeroepen: meteen als er al een
// sessie is, of na een geslaagde login (via page reload, zie onAuthStateChange
// hieronder — simpelste robuuste manier om de app schoon te laten opstarten
// met een geldige sessie, in plaats van halverwege de boot-flow te wisselen).
async function init(onAuthenticated){
  wireLoginForm();

  if (!LachboxOS.supabaseClient){
    showLoginView();
    utils().el("loginSubmitBtn").disabled = true;
    utils().el("loginMessage").className = "login-message error";
    utils().el("loginMessage").textContent = "Kon geen verbinding maken met de database. Controleer je internetverbinding en herlaad de pagina.";
    return;
  }

  let session = null;
  try{
    const { data } = await client().auth.getSession();
    session = data && data.session;
  }catch(e){
    utils().el("loginMessage").textContent = "Kon geen verbinding maken met de database. Controleer je internetverbinding.";
  }

  if (session){
    showAppShell();
    renderAccount(session);
    onAuthenticated();
  } else {
    showLoginView();
  }

  client().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT"){
      location.reload();
    }
  });
}

LachboxOS.auth = { init };

})();
