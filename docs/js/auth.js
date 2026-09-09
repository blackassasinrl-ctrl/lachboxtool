/* ============================================================
   LACHBOX OS — AUTH (Milestone 8a)
   Simpel wachtwoord-login: alleen e-mail + wachtwoord, geen inloglink.
   Accounts (met wachtwoord) worden aangemaakt via het Supabase-
   dashboard (Authentication -> Users -> Add user) — er is geen manier
   om hier zelf een account aan te maken, alleen om in te loggen met
   een account dat al bestaat.
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

function showView(id){
  ["loginView", "appShell"].forEach(viewId => {
    utils().el(viewId).hidden = (viewId !== id);
  });
}

function renderAccount(session){
  const wrap = utils().el("sidebarAccount");
  if (!wrap) return;
  utils().clear(wrap);
  wrap.appendChild(utils().make("div", "sidebar-account-email", session.user.email));
  const actions = utils().make("div", "sidebar-account-actions");
  const changePwBtn = utils().make("button", "sidebar-account-logout", "Wachtwoord wijzigen");
  changePwBtn.type = "button";
  changePwBtn.addEventListener("click", openChangePasswordModal);
  const logoutBtn = utils().make("button", "sidebar-account-logout", "Uitloggen");
  logoutBtn.type = "button";
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    await client().auth.signOut();
  });
  actions.appendChild(changePwBtn);
  actions.appendChild(logoutBtn);
  wrap.appendChild(actions);
}

function openChangePasswordModal(){
  utils().openModal({
    title: "Wachtwoord wijzigen",
    build(body, modal){
      const p1 = utils().textField("Nieuw wachtwoord", "", () => {}, { type: "password" });
      const p2 = utils().textField("Herhaal wachtwoord", "", () => {}, { type: "password" });
      body.appendChild(p1); body.appendChild(p2);
      const msg = utils().make("div", "login-message");
      body.appendChild(msg);
      const footer = utils().make("div", "modal-footer");
      const actions = utils().make("div", "modal-footer-actions");
      const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
      cancelBtn.type = "button"; cancelBtn.addEventListener("click", () => modal.close());
      const saveBtn = utils().make("button", "btn primary small", "Opslaan");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        const pass1 = p1._input.value, pass2 = p2._input.value;
        if (pass1.length < 8){ msg.className = "login-message error"; msg.textContent = "Minimaal 8 tekens."; return; }
        if (pass1 !== pass2){ msg.className = "login-message error"; msg.textContent = "Wachtwoorden komen niet overeen."; return; }
        saveBtn.disabled = true;
        const { error } = await client().auth.updateUser({ password: pass1 });
        saveBtn.disabled = false;
        if (error){ msg.className = "login-message error"; msg.textContent = error.message; return; }
        modal.close();
        utils().showToast("Wachtwoord gewijzigd.", "success");
      });
      actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
      footer.appendChild(actions);
      body.appendChild(footer);
    }
  });
}

function setMessage(el, text, type){
  el.className = "login-message" + (type ? " " + type : "");
  el.textContent = text;
}

function wireLoginForm(){
  const form = utils().el("loginPasswordForm");
  const messageEl = utils().el("loginMessage");
  const logoImg = utils().el("loginLogo");
  if (logoImg && LachboxOS.LOGO_DATA_URL) logoImg.src = LachboxOS.LOGO_DATA_URL;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = utils().el("loginEmail").value.trim();
    const password = utils().el("loginPassword").value;
    if (!email || !password) return;
    const submitBtn = utils().el("loginSubmitBtn");
    submitBtn.disabled = true;
    setMessage(messageEl, "Bezig met inloggen...");
    try{
      const { error } = await client().auth.signInWithPassword({ email, password });
      if (error){
        setMessage(messageEl, "E-mailadres of wachtwoord klopt niet.", "error");
        submitBtn.disabled = false;
      }
      // Bij succes vangt onAuthStateChange (SIGNED_IN) het op en herlaadt de pagina.
    }catch(e2){
      setMessage(messageEl, "Kon geen verbinding maken. Probeer het straks nog eens.", "error");
      submitBtn.disabled = false;
    }
  });
}

async function init(onAuthenticated){
  wireLoginForm();

  if (!LachboxOS.supabaseClient){
    showView("loginView");
    utils().el("loginSubmitBtn").disabled = true;
    setMessage(utils().el("loginMessage"), "Kon geen verbinding maken met de database. Controleer je internetverbinding en herlaad de pagina.", "error");
    return;
  }

  let session = null;
  try{
    const { data } = await client().auth.getSession();
    session = data && data.session;
  }catch(e){
    setMessage(utils().el("loginMessage"), "Kon geen verbinding maken met de database. Controleer je internetverbinding.", "error");
  }

  if (session){
    showView("appShell");
    renderAccount(session);
    onAuthenticated();
  } else {
    showView("loginView");
  }

  client().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT"){
      location.reload();
    }
  });
}

LachboxOS.auth = { init };

})();
