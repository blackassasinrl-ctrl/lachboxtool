/* ============================================================
   LACHBOX OS — EVENTS
   Eventoverzicht met filters (sectie 10) en de eventdetailpagina
   (sectie 11: Overzicht/Contact/Boeking/Administratie/Nazorg) met
   ingebed checklist-paneel + gereedheidsscore (sectie 12/13).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const storage = () => LachboxOS.storage;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;
const checklists = () => LachboxOS.checklists;

const EVENT_STATUSES = ["Gepland", "Bevestigd", "Afgerond", "Geannuleerd"];
const EVENT_FILTER_KEY = "lachbox_os_events_filter"; // localStorage: UI-voorkeur

function eventStatusBadgeClass(status){
  if (status === "Afgerond") return "badge-success";
  if (status === "Geannuleerd") return "badge-danger";
  if (status === "Bevestigd") return "badge-info";
  return "badge-warning"; // Gepland: nog actie nodig
}

function primaryInvoiceFor(eventId){
  const invs = state().invoicesForEvent(eventId);
  return invs.length ? invs[0] : null;
}
function paymentBadgeInfo(eventId){
  const inv = primaryInvoiceFor(eventId);
  if (!inv) return { text: "Geen factuur", cls: "badge-info" };
  if (LachboxOS.invoices) return { text: LachboxOS.invoices.invoiceStatusLabel(inv), cls: LachboxOS.invoices.invoiceStatusBadgeClass(inv) };
  if (inv.paymentStatus === "betaald") return { text: "Betaald", cls: "badge-success" };
  if (inv.paymentStatus === "verstuurd") return { text: "Verstuurd", cls: "badge-warning" };
  return { text: "Concept", cls: "badge-info" };
}

/* ============================================================
   Events-lijst met filters
   ============================================================ */
const FILTERS = [
  { key: "upcoming", label: "Komende events" },
  { key: "past", label: "Afgelopen events" },
  { key: "week", label: "Deze week" },
  { key: "month", label: "Deze maand" },
  { key: "unpaid", label: "Niet betaald" },
  { key: "checklist_incomplete", label: "Checklist incompleet" },
  { key: "all", label: "Alle" }
];

function applyFilter(events, key){
  const today = utils().todayISO();
  const now = new Date();
  if (key === "upcoming") return events.filter(e => e.date >= today);
  if (key === "past") return events.filter(e => e.date && e.date < today);
  if (key === "week"){
    const weekEnd = utils().formatDateInputValue(utils().addDays(now, 7));
    return events.filter(e => e.date >= today && e.date <= weekEnd);
  }
  if (key === "month"){
    return events.filter(e => {
      const d = utils().parseDateInputValue(e.date);
      return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }
  if (key === "unpaid"){
    return events.filter(e => {
      const inv = primaryInvoiceFor(e.id);
      return !inv || inv.paymentStatus !== "betaald";
    });
  }
  if (key === "checklist_incomplete"){
    return events.filter(e => {
      const cl = state().checklistForEvent(e.id);
      return checklists().computeChecklistReadiness(cl).percent < 100;
    });
  }
  return events;
}

function renderEventsListPage(container){
  const page = utils().make("div", "page");
  const header = utils().make("div", "page-header");
  header.appendChild(utils().make("h1", "page-title", "Events"));
  const newBtn = utils().make("button", "btn primary", "+ Nieuw event");
  newBtn.type = "button";
  newBtn.addEventListener("click", () => openEventCreateModal(ev => nav().navigateTo("events/" + ev.id)));
  header.appendChild(newBtn);
  page.appendChild(header);

  const toolbar = utils().make("div", "toolbar");
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "search-input";
  searchInput.placeholder = "Zoek op klant, locatie of type…";
  toolbar.appendChild(searchInput);
  page.appendChild(toolbar);

  const pillsRow = utils().make("div", "filter-pills");
  page.appendChild(pillsRow);

  const content = utils().make("div");
  page.appendChild(content);
  container.appendChild(page);

  let activeFilter = localStorage.getItem(EVENT_FILTER_KEY) || "upcoming";
  const pillButtons = {};
  FILTERS.forEach(f => {
    const btn = utils().make("button", "filter-pill", f.label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      activeFilter = f.key;
      localStorage.setItem(EVENT_FILTER_KEY, f.key);
      updatePills();
      renderTable();
    });
    pillButtons[f.key] = btn;
    pillsRow.appendChild(btn);
  });
  function updatePills(){
    FILTERS.forEach(f => pillButtons[f.key].classList.toggle("active", f.key === activeFilter));
  }

  function renderTable(){
    utils().clear(content);
    let events = applyFilter(state().cache.events.slice(), activeFilter);
    const q = searchInput.value.trim().toLowerCase();
    if (q){
      events = events.filter(e => {
        const customer = state().getCustomerById(e.customerId);
        const hay = [state().customerDisplayName(customer), e.location, e.eventType, e.eventName].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    events.sort((a,b) => (a.date||"").localeCompare(b.date||""));

    if (events.length === 0){
      content.appendChild(utils().make("div", "empty-hint", "Geen events gevonden voor dit filter."));
      return;
    }
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Datum", "Event", "Klant", "Locatie", "Pakket", "Bedrag", "Betaling", "Checklist", "Status"].forEach(h => headRow.appendChild(utils().make("th", null, h)));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    events.forEach(ev => {
      const customer = state().getCustomerById(ev.customerId);
      const tr = document.createElement("tr");
      tr.appendChild(utils().make("td", "cell-muted", ev.date ? utils().formatDateDisplay(ev.date) : "—"));
      tr.appendChild(utils().make("td", null, ev.eventName || ev.eventType || "Event"));
      tr.appendChild(utils().make("td", null, state().customerDisplayName(customer) || "—"));
      tr.appendChild(utils().make("td", "cell-muted", ev.location || "—"));
      tr.appendChild(utils().make("td", "cell-muted", ev.package || "—"));
      tr.appendChild(utils().make("td", "cell-num", utils().formatCurrency(ev.price || 0)));

      const payTd = document.createElement("td");
      const pay = paymentBadgeInfo(ev.id);
      payTd.appendChild(utils().make("span", "badge " + pay.cls, pay.text));
      tr.appendChild(payTd);

      const clTd = document.createElement("td");
      const r = checklists().computeChecklistReadiness(state().checklistForEvent(ev.id));
      clTd.appendChild(document.createTextNode(checklists().readinessDot(r.level) + " " + r.percent + "%"));
      tr.appendChild(clTd);

      const statusTd = document.createElement("td");
      statusTd.appendChild(utils().make("span", "badge " + eventStatusBadgeClass(ev.status), ev.status || "Gepland"));
      tr.appendChild(statusTd);

      tr.addEventListener("click", () => nav().navigateTo("events/" + ev.id));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(utils().tableScrollWrap(table));
  }

  searchInput.addEventListener("input", renderTable);
  updatePills();
  renderTable();
}

function openEventCreateModal(onSaved, opts){
  opts = opts || {};
  const settings = state().cache.settings;
  const packageOptions = Object.keys(settings.components).map(key => [settings.components[key].name, settings.components[key].name]);
  packageOptions.push(["", "Maatwerk / anders"]);

  const event = {
    customerId: opts.initialCustomerId || null, leadId: null, eventName: "", eventType: "", date: "",
    startTime: "", endTime: "", location: "", address: "", package: "", price: 0,
    extras: [], costs: [], discount: 0, staff: "", notes: "", checklistId: null, invoiceId: null,
    status: "Gepland"
  };

  utils().openModal({
    title: opts.title || "Nieuw event",
    size: "large",
    build(body, modal){
      const picker = LachboxOS.crm.buildCustomerPicker({ autofocus: !opts.initialCustomerId, initialCustomerId: opts.initialCustomerId, onChange: v => event.customerId = v });
      body.appendChild(picker.el);
      body.appendChild(utils().fieldRow(
        utils().textField("Eventnaam", event.eventName, v => event.eventName = v, { placeholder: "bijv. Bruiloft Jansen" }),
        utils().textField("Eventtype", event.eventType, v => event.eventType = v, { placeholder: "bijv. Bruiloft" })
      ));
      body.appendChild(utils().fieldRow(
        utils().textField("Datum", event.date, v => event.date = v, { type: "date" }),
        utils().textField("Locatie", event.location, v => event.location = v)
      ));
      const priceField = utils().textField("Prijs (€)", event.price, v => event.price = Number(v) || 0, { type: "number" });
      const packageField = utils().selectField("Pakket", event.package, packageOptions, v => {
        event.package = v;
        const comp = Object.values(settings.components).find(c => c.name === v);
        if (comp){ event.price = comp.price; priceField._input.value = comp.price; }
      });
      body.appendChild(utils().fieldRow(packageField, priceField));

      const footer = utils().make("div", "modal-footer");
      const actions = utils().make("div", "modal-footer-actions");
      const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
      cancelBtn.type = "button";
      cancelBtn.addEventListener("click", () => modal.close());
      const saveBtn = utils().make("button", "btn primary small", opts.saveLabel || "Aanmaken");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        if (!event.customerId){ utils().showToast("Kies of maak eerst een klant.", "error"); return; }
        if (!event.date){ utils().showToast("Vul een datum in.", "error"); return; }
        saveBtn.disabled = true;
        const saved = await storage().saveEvent(event);
        await state().refreshEvents();
        modal.close();
        if (opts.savedToast !== false) utils().showToast(opts.savedToast || "Event aangemaakt.", "success");
        if (onSaved) await onSaved(saved);
      });
      actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
      footer.appendChild(actions);
      body.appendChild(footer);
    }
  });
}

/* ============================================================
   Eventdetailpagina
   ============================================================ */
function renderEventDetailPage(container, params){
  const original = state().cache.events.find(e => e.id === params.id);
  if (!original){
    const page = utils().make("div", "page");
    const back = utils().make("a", "detail-back", "← Terug naar events");
    back.href = "#/events";
    page.appendChild(back);
    page.appendChild(utils().make("div", "empty-hint", "Dit event bestaat niet (meer)."));
    container.appendChild(page);
    return;
  }
  const event = Object.assign({ extras: [], costs: [], discount: 0 }, original, {
    extras: (original.extras || []).map(x => Object.assign({}, x)),
    costs: (original.costs || []).map(x => Object.assign({}, x))
  });
  const customer = state().getCustomerById(event.customerId);
  const settings = state().cache.settings;
  let dirty = false;

  function renderReload(){ utils().clear(container); renderEventDetailPage(container, params); }

  const page = utils().make("div", "page");
  const back = utils().make("a", "detail-back", "← Terug naar events");
  back.href = "#/events";
  page.appendChild(back);

  const header = utils().make("div", "detail-header");
  const titleWrap = utils().make("div");
  titleWrap.appendChild(utils().make("h1", "page-title", event.eventName || event.eventType || "Event"));
  const readiness = checklists().computeChecklistReadiness(state().checklistForEvent(event.id));
  titleWrap.appendChild(utils().make("span", "readiness-pill readiness-" + readiness.level, `${checklists().readinessDot(readiness.level)} ${readiness.percent}% gereed — ${readiness.label}`));
  header.appendChild(titleWrap);
  if (LachboxOS.email && event.customerId){
    const emailBtn = utils().make("button", "btn secondary small", "E-mail");
    emailBtn.type = "button";
    emailBtn.addEventListener("click", () => {
      let templateKey = "boeking_bevestiging";
      if (event.status === "Afgerond") templateKey = "bedankt_na_event";
      else if (event.date){
        const days = utils().daysBetween(utils().todayISO(), event.date);
        if (days != null && days >= 0 && days <= 7) templateKey = "praktische_info";
      }
      LachboxOS.email.openEmailGenerator({ customerId: event.customerId, eventId: event.id, templateKey });
    });
    header.appendChild(emailBtn);
  }
  const delBtn = utils().make("button", "btn danger small", "Event verwijderen");
  delBtn.type = "button";
  delBtn.addEventListener("click", async () => {
    const ok = await utils().askConfirm("Event verwijderen?", "Dit event wordt permanent verwijderd (de checklist ook, gekoppelde facturen blijven bestaan).");
    if (!ok) return;
    if (event.checklistId) await storage().deleteChecklist(event.checklistId);
    await storage().deleteEvent(event.id);
    await Promise.all([state().refreshEvents(), state().refreshChecklists()]);
    utils().showToast("Event verwijderd.", "success");
    nav().navigateTo("events");
  });
  header.appendChild(delBtn);
  page.appendChild(header);

  function markDirty(){ dirty = true; saveBtn.disabled = false; }

  // ---- OVERZICHT ----
  const overview = utils().make("div", "section-card");
  overview.appendChild(utils().make("h2", "section-heading", "Overzicht"));
  overview.appendChild(utils().fieldRow(
    utils().textField("Eventnaam", event.eventName, v => { event.eventName = v; markDirty(); }),
    utils().textField("Eventtype", event.eventType, v => { event.eventType = v; markDirty(); })
  ));
  overview.appendChild(utils().fieldRow(
    utils().textField("Datum", event.date, v => { event.date = v; markDirty(); }, { type: "date" }),
    utils().selectField("Status", event.status, EVENT_STATUSES.map(s => [s, s]), v => { event.status = v; markDirty(); })
  ));
  overview.appendChild(utils().fieldRow(
    utils().textField("Starttijd", event.startTime, v => { event.startTime = v; markDirty(); }, { type: "time" }),
    utils().textField("Eindtijd", event.endTime, v => { event.endTime = v; markDirty(); }, { type: "time" })
  ));
  overview.appendChild(utils().fieldRow(
    utils().textField("Locatie", event.location, v => { event.location = v; markDirty(); }),
    utils().textField("Adres", event.address, v => { event.address = v; markDirty(); })
  ));
  page.appendChild(overview);

  // ---- CONTACT (alleen-lezen, komt van de klant) ----
  const contact = utils().make("div", "section-card");
  contact.appendChild(utils().make("h2", "section-heading", "Contact"));
  if (customer){
    const rows = [
      ["Contactpersoon", customer.contactPerson || "—"],
      ["Telefoon", customer.phone || "—"],
      ["E-mail", customer.email || "—"]
    ];
    rows.forEach(([k,v]) => {
      const row = utils().make("div", "kv-row");
      row.appendChild(utils().make("span", "kv-key", k));
      row.appendChild(utils().make("span", null, v));
      contact.appendChild(row);
    });
    const link = utils().make("a", "detail-back", "Bekijk klant →");
    link.href = "#/crm/customers/" + customer.id;
    link.style.marginTop = "8px";
    contact.appendChild(link);
  } else {
    contact.appendChild(utils().make("div", "empty-hint", "Geen klant gekoppeld."));
  }
  page.appendChild(contact);

  // ---- BOEKING ----
  const booking = utils().make("div", "section-card");
  booking.appendChild(utils().make("h2", "section-heading", "Boeking"));
  const packageOptions = Object.keys(settings.components).map(key => [settings.components[key].name, settings.components[key].name]);
  packageOptions.push(["", "Maatwerk / anders"]);
  const priceField = utils().textField("Prijs (€)", event.price, v => { event.price = Number(v) || 0; markDirty(); updateTotal(); updateCostsTotal(); }, { type: "number" });
  const packageField = utils().selectField("Pakket", event.package, packageOptions, v => {
    event.package = v; markDirty();
    const comp = Object.values(settings.components).find(c => c.name === v);
    if (comp){ event.price = comp.price; priceField._input.value = comp.price; updateTotal(); updateCostsTotal(); }
  });
  booking.appendChild(utils().fieldRow(packageField, priceField));

  booking.appendChild(utils().make("label", null, "Extra's"));
  const extrasList = utils().make("div", "extras-list");
  booking.appendChild(extrasList);
  function renderExtras(){
    utils().clear(extrasList);
    event.extras.forEach((extra, idx) => {
      const row = utils().make("div", "extras-row");
      const labelInput = document.createElement("input");
      labelInput.type = "text"; labelInput.value = extra.label || "";
      labelInput.placeholder = "Omschrijving";
      labelInput.addEventListener("input", () => { extra.label = labelInput.value; markDirty(); });
      const priceInput = document.createElement("input");
      priceInput.type = "number"; priceInput.step = "0.01"; priceInput.value = extra.price || 0;
      priceInput.addEventListener("input", () => { extra.price = Number(priceInput.value) || 0; markDirty(); updateTotal(); updateCostsTotal(); });
      const delExtraBtn = utils().make("button", "icon-btn", "✕");
      delExtraBtn.type = "button";
      delExtraBtn.addEventListener("click", () => { event.extras.splice(idx, 1); markDirty(); updateTotal(); updateCostsTotal(); renderExtras(); });
      row.appendChild(labelInput); row.appendChild(priceInput); row.appendChild(delExtraBtn);
      extrasList.appendChild(row);
    });
  }
  renderExtras();
  const addExtraBtn = utils().make("button", "btn ghost small", "+ extra toevoegen");
  addExtraBtn.type = "button";
  addExtraBtn.addEventListener("click", () => { event.extras.push({ label: "", price: 0 }); markDirty(); renderExtras(); });
  booking.appendChild(addExtraBtn);

  const discountField = utils().textField("Korting (€)", event.discount, v => { event.discount = Number(v) || 0; markDirty(); updateTotal(); updateCostsTotal(); }, { type: "number" });
  booking.appendChild(discountField);

  const totalRow = utils().make("div", "booking-total");
  totalRow.appendChild(utils().make("span", null, "Totale boekingswaarde"));
  const totalValue = utils().make("span", null, "");
  totalRow.appendChild(totalValue);
  booking.appendChild(totalRow);
  function bookingTotal(){
    const extrasSum = event.extras.reduce((s, e) => s + (Number(e.price) || 0), 0);
    return (Number(event.price) || 0) + extrasSum - (Number(event.discount) || 0);
  }
  function updateTotal(){
    totalValue.textContent = utils().formatCurrency(bookingTotal());
  }
  updateTotal();
  page.appendChild(booking);

  // ---- KOSTEN (sectie 6 van het financieel-plan: winst per event) ----
  const costsSection = utils().make("div", "section-card");
  costsSection.appendChild(utils().make("h2", "section-heading", "Kosten"));
  costsSection.appendChild(utils().make("div", "field-hint", "Materiaal, personeel, reiskosten of andere kosten voor dit event — telt mee in de winstberekening op de Financieel-pagina."));
  event.costs = event.costs || [];
  const costsList = utils().make("div", "extras-list");
  costsSection.appendChild(costsList);
  function renderCosts(){
    utils().clear(costsList);
    event.costs.forEach((cost, idx) => {
      const row = utils().make("div", "extras-row");
      const labelInput = document.createElement("input");
      labelInput.type = "text"; labelInput.value = cost.label || "";
      labelInput.placeholder = "Omschrijving (bijv. materiaal, personeel)";
      labelInput.addEventListener("input", () => { cost.label = labelInput.value; markDirty(); });
      const amountInput = document.createElement("input");
      amountInput.type = "number"; amountInput.step = "0.01"; amountInput.value = cost.amount || 0;
      amountInput.addEventListener("input", () => { cost.amount = Number(amountInput.value) || 0; markDirty(); updateCostsTotal(); });
      const delCostBtn = utils().make("button", "icon-btn", "✕");
      delCostBtn.type = "button";
      delCostBtn.addEventListener("click", () => { event.costs.splice(idx, 1); markDirty(); updateCostsTotal(); renderCosts(); });
      row.appendChild(labelInput); row.appendChild(amountInput); row.appendChild(delCostBtn);
      costsList.appendChild(row);
    });
  }
  renderCosts();
  const addCostBtn = utils().make("button", "btn ghost small", "+ kostenpost toevoegen");
  addCostBtn.type = "button";
  addCostBtn.addEventListener("click", () => { event.costs.push({ label: "", amount: 0 }); markDirty(); renderCosts(); });
  costsSection.appendChild(addCostBtn);

  const profitRow = utils().make("div", "booking-total");
  profitRow.appendChild(utils().make("span", null, "Verwachte winst (boekingswaarde − kosten)"));
  const profitValue = utils().make("span", null, "");
  profitRow.appendChild(profitValue);
  costsSection.appendChild(profitRow);
  function updateCostsTotal(){
    const costsSum = event.costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const profit = bookingTotal() - costsSum;
    profitValue.textContent = utils().formatCurrency(profit);
    profitValue.className = profit < 0 ? "cell-danger" : "";
  }
  updateCostsTotal();
  page.appendChild(costsSection);

  const saveBtn = utils().make("button", "btn primary", "Wijzigingen opslaan");
  saveBtn.type = "button";
  saveBtn.disabled = true;
  saveBtn.addEventListener("click", async () => {
    await storage().saveEvent(event);
    await state().refreshEvents();
    utils().showToast("Event opgeslagen.", "success");
    renderReload();
  });
  page.appendChild(saveBtn);

  // ---- ADMINISTRATIE (alleen-lezen) ----
  const admin = utils().make("div", "section-card");
  admin.appendChild(utils().make("h2", "section-heading", "Administratie"));
  const lead = state().leadForEvent(event.leadId);
  const invoice = primaryInvoiceFor(event.id);
  [
    ["Offerte", lead ? lead.status : "Geen gekoppelde lead"],
    ["Factuur", invoice ? (invoice.invoiceNumber || "Concept") + " · " + utils().formatCurrency(invoice.total || 0) : "Nog geen factuur"],
    ["Betaling", invoice ? LachboxOS.invoices.invoiceStatusLabel(invoice) : "—"]
  ].forEach(([k,v]) => {
    const row = utils().make("div", "kv-row");
    row.appendChild(utils().make("span", "kv-key", k));
    row.appendChild(utils().make("span", null, v));
    admin.appendChild(row);
  });
  if (invoice){
    const link = utils().make("a", "detail-back", "Bekijk factuur →");
    link.href = "#/invoices/" + invoice.id;
    link.style.marginTop = "8px";
    admin.appendChild(link);
  } else if (LachboxOS.invoices){
    const makeInvoiceBtn = utils().make("button", "btn secondary small", "Factuur maken");
    makeInvoiceBtn.type = "button";
    makeInvoiceBtn.style.marginTop = "8px";
    makeInvoiceBtn.addEventListener("click", async () => {
      if (!event.customerId){ utils().showToast("Koppel eerst een klant aan dit event.", "error"); return; }
      const created = await LachboxOS.invoices.createInvoiceFromEvent(event);
      nav().navigateTo("invoices/" + created.id);
    });
    admin.appendChild(makeInvoiceBtn);
  }
  page.appendChild(admin);

  // ---- NAZORG ----
  const aftercare = utils().make("div", "section-card");
  aftercare.appendChild(utils().make("h2", "section-heading", "Nazorg"));
  if (LachboxOS.reviews){
    const reviewsApi = LachboxOS.reviews;
    const review = reviewsApi.reviewOrStub(event);
    const row = utils().make("div", "kv-row");
    row.appendChild(utils().make("span", "kv-key", "Review"));
    const controls = utils().make("div", "row-actions");
    const select = document.createElement("select");
    reviewsApi.REVIEW_STATUSES.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = reviewsApi.reviewStatusLabel(s);
      if (s === review.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", async () => {
      await reviewsApi.setReviewStatus(event, select.value);
      utils().showToast("Reviewstatus bijgewerkt.", "success");
      renderReload();
    });
    controls.appendChild(select);
    if (review.status !== "ontvangen" && LachboxOS.email){
      const emailBtn = utils().make("button", "btn secondary small", "Stuur e-mail");
      emailBtn.type = "button";
      const templateKey = (review.status === "niet_gevraagd" || review.status === "verzoek_klaar") ? "review_verzoek" : "review_herinnering";
      emailBtn.addEventListener("click", () => {
        LachboxOS.email.openEmailGenerator({ customerId: event.customerId, eventId: event.id, templateKey });
      });
      controls.appendChild(emailBtn);
    }
    row.appendChild(controls);
    aftercare.appendChild(row);
  }
  aftercare.appendChild(utils().make("div", "field-hint", "Galerij en reviewverzoek staan ook als losse items in de checklist hieronder (categorie \"Na afloop\")."));
  page.appendChild(aftercare);

  // ---- CHECKLIST ----
  const checklistContainer = utils().make("div");
  page.appendChild(checklistContainer);
  checklists().renderChecklistPanel(checklistContainer, event, () => {
    const r = checklists().computeChecklistReadiness(state().checklistForEvent(event.id));
    const pill = titleWrap.querySelector(".readiness-pill");
    if (pill){
      pill.className = "readiness-pill readiness-" + r.level;
      pill.textContent = `${checklists().readinessDot(r.level)} ${r.percent}% gereed — ${r.label}`;
    }
  });

  container.appendChild(page);
}

nav().registerRoute({ path: "events", label: "Events", icon: "▧", group: "Events", render: (c) => renderEventsListPage(c) });
nav().registerRoute({ path: "events/:id", render: (c, params) => renderEventDetailPage(c, params) });

LachboxOS.events = { openEventCreateModal };

})();
