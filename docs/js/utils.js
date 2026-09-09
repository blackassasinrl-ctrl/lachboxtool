/* ============================================================
   LACHBOX OS — UTILS
   Gedeelde helpers: geld/datum-opmaak, id's, toasts, een generieke
   bevestigingsmodal en kleine DOM-hulpjes. Geen module hangt hier
   vanaf behalve dat de shell (index.html) de containers voor toasts
   en de bevestigingsmodal moet leveren (#toastContainer, #confirmModal).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};

/* ---------- ID's ---------- */
function uuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback voor oudere browsers.
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/* ---------- Geld ---------- */
const currencyFormatter = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

function roundMoney(n){
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function formatCurrency(n){
  if (!isFinite(n)) n = 0;
  return currencyFormatter.format(roundMoney(n));
}

/* ---------- Datum ---------- */
const MONTH_NAMES_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december"
];
const WEEKDAY_NAMES_NL = ["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"];

function pad2(n){ return String(n).padStart(2, "0"); }

// "YYYY-MM-DD" (zoals <input type="date">) -> Date, of null.
function parseDateInputValue(str){
  if (!str) return null;
  const parts = str.split("-");
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function formatDateInputValue(d){
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(date, days){
  const d = new Date(date);
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  return d;
}
// Compact: 14-09-2026
function formatDateDisplay(dateStr){
  const d = parseDateInputValue(dateStr);
  if (!d) return "";
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}
// Lang: 14 september 2026
function formatDateLong(dateStr){
  const d = parseDateInputValue(dateStr);
  if (!d) return "";
  return `${d.getDate()} ${MONTH_NAMES_NL[d.getMonth()]} ${d.getFullYear()}`;
}
function todayISO(){
  return formatDateInputValue(new Date());
}
function daysBetween(fromISO, toISO){
  const a = parseDateInputValue(fromISO), b = parseDateInputValue(toISO);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

/* ---------- BTW/factuurregel-rekenmotor ----------
   Zelfde logica als de losse factuurtool (calculateInvoice), hier als
   gedeelde utility zodat zowel de migratie als de latere factuurmodule
   (Milestone 4) hem gebruiken — geen tweede implementatie ergens anders. */
function calcAmountsFromUnit(unitPrice, qty, priceMode, vatRate){
  const q = Number(qty) || 0;
  const rate = Number(vatRate) || 0;
  let unitExcl, unitIncl;
  if (priceMode === "excl"){
    unitExcl = unitPrice;
    unitIncl = unitPrice * (1 + rate / 100);
  } else {
    unitIncl = unitPrice;
    unitExcl = rate !== -100 ? unitPrice / (1 + rate / 100) : 0;
  }
  const exclAmount = roundMoney(unitExcl * q);
  const inclAmount = roundMoney(unitIncl * q);
  const vatAmount = roundMoney(inclAmount - exclAmount);
  return { exclAmount, inclAmount, vatAmount };
}

// lines: array van factuurregels (type "item" of "discount", zelfde vorm als
// de factuurtool). Retourneert verrijkte regels + totalen + BTW-opbouw.
function calculateInvoiceTotals(lines){
  const itemLines = lines.filter(l => l.type === "item");
  const itemSubtotalExcl = itemLines.reduce((sum, l) => {
    const a = calcAmountsFromUnit(Number(l.price) || 0, Number(l.qty) || 0, l.priceMode, l.vatRate);
    return sum + a.exclAmount;
  }, 0);

  const computedLines = lines.map(line => {
    if (line.type === "item"){
      const a = calcAmountsFromUnit(Number(line.price) || 0, Number(line.qty) || 0, line.priceMode, line.vatRate);
      return Object.assign({}, line, a);
    }
    if (line.discountMode === "percentage"){
      const pct = Number(line.discountValue) || 0;
      const exclAmount = roundMoney(-(itemSubtotalExcl * pct / 100));
      const rate = Number(line.vatRate) || 0;
      const inclAmount = roundMoney(exclAmount * (1 + rate / 100));
      const vatAmount = roundMoney(inclAmount - exclAmount);
      return Object.assign({}, line, { exclAmount, inclAmount, vatAmount });
    }
    const value = Math.abs(Number(line.discountValue) || 0);
    const a = calcAmountsFromUnit(-value, 1, line.priceMode, line.vatRate);
    return Object.assign({}, line, a);
  });

  const totalExcl = roundMoney(computedLines.reduce((sum, l) => sum + l.exclAmount, 0));
  const totalVat = roundMoney(computedLines.reduce((sum, l) => sum + l.vatAmount, 0));
  const totalIncl = roundMoney(totalExcl + totalVat);

  const vatBreakdownMap = {};
  computedLines.forEach(l => {
    const rate = Number(l.vatRate) || 0;
    if (!vatBreakdownMap[rate]) vatBreakdownMap[rate] = { rate, exclBase: 0, vatAmount: 0 };
    vatBreakdownMap[rate].exclBase = roundMoney(vatBreakdownMap[rate].exclBase + l.exclAmount);
    vatBreakdownMap[rate].vatAmount = roundMoney(vatBreakdownMap[rate].vatAmount + l.vatAmount);
  });
  const vatBreakdown = Object.values(vatBreakdownMap).sort((a, b) => b.rate - a.rate);

  return { lines: computedLines, itemSubtotalExcl: roundMoney(itemSubtotalExcl), totalExcl, totalVat, totalIncl, vatBreakdown };
}

/* ---------- Tekst ---------- */
function slugify(text){
  return (text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ---------- Kleine DOM-hulpjes ---------- */
function el(id){ return document.getElementById(id); }
function make(tag, className, text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function clear(node){
  while (node.firstChild) node.removeChild(node.firstChild);
}
// Data-tables kunnen breder zijn dan het scherm (veel kolommen, smalle
// mobielweergave): dit laat de tabel zelf horizontaal scrollen in plaats
// van de hele pagina breder te maken dan de viewport.
function tableScrollWrap(table){
  const wrap = make("div", "table-scroll");
  wrap.appendChild(table);
  return wrap;
}

/* ---------- Toasts ---------- */
function showToast(message, type){
  const container = el("toastContainer");
  if (!container) { console.warn("toastContainer ontbreekt:", message); return; }
  const toast = make("div", "toast" + (type ? " " + type : ""), message);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity .25s ease";
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

/* ---------- Generieke bevestigingsmodal ---------- */
// Gebruikt door elke destructieve actie in het systeem (event verwijderen,
// backup herstellen, klant archiveren, ...). Retourneert een Promise<boolean>.
function askConfirm(title, message, opts){
  opts = opts || {};
  return new Promise(resolve => {
    const modal = el("confirmModal");
    el("confirmTitle").textContent = title;
    el("confirmMessage").textContent = message;
    const okBtn = el("btnConfirmOk");
    okBtn.textContent = opts.okLabel || "Doorgaan";
    okBtn.className = "btn " + (opts.danger === false ? "primary" : "danger");
    modal.hidden = false;

    function cleanup(result){
      modal.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    const cancelBtn = el("btnConfirmCancel");
    function onOk(){ cleanup(true); }
    function onCancel(){ cleanup(false); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

/* ---------- Generieke modal (los van de shell, bouwt eigen DOM) ----------
   Voor formulieren zoals "Nieuwe lead" of "Klant bewerken". Anders dan
   askConfirm (die vaste containers uit de shell gebruikt) maakt dit zijn
   eigen overlay/modal-nodes aan en ruimt ze bij close() weer op — zo kan
   elke module modals tonen zonder dat de shell ze vooraf hoeft te kennen. */
function openModal(opts){
  opts = opts || {};
  const overlay = make("div", "modal-overlay no-print");
  const modal = make("div", "modal" + (opts.size === "large" ? " modal-large" : ""));
  const header = make("div", "modal-header");
  header.appendChild(make("h2", null, opts.title || ""));
  const closeBtn = make("button", "modal-close-btn", "✕");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Sluiten");
  header.appendChild(closeBtn);
  modal.appendChild(header);
  const body = make("div", "modal-body");
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close(){ overlay.remove(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

  const api = { close, body, modal, overlay };
  if (typeof opts.build === "function") opts.build(body, api);
  return api;
}

/* ---------- Gedeelde formulier-bouwstenen ----------
   Gebruikt door Instellingen (M1) en CRM (M2) — één keer geschreven,
   overal hetzelfde uiterlijk en gedrag. */
function fieldRow(...fields){
  const row = make("div", "field-row");
  fields.forEach(f => row.appendChild(f));
  return row;
}
function textField(label, value, onInput, opts){
  opts = opts || {};
  const wrap = make("div", "field");
  if (label) wrap.appendChild(make("label", null, label));
  const input = document.createElement(opts.textarea ? "textarea" : "input");
  if (!opts.textarea) input.type = opts.type || "text";
  input.value = value == null ? "" : value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.textarea) input.rows = opts.rows || 2;
  input.addEventListener("input", () => onInput(input.value));
  wrap.appendChild(input);
  if (opts.hint) wrap.appendChild(make("div", "field-hint", opts.hint));
  wrap._input = input;
  return wrap;
}
function selectField(label, value, options, onChange){
  // options: array van [waarde, label]
  const wrap = make("div", "field");
  if (label) wrap.appendChild(make("label", null, label));
  const select = document.createElement("select");
  options.forEach(([val, text]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = text;
    if (String(val) === String(value)) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => onChange(select.value));
  wrap.appendChild(select);
  wrap._select = select;
  return wrap;
}

/* ---------- Wie ondertekent? ----------
   Elk teamlid tekent met zijn eigen naam (ingesteld bij het account,
   zie auth.js), niet met een gedeelde bedrijfsnaam — dat is bewust per
   persoon en staat los van de gedeelde instellingen. Alleen als er
   (nog) niemand ingelogd is — bijvoorbeeld tijdens het testen — vallen
   we terug op de gedeelde instellingen. */
function currentSenderName(settings){
  const fromAccount = LachboxOS.auth && LachboxOS.auth.displayName && LachboxOS.auth.displayName();
  if (fromAccount) return fromAccount;
  const e = (settings && settings.email) || {};
  const c = (settings && settings.company) || {};
  return e.senderName || c.name || "Lachbox";
}

/* ---------- E-mailhandtekening (met logo) ----------
   Gedeeld door Instellingen (waar 'm je kopieert naar Outlook/Gmail) en
   de e-mailgenerator (waar je 'm ziet als voorbeeld van wat er straks
   automatisch onder je bericht komt te staan). Gebouwd met de DOM-API
   i.p.v. string-HTML, dus geen handmatige escaping nodig. */
function buildEmailSignatureNode(settings){
  const c = (settings && settings.company) || {};
  const wrap = document.createElement("table");
  wrap.setAttribute("cellpadding", "0");
  wrap.setAttribute("cellspacing", "0");
  wrap.setAttribute("border", "0");
  wrap.style.fontFamily = "Arial, Helvetica, sans-serif";
  wrap.style.fontSize = "13px";
  wrap.style.color = "#111111";

  const row = wrap.insertRow();
  const logoCell = row.insertCell();
  logoCell.style.paddingRight = "16px";
  logoCell.style.borderRight = "2px solid #111111";
  logoCell.style.verticalAlign = "middle";
  if (c.logoUrl){
    const img = document.createElement("img");
    img.src = c.logoUrl;
    img.alt = c.name || "Lachbox";
    img.style.height = "40px";
    img.style.width = "auto";
    img.style.display = "block";
    logoCell.appendChild(img);
  }

  const infoCell = row.insertCell();
  infoCell.style.paddingLeft = "16px";
  infoCell.style.verticalAlign = "middle";

  const nameLine = document.createElement("div");
  nameLine.style.fontWeight = "700";
  nameLine.style.fontSize = "14px";
  nameLine.style.marginBottom = "6px";
  nameLine.textContent = currentSenderName(settings);
  infoCell.appendChild(nameLine);

  function contactLine(label, value, href){
    if (!value) return;
    const line = document.createElement("div");
    line.style.lineHeight = "1.6";
    line.appendChild(document.createTextNode(label + " "));
    if (href){
      const a = document.createElement("a");
      a.href = href; a.textContent = value;
      a.style.color = "#111111"; a.style.textDecoration = "none";
      line.appendChild(a);
    } else {
      line.appendChild(document.createTextNode(value));
    }
    infoCell.appendChild(line);
  }
  // Telefoon: het eigen nummer van de ingelogde gebruiker (zie auth.js),
  // terugvallend op het gedeelde bedrijfsnummer uit Instellingen.
  // E-mail: altijd het gedeelde contactadres, niet ieders eigen inlog-
  // mailadres — dat hoort niet per se in een klantgerichte handtekening.
  const personalPhone = LachboxOS.auth && LachboxOS.auth.personalPhone && LachboxOS.auth.personalPhone();
  const e = (settings && settings.email) || {};
  contactLine("T", personalPhone || c.phone);
  const signatureEmail = e.signatureEmail || "contact@lachbox.nl";
  contactLine("E", signatureEmail, "mailto:" + signatureEmail);
  contactLine("W", c.website, c.website ? "https://" + c.website.replace(/^https?:\/\//, "") : null);

  const addressBits = [c.street, c.city].filter(Boolean).join(", ");
  if (addressBits){
    const addrLine = document.createElement("div");
    addrLine.style.color = "#555555";
    addrLine.style.marginTop = "4px";
    addrLine.textContent = addressBits;
    infoCell.appendChild(addrLine);
  }

  return wrap;
}

async function copyNodeAsHtml(node){
  const html = node.outerHTML;
  const text = node.textContent.replace(/\n{2,}/g, "\n").trim();
  try{
    if (navigator.clipboard && window.ClipboardItem){
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  }catch(e){ /* val terug op selectie-kopieer hieronder */ }
  try{
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand("copy");
    selection.removeAllRanges();
    return ok;
  }catch(e2){ return false; }
}

/* ---------- @Tags in notities/chat ----------
   Een vaste, bekende naam ("@Wout Gerrits") i.p.v. los te typen, zodat
   een tag altijd exact matcht met wie er echt bedoeld wordt — zie
   LachboxOS.auth.knownTeamNames(). Geen live autocomplete-popup (dat
   is met een kale <textarea> lastig goed te doen); in plaats daarvan
   een rijtje "+ @Naam"-knopjes die de tag op de cursorpositie plakken,
   dus nooit een typefout in een naam. */
function knownNamesSorted(){
  const names = (LachboxOS.auth && LachboxOS.auth.knownTeamNames && LachboxOS.auth.knownTeamNames()) || [];
  // Langste naam eerst, anders matcht "Mats" al binnen "Mats Coenen".
  return names.slice().sort((a, b) => b.length - a.length);
}
function textMentionsName(text, name){
  return !!(text && name && text.includes("@" + name));
}
function renderTextWithMentions(text){
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const names = knownNamesSorted();
  if (!names.length){ frag.appendChild(document.createTextNode(text)); return frag; }
  const pattern = new RegExp("@(" + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "g");
  let lastIndex = 0, match;
  while ((match = pattern.exec(text))){
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    frag.appendChild(make("span", "mention", "@" + match[1]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  return frag;
}
function buildMentionButtons(onInsert){
  const wrap = make("div", "mention-buttons");
  knownNamesSorted().forEach(name => {
    const btn = make("button", "mention-btn", "+ @" + name);
    btn.type = "button";
    btn.addEventListener("click", () => onInsert(name));
    wrap.appendChild(btn);
  });
  return wrap;
}
function insertMentionAtCursor(input, name){
  const insertText = "@" + name + " ";
  const start = input.selectionStart != null ? input.selectionStart : input.value.length;
  const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const spacer = (before.length && !/\s$/.test(before)) ? " " : "";
  input.value = before + spacer + insertText + after;
  input.dispatchEvent(new Event("input"));
  input.focus();
  const pos = (before + spacer + insertText).length;
  input.setSelectionRange(pos, pos);
}

LachboxOS.utils = {
  uuid,
  roundMoney, formatCurrency,
  pad2, parseDateInputValue, formatDateInputValue, addDays,
  formatDateDisplay, formatDateLong, todayISO, daysBetween,
  MONTH_NAMES_NL, WEEKDAY_NAMES_NL,
  calcAmountsFromUnit, calculateInvoiceTotals,
  slugify,
  el, make, clear, tableScrollWrap,
  showToast, askConfirm, openModal,
  fieldRow, textField, selectField,
  buildEmailSignatureNode, copyNodeAsHtml, currentSenderName,
  textMentionsName, renderTextWithMentions, buildMentionButtons, insertMentionAtCursor
};

})();
