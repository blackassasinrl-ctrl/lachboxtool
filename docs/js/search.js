/* ============================================================
   LACHBOX OS — GLOBALE ZOEKFUNCTIE (Milestone 7: Afwerking)
   Eén zoekbalk boven in de sidebar, altijd zichtbaar, die klanten,
   leads, events en facturen tegelijk doorzoekt in de al geladen
   cache (state.js) — geen extra IndexedDB-round-trips per teken dat
   je typt. Leads hebben geen eigen detailroute, dus die openen direct
   de bewerk-modal (LachboxOS.crm.openLeadById) in plaats van te
   navigeren.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;

function resultsFor(query){
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const s = state();
  const out = [];

  s.cache.customers.forEach(c => {
    const hay = [c.company, c.contactPerson, c.email, c.city, c.phone].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return;
    out.push({
      type: "Klant", label: s.customerDisplayName(c),
      sub: [c.city, c.email].filter(Boolean).join(" · "),
      action: () => nav().navigateTo("crm/customers/" + c.id)
    });
  });

  s.cache.leads.forEach(l => {
    const customer = s.getCustomerById(l.customerId);
    const hay = [l.eventType, l.eventLocation, l.status, customer ? s.customerDisplayName(customer) : ""].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return;
    out.push({
      type: "Lead", label: (customer ? s.customerDisplayName(customer) : "Naamloze lead") + (l.eventType ? " · " + l.eventType : ""),
      sub: l.status,
      action: () => { if (LachboxOS.crm) LachboxOS.crm.openLeadById(l.id); }
    });
  });

  s.cache.events.forEach(e => {
    const customer = s.getCustomerById(e.customerId);
    const hay = [e.eventName, e.eventType, e.location, customer ? s.customerDisplayName(customer) : ""].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return;
    out.push({
      type: "Event", label: e.eventName || e.eventType || "Event",
      sub: [e.date ? utils().formatDateDisplay(e.date) : "", customer ? s.customerDisplayName(customer) : ""].filter(Boolean).join(" · "),
      action: () => nav().navigateTo("events/" + e.id)
    });
  });

  s.cache.invoices.forEach(inv => {
    const customer = s.getCustomerById(inv.customerId);
    const hay = [inv.invoiceNumber, inv.reference, customer ? s.customerDisplayName(customer) : ""].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return;
    out.push({
      type: "Factuur", label: inv.invoiceNumber || "Concept",
      sub: [customer ? s.customerDisplayName(customer) : "", utils().formatCurrency(inv.total || 0)].filter(Boolean).join(" · "),
      action: () => nav().navigateTo("invoices/" + inv.id)
    });
  });

  return out.slice(0, 15);
}

/* ---------- "+ Snel toevoegen" — hergebruikt bestaande modal-openers,
   geen dubbele formulierlogica ---------- */
function buildQuickActions(){
  const wrap = utils().make("div", "sidebar-quick-actions");
  const btn = utils().make("button", "sidebar-quick-btn", "+ Snel toevoegen");
  btn.type = "button";
  const menu = utils().make("div", "sidebar-quick-menu");
  menu.hidden = true;

  const items = [
    ["Nieuwe klant", () => LachboxOS.crm && LachboxOS.crm.openCustomerQuickCreateModal(c => nav().navigateTo("crm/customers/" + c.id))],
    ["Nieuwe lead", () => LachboxOS.crm && LachboxOS.crm.openLeadModal(null, () => state().refreshLeads())],
    ["Nieuw event", () => LachboxOS.events && LachboxOS.events.openEventCreateModal(ev => nav().navigateTo("events/" + ev.id))],
    ["Nieuwe factuur", () => LachboxOS.invoices && LachboxOS.invoices.openNewInvoiceModal()]
  ];
  items.forEach(([label, fn]) => {
    const item = utils().make("button", "sidebar-quick-menu-item", label);
    item.type = "button";
    item.addEventListener("click", () => { menu.hidden = true; fn(); });
    menu.appendChild(item);
  });

  btn.addEventListener("click", () => { menu.hidden = !menu.hidden; });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) menu.hidden = true; });

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

function init(){
  const wrap = utils().el("sidebarSearchWrap");
  if (!wrap) return;
  utils().clear(wrap);

  const box = utils().make("div", "sidebar-search");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Zoeken… (Ctrl+K)";
  input.className = "sidebar-search-input";
  input.autocomplete = "off";
  box.appendChild(input);
  const results = utils().make("div", "sidebar-search-results");
  results.hidden = true;
  box.appendChild(results);
  wrap.appendChild(box);
  wrap.appendChild(buildQuickActions());

  function closeSidebarOnMobile(){
    if (window.innerWidth > 980) return;
    const sidebar = utils().el("sidebar");
    if (sidebar) sidebar.classList.remove("open");
  }

  function renderResults(){
    const items = resultsFor(input.value);
    utils().clear(results);
    if (!items.length){ results.hidden = true; return; }
    items.forEach(item => {
      const row = utils().make("div", "sidebar-search-item");
      const top = utils().make("div", "sidebar-search-item-top");
      top.appendChild(utils().make("span", "sidebar-search-type", item.type));
      top.appendChild(utils().make("span", "sidebar-search-label", item.label));
      row.appendChild(top);
      if (item.sub) row.appendChild(utils().make("div", "sidebar-search-sub", item.sub));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = "";
        results.hidden = true;
        item.action();
        closeSidebarOnMobile();
      });
      results.appendChild(row);
    });
    results.hidden = false;
  }

  input.addEventListener("input", renderResults);
  input.addEventListener("focus", () => { if (input.value.trim()) renderResults(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){ input.value = ""; results.hidden = true; input.blur(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 150));

  document.addEventListener("keydown", (e) => {
    const typingElsewhere = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    const isShortcut = (e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typingElsewhere);
    if (!isShortcut) return;
    e.preventDefault();
    if (window.innerWidth <= 980){
      const sidebar = utils().el("sidebar");
      if (sidebar) sidebar.classList.add("open");
    }
    input.focus();
    input.select();
  });
}

LachboxOS.search = { init, resultsFor };

})();
