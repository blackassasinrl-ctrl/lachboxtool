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
// mobielweergave). Op een telefoon is horizontaal scrollen door een tabel
// alsnog onhandig, dus krijgt elke .data-table daar i.p.v. rijen een
// gestapelde kaart per record (zie de @media-regel in styles.css) — elke
// cel toont dan zijn kolomkop als klein label ervoor. Dat label wordt hier
// automatisch uit de <thead> gehaald, zodat geen enkele tabelbouwer zelf
// data-label-attributen hoeft te zetten.
function tableScrollWrap(table){
  if (table.classList.contains("data-table")){
    const headers = Array.from(table.querySelectorAll("thead th")).map(th => th.textContent.trim());
    table.querySelectorAll("tbody tr").forEach(tr => {
      Array.from(tr.children).forEach((td, idx) => {
        if (headers[idx]) td.setAttribute("data-label", headers[idx]);
      });
    });
  }
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

/* ---------- Modal-viewport-hulpjes (mobiele Safari) ----------
   Twee bekende iOS Safari-problemen met een position:fixed overlay:
   1) de achterliggende pagina blijft "doorheen" de overlay scrollen
      (rubber-banding), waardoor de modal lijkt te verspringen/half in
      beeld blijft hangen;
   2) 100dvh volgt Safari's eigen balk wel betrouwbaar, maar niet altijd
      het toetsenbord — de Visual Viewport API doet dat overal wél, dus
      dat is de harde garantie dat de modal (en dus zijn knoppen) binnen
      het écht zichtbare gebied blijft, ook met een veld in focus.
   Een teller i.p.v. simpel aan/uit, zodat een geneste modal (bijv. "nieuwe
   klant" boven op "nieuwe lead") de achtergrond-lock niet te vroeg opheft. */
let openOverlayCount = 0;
let savedScrollY = 0;
function lockBackgroundScroll(){
  if (openOverlayCount === 0){
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = "fixed";
    document.body.style.top = "-" + savedScrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
  }
  openOverlayCount++;
}
function unlockBackgroundScroll(){
  openOverlayCount = Math.max(0, openOverlayCount - 1);
  if (openOverlayCount === 0){
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    window.scrollTo(0, savedScrollY);
  }
}
function syncOverlayToVisualViewport(overlay){
  if (!window.visualViewport) return null;
  const vv = window.visualViewport;
  function sync(){
    overlay.style.height = vv.height + "px";
    overlay.style.width = vv.width + "px";
    overlay.style.top = vv.offsetTop + "px";
    overlay.style.left = vv.offsetLeft + "px";
  }
  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
  };
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
    lockBackgroundScroll();
    const stopViewportSync = syncOverlayToVisualViewport(modal);

    function cleanup(result){
      modal.hidden = true;
      if (stopViewportSync) stopViewportSync();
      unlockBackgroundScroll();
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
  lockBackgroundScroll();
  const stopViewportSync = syncOverlayToVisualViewport(overlay);

  function close(){
    if (stopViewportSync) stopViewportSync();
    unlockBackgroundScroll();
    overlay.remove();
  }
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
   LachboxOS.auth.knownTeamNames(). Getypt (niet aangeklikt): zie
   attachInlineAutocomplete() verderop. */
function knownNamesSorted(){
  const names = (LachboxOS.auth && LachboxOS.auth.knownTeamNames && LachboxOS.auth.knownTeamNames()) || [];
  // Langste naam eerst, anders matcht "Mats" al binnen "Mats Coenen".
  return names.slice().sort((a, b) => b.length - a.length);
}
function textMentionsName(text, name){
  return !!(text && name && text.includes("@" + name));
}

/* ---------- Record-links in notities/chat ----------
   Zelfde idee als @tags, maar dan een klikbare verwijzing naar een
   specifiek record (klant/lead/event/factuur/review) i.p.v. een naam —
   zo kun je tijdens het chatten iemand direct "doorverbinden" naar de
   juiste klant/factuur. Opgeslagen als platte tekst in het bericht
   ([[type:id|Label]]), dus geen schemawijziging nodig. */
const RECORD_LINK_ICONS = { customer: "👤", lead: "🎯", event: "📅", invoice: "🧾", review: "⭐" };
const RECORD_LINK_TYPES = /customer|lead|event|invoice|review/.source;
function encodeRecordLink(type, id, label){
  const safeLabel = String(label == null ? "" : label).replace(/\]\]/g, "] ]").trim() || "record";
  return `[[${type}:${id}|${safeLabel}]]`;
}
function navigateToRecordLink(type, id){
  const n = LachboxOS.navigation;
  if (!n) return;
  if (type === "customer") n.navigateTo("crm/customers/" + id);
  else if (type === "event" || type === "review") n.navigateTo("events/" + id);
  else if (type === "invoice") n.navigateTo("invoices/" + id);
  else if (type === "lead" && LachboxOS.crm) LachboxOS.crm.openLeadById(id);
}
function buildRecordLinkChip(type, id, label){
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "record-link";
  chip.textContent = (RECORD_LINK_ICONS[type] || "🔗") + " " + label;
  chip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); navigateToRecordLink(type, id); });
  return chip;
}
function renderTextWithMentions(text){
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const names = knownNamesSorted();
  const mentionAlt = names.length ? names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") : "[^\\s\\S]";
  const pattern = new RegExp(
    "@(" + mentionAlt + ")\\b" +
    "|\\[\\[(" + RECORD_LINK_TYPES + "):([\\w-]+)\\|([^\\]]+)\\]\\]",
    "g"
  );
  let lastIndex = 0, match;
  while ((match = pattern.exec(text))){
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    if (match[1] !== undefined) frag.appendChild(make("span", "mention", "@" + match[1]));
    else frag.appendChild(buildRecordLinkChip(match[2], match[3], match[4]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  return frag;
}
/* ---------- Items voor de inline autocomplete hieronder ---------- */
function mentionAutocompleteItems(query){
  const q = query.toLowerCase();
  return knownNamesSorted()
    .filter(name => name.toLowerCase().includes(q))
    .map(name => ({ label: "@" + name, insertText: "@" + name }));
}
function recordLinkAutocompleteItems(query){
  if (!LachboxOS.search) return [];
  return LachboxOS.search.resultsFor(query).map(item => ({
    label: (RECORD_LINK_ICONS[item.recordType] || "🔗") + " " + item.label + "  ·  " + item.type,
    insertText: encodeRecordLink(item.recordType, item.id, item.label)
  }));
}

/* ---------- Inline "@"/"*" autocomplete ----------
   Typ "@" voor een teamlid-tag of "*" om een klant/lead/event/factuur/
   review te koppelen: een dropdown eronder filtert live mee terwijl je
   typt, pijltjes wisselen de markering, Tab of Enter kiest de gemarkeerde
   match, Esc annuleert. Werkt op elke <input>/<textarea>; het paneel
   hangt los aan <body> zodat het nooit de layout van de pagina eromheen
   verstoort (ook prima bruikbaar binnen een modal). */
function attachInlineAutocomplete(input, trigger, getItems, opts){
  opts = opts || {};
  const minChars = opts.minChars || 0;
  const panel = make("div", "inline-autocomplete-panel");
  panel.hidden = true;
  document.body.appendChild(panel);

  let items = [], activeIndex = 0, range = null;

  function queryRange(){
    const pos = input.selectionStart;
    if (pos == null) return null;
    const value = input.value;
    let i = pos - 1;
    while (i >= 0 && value[i] !== trigger){
      if (/\s/.test(value[i])) return null;
      i--;
    }
    if (i < 0 || value[i] !== trigger) return null;
    if (i > 0 && !/\s/.test(value[i - 1])) return null; // trigger moet aan het begin van een woord staan (geen e-mailadres o.i.d.)
    return { start: i, end: pos, query: value.slice(i + 1, pos) };
  }

  function close(){ panel.hidden = true; items = []; range = null; }

  // Houdt het paneel altijd binnen het zichtbare scherm — zonder dit zou
  // het bij een veld dicht tegen de rand (of onderin, zoals de chat-
  // invoer) deels of helemaal buiten beeld vallen, en moest je in-/
  // uitzoomen om er nog bij te kunnen.
  function position(){
    const r = input.getBoundingClientRect();
    const width = Math.round(Math.min(Math.max(r.width, 220), 320));
    panel.style.minWidth = width + "px";
    panel.style.maxWidth = "calc(100vw - 16px)";
    let left = Math.round(r.left);
    left = Math.min(left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    panel.style.left = left + "px";

    const panelHeight = panel.offsetHeight;
    const spaceBelow = window.innerHeight - r.bottom;
    const openAbove = spaceBelow < panelHeight + 12 && r.top > panelHeight + 12;
    panel.style.top = Math.round(openAbove ? (r.top - panelHeight - 4) : (r.bottom + 4)) + "px";
  }

  function render(){
    clear(panel);
    if (!items.length){
      const hint = range.query.length < minChars ? "Typ verder om te zoeken…" : "Niets gevonden.";
      panel.appendChild(make("div", "empty-hint", hint));
    } else {
      items.forEach((item, idx) => {
        const row = make("div", "inline-autocomplete-item" + (idx === activeIndex ? " active" : ""), item.label);
        row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(idx); });
        panel.appendChild(row);
      });
    }
    // Eerst zichtbaar maken en dán positioneren: position() moet de
    // werkelijke hoogte kunnen meten (offsetHeight is 0 op een hidden
    // element), en dat gebeurt nog vóór de volgende verfbeurt — geen
    // zichtbare flits.
    panel.hidden = false;
    position();
  }

  function pick(idx){
    const item = items[idx];
    if (!item || !range) return;
    const before = input.value.slice(0, range.start);
    const after = input.value.slice(range.end);
    const insertText = item.insertText + " ";
    input.value = before + insertText + after;
    const pos = (before + insertText).length;
    close();
    input.dispatchEvent(new Event("input"));
    input.focus();
    input.setSelectionRange(pos, pos);
  }

  function refresh(){
    range = queryRange();
    if (!range){ close(); return; }
    items = range.query.length < minChars ? [] : (getItems(range.query) || []);
    activeIndex = 0;
    render();
  }

  input.addEventListener("input", refresh);
  input.addEventListener("click", refresh);
  input.addEventListener("keydown", (e) => {
    if (panel.hidden) return;
    if (e.key === "Escape"){ close(); return; }
    if (!items.length) return; // laat Tab/Enter/pijltjes gewoon werken bij "niets gevonden"
    if (e.key === "ArrowDown"){ e.preventDefault(); e.stopImmediatePropagation(); activeIndex = Math.min(activeIndex + 1, items.length - 1); render(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); e.stopImmediatePropagation(); activeIndex = Math.max(activeIndex - 1, 0); render(); }
    else if (e.key === "Tab" || e.key === "Enter"){ e.preventDefault(); e.stopImmediatePropagation(); pick(activeIndex); }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
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
  textMentionsName, renderTextWithMentions,
  encodeRecordLink, navigateToRecordLink,
  mentionAutocompleteItems, recordLinkAutocompleteItems, attachInlineAutocomplete
};

})();
