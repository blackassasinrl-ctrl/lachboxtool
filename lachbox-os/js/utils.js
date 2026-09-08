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

/* ---------- Tekst / veiligheid ---------- */
// Voor plekken waar we noodgedwongen HTML-strings samenstellen i.p.v.
// DOM-nodes: nooit ongefilterde gebruikersinvoer erin zetten zonder dit.
function escapeHtml(str){
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  const overlay = make("div", "modal-overlay");
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

LachboxOS.utils = {
  uuid,
  roundMoney, formatCurrency,
  pad2, parseDateInputValue, formatDateInputValue, addDays,
  formatDateDisplay, formatDateLong, todayISO, daysBetween,
  MONTH_NAMES_NL, WEEKDAY_NAMES_NL,
  calcAmountsFromUnit, calculateInvoiceTotals,
  escapeHtml, slugify,
  el, make, clear,
  showToast, askConfirm, openModal,
  fieldRow, textField, selectField
};

})();
