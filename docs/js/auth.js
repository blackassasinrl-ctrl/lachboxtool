/* ============================================================
   LACHBOX OS — AUTH (Milestone 8a)
   Wachtwoord-login als hoofdroute (werkt vanaf elk apparaat, geen
   mail nodig), met de inloglink als terugvaloptie voor de eerste
   keer of een vergeten wachtwoord — die vraagt na het inloggen
   meteen om een wachtwoord in te stellen. Nieuwe accounts worden
   NIET hier aangemaakt (shouldCreateUser: false) — teamleden worden
   toegevoegd via het Supabase-dashboard (Authentication -> Users ->
   Invite user), zodat willekeurige e-mailadressen zich niet zelf
   kunnen aanmelden bij deze gedeelde workspace.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;

const PASSWORD_SETUP_FLAG = "lachbox_os_pending_password_setup";

function client(){
  if (!LachboxOS.supabaseClient){
    throw new Error("Geen verbinding met Supabase — controleer js/supabase-config.js.");
  }
  return LachboxOS.supabaseClient;
}

function showView(id){
  ["loginView", "setPasswordView", "appShell"].forEach(viewId => {
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

function wireLoginForms(){
  const passwordForm = utils().el("loginPasswordForm");
  const linkForm = utils().el("loginLinkForm");
  const toggleBtn = utils().el("loginToggleModeBtn");
  const sub = utils().el("loginSub");
  const messageEl = utils().el("loginMessage");
  const logoImg = utils().el("loginLogo");
  if (logoImg && LachboxOS.LOGO_DATA_URL) logoImg.src = LachboxOS.LOGO_DATA_URL;

  let linkMode = false;
  toggleBtn.addEventListener("click", () => {
    linkMode = !linkMode;
    passwordForm.hidden = linkMode;
    linkForm.hidden = !linkMode;
    sub.textContent = linkMode
      ? "Vul je e-mailadres in, je krijgt een inloglink toegestuurd."
      : "Log in met je @lachbox.nl e-mailadres en wachtwoord.";
    toggleBtn.textContent = linkMode ? "Toch met wachtwoord inloggen" : "Eerste keer, of wachtwoord vergeten? Log in met een link";
    setMessage(messageEl, "");
  });

  passwordForm.addEventListener("submit", async (e) => {
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
      }
      // Bij succes vangt onAuthStateChange (SIGNED_IN) het op en herlaadt de pagina.
    }catch(e2){
      setMessage(messageEl, "Kon geen verbinding maken. Probeer het straks nog eens.", "error");
    }
    submitBtn.disabled = false;
  });

  linkForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = utils().el("loginLinkEmail").value.trim();
    if (!email) return;
    const submitBtn = utils().el("loginLinkSubmitBtn");
    submitBtn.disabled = true;
    setMessage(messageEl, "Bezig met versturen...");
    try{
      // Zet de vlag vóór het verzenden: als het linkje zo dadelijk in
      // dezelfde browser geopend wordt, weten we dat er nog geen
      // wachtwoord is en vragen we er meteen om (zie init() hieronder).
      localStorage.setItem(PASSWORD_SETUP_FLAG, "1");
      const { error } = await client().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error){
        localStorage.removeItem(PASSWORD_SETUP_FLAG);
        setMessage(messageEl, error.message.toLowerCase().includes("signups")
          ? "Dit e-mailadres is nog niet toegevoegd aan Lachbox OS. Vraag Mats of Wout om je uit te nodigen."
          : "Er ging iets mis: " + error.message, "error");
      } else {
        setMessage(messageEl, `Check je mail: er is een inloglink gestuurd naar ${email}.`, "success");
      }
    }catch(e2){
      localStorage.removeItem(PASSWORD_SETUP_FLAG);
      setMessage(messageEl, "Kon geen verbinding maken. Probeer het straks nog eens.", "error");
    }
    submitBtn.disabled = false;
  });
}

function wireSetPasswordForm(onDone){
  const form = utils().el("setPasswordForm");
  const messageEl = utils().el("setPasswordMessage");
  const skipBtn = utils().el("skipPasswordBtn");
  const logoImg = utils().el("setPasswordLogo");
  if (logoImg && LachboxOS.LOGO_DATA_URL) logoImg.src = LachboxOS.LOGO_DATA_URL;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = utils().el("newPassword").value;
    const p2 = utils().el("newPasswordConfirm").value;
    if (p1.length < 8){ setMessage(messageEl, "Minimaal 8 tekens.", "error"); return; }
    if (p1 !== p2){ setMessage(messageEl, "Wachtwoorden komen niet overeen.", "error"); return; }
    const submitBtn = utils().el("setPasswordSubmitBtn");
    submitBtn.disabled = true;
    setMessage(messageEl, "Bezig met opslaan...");
    const { error } = await client().auth.updateUser({ password: p1 });
    submitBtn.disabled = false;
    if (error){
      setMessage(messageEl, "Er ging iets mis: " + error.message, "error");
      return;
    }
    localStorage.removeItem(PASSWORD_SETUP_FLAG);
    utils().showToast("Wachtwoord ingesteld.", "success");
    onDone();
  });

  skipBtn.addEventListener("click", () => {
    localStorage.removeItem(PASSWORD_SETUP_FLAG);
    onDone();
  });
}

// onAuthenticated wordt precies één keer aangeroepen: meteen als er al een
// geldige sessie is (met wachtwoord ingesteld), of nadat het wachtwoord-
// scherm is afgerond/overgeslagen. Een geslaagde login zelf (event
// SIGNED_IN) herlaadt gewoon de pagina — simpelste robuuste manier om de
// app schoon te laten opstarten met een geldige sessie.
async function init(onAuthenticated){
  wireLoginForms();
  wireSetPasswordForm(async () => {
    showView("appShell");
    const { data } = await client().auth.getSession();
    if (data && data.session) renderAccount(data.session);
    onAuthenticated();
  });

  if (!LachboxOS.supabaseClient){
    showView("loginView");
    utils().el("loginSubmitBtn").disabled = true;
    utils().el("loginLinkSubmitBtn").disabled = true;
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
    if (localStorage.getItem(PASSWORD_SETUP_FLAG) === "1"){
      showView("setPasswordView");
    } else {
      showView("appShell");
      renderAccount(session);
      onAuthenticated();
    }
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
