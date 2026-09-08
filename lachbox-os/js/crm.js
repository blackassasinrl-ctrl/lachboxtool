/* ============================================================
   LACHBOX OS — CRM
   Leads (tabel + kanban, drag-and-drop) en Klanten (zoeken, detail
   met gekoppelde leads/events/facturen/reviews). Zie secties 7-9 van
   het bouwplan. Een gewonnen lead kan direct een Event-record
   aanmaken (sectie 8) — de volledige eventdetailpagina/checklist komt
   in Milestone 3, maar het aanmaken van het record zelf hoeft daar
   niet op te wachten (storage.js kan dit al sinds Milestone 1).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const storage = () => LachboxOS.storage;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;

const LEAD_STATUSES = ["Nieuw", "Contact opnemen", "Contact gehad", "Offerte maken", "Offerte verstuurd", "Opvolgen", "Gewonnen", "Verloren"];
const KANBAN_COLUMNS = [
  { key: "nieuw", title: "Nieuw", statuses: ["Nieuw"], dropStatus: "Nieuw" },
  { key: "contact", title: "Contact", statuses: ["Contact opnemen", "Contact gehad"], dropStatus: "Contact opnemen" },
  { key: "offerte", title: "Offerte", statuses: ["Offerte maken", "Offerte verstuurd"], dropStatus: "Offerte maken" },
  { key: "opvolgen", title: "Opvolgen", statuses: ["Opvolgen"], dropStatus: "Opvolgen" },
  { key: "gewonnen", title: "Gewonnen", statuses: ["Gewonnen"], dropStatus: "Gewonnen" },
  { key: "verloren", title: "Verloren", statuses: ["Verloren"], dropStatus: "Verloren" }
];
const LEAD_VIEW_PREF_KEY = "lachbox_os_leads_view"; // localStorage: UI-voorkeur, geen bedrijfsdata

function leadStatusBadgeClass(status){
  if (status === "Gewonnen") return "badge-success";
  if (status === "Verloren") return "badge-danger";
  if (status === "Opvolgen") return "badge-warning";
  return "badge-info";
}

/* ============================================================
   Klant-picker — herbruikbaar overal waar een klant gekoppeld moet
   worden (leads nu, events/facturen later). Zoekt live in de cache,
   biedt "nieuwe klant aanmaken" aan zodra er geen match is (sectie 8:
   geen dubbele klanten aanmaken als er al een bestaat).
   ============================================================ */
function buildCustomerPicker(opts){
  opts = opts || {};
  let selectedId = opts.initialCustomerId || null;

  const wrap = utils().make("div", "field customer-picker");
  wrap.appendChild(utils().make("label", null, opts.label || "Klant"));
  const slot = utils().make("div");
  wrap.appendChild(slot);

  function renderSelected(){
    utils().clear(slot);
    const customer = selectedId ? state().getCustomerById(selectedId) : null;
    if (opts.onChange) opts.onChange(selectedId);

    if (customer){
      const box = utils().make("div", "customer-picker-selected");
      const nameBits = [state().customerDisplayName(customer)];
      if (customer.company && customer.contactPerson) nameBits.push("— " + customer.contactPerson);
      box.appendChild(utils().make("span", null, nameBits.join(" ")));
      const changeBtn = utils().make("button", "icon-btn", "Wijzigen");
      changeBtn.type = "button";
      changeBtn.addEventListener("click", () => { selectedId = null; renderSelected(); });
      box.appendChild(changeBtn);
      slot.appendChild(box);
      return;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Zoek op naam, bedrijf, e-mail of plaats…";
    slot.appendChild(input);
    const results = utils().make("div", "customer-picker-results");
    results.hidden = true;
    slot.appendChild(results);

    function showResults(){
      const q = input.value.trim().toLowerCase();
      utils().clear(results);
      const matches = state().cache.customers.filter(c => {
        if (!q) return true;
        const hay = [c.company, c.contactPerson, c.email, c.city].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      }).slice(0, 8);

      matches.forEach(c => {
        const item = utils().make("div", "customer-picker-item");
        item.appendChild(utils().make("div", null, state().customerDisplayName(c)));
        const subBits = [c.company && c.contactPerson ? c.contactPerson : null, c.city].filter(Boolean).join(" · ");
        if (subBits) item.appendChild(utils().make("div", "cp-sub", subBits));
        item.addEventListener("mousedown", (e) => { e.preventDefault(); selectedId = c.id; renderSelected(); });
        results.appendChild(item);
      });

      if (q){
        const createItem = utils().make("div", "customer-picker-item cp-create", `+ Nieuwe klant "${input.value.trim()}" aanmaken`);
        createItem.addEventListener("mousedown", async (e) => {
          e.preventDefault();
          const customer = await storage().saveCustomer({
            company: "", contactPerson: input.value.trim(), street: "", houseNumber: "",
            postalCode: "", city: "", country: "Nederland", email: "", phone: "", notes: ""
          });
          await state().refreshCustomers();
          selectedId = customer.id;
          utils().showToast("Klant aangemaakt.", "success");
          renderSelected();
        });
        results.appendChild(createItem);
      }
      results.hidden = false;
    }

    input.addEventListener("focus", showResults);
    input.addEventListener("input", showResults);
    input.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 150));
    if (opts.autofocus) setTimeout(() => input.focus(), 30);
  }

  renderSelected();
  return { el: wrap, getValue: () => selectedId };
}

/* ============================================================
   Lead: aanmaken/bewerken (modal) + Lead -> Event ("Boeking aanmaken")
   ============================================================ */
function openLeadModal(existingLead, onSaved){
  const isEdit = !!existingLead;
  const lead = existingLead ? Object.assign({}, existingLead) : {
    id: null, customerId: null, source: "", status: "Nieuw", requestedPackage: "",
    estimatedValue: 0, eventDate: "", eventType: "", eventLocation: "", notes: "", nextAction: "",
    createdAt: utils().todayISO(), lastContactAt: utils().todayISO()
  };
  const settings = state().cache.settings;
  const packageOptions = Object.keys(settings.components).map(key => [key, settings.components[key].name]);
  packageOptions.push(["", "Maatwerk / anders"]);

  utils().openModal({
    title: isEdit ? "Lead bewerken" : "Nieuwe lead",
    size: "large",
    build(body, modal){
      const picker = buildCustomerPicker({ initialCustomerId: lead.customerId, autofocus: !isEdit, onChange: v => lead.customerId = v });
      body.appendChild(picker.el);

      body.appendChild(utils().fieldRow(
        utils().selectField("Status", lead.status, LEAD_STATUSES.map(s => [s, s]), v => { lead.status = v; }),
        utils().textField("Bron", lead.source, v => lead.source = v, { placeholder: "bijv. Website, Instagram" })
      ));

      const valueField = utils().textField("Geschatte waarde (€)", lead.estimatedValue, v => lead.estimatedValue = Number(v) || 0, { type: "number" });
      const packageField = utils().selectField("Gewenst pakket", lead.requestedPackage, packageOptions, v => {
        lead.requestedPackage = v;
        if (settings.components[v]){
          lead.estimatedValue = settings.components[v].price;
          valueField._input.value = lead.estimatedValue;
        }
      });
      body.appendChild(utils().fieldRow(packageField, valueField));

      body.appendChild(utils().fieldRow(
        utils().textField("Eventdatum", lead.eventDate, v => lead.eventDate = v, { type: "date" }),
        utils().textField("Eventtype", lead.eventType, v => lead.eventType = v, { placeholder: "bijv. Bruiloft" })
      ));
      body.appendChild(utils().fieldRow(
        utils().textField("Eventlocatie", lead.eventLocation, v => lead.eventLocation = v),
        utils().textField("Laatste contact", lead.lastContactAt, v => lead.lastContactAt = v, { type: "date" })
      ));
      body.appendChild(utils().textField("Volgende actie", lead.nextAction, v => lead.nextAction = v, { placeholder: "bijv. Bellen over offerte" }));
      body.appendChild(utils().textField("Notities", lead.notes, v => lead.notes = v, { textarea: true, rows: 3 }));

      const footer = utils().make("div", "modal-footer");
      if (isEdit){
        const delBtn = utils().make("button", "btn danger small", "Verwijderen");
        delBtn.type = "button";
        delBtn.addEventListener("click", async () => {
          const ok = await utils().askConfirm("Lead verwijderen?", "Deze lead wordt permanent verwijderd.");
          if (!ok) return;
          await storage().deleteLead(lead.id);
          await state().refreshLeads();
          modal.close();
          utils().showToast("Lead verwijderd.", "success");
          if (onSaved) onSaved();
        });
        footer.appendChild(delBtn);
      }
      const actions = utils().make("div", "modal-footer-actions");
      const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
      cancelBtn.type = "button";
      cancelBtn.addEventListener("click", () => modal.close());
      const saveBtn = utils().make("button", "btn primary small", "Opslaan");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        if (!lead.customerId){
          utils().showToast("Kies of maak eerst een klant.", "error");
          return;
        }
        await storage().saveLead(lead);
        await state().refreshLeads();
        modal.close();
        utils().showToast(isEdit ? "Lead bijgewerkt." : "Lead aangemaakt.", "success");
        if (onSaved) onSaved();
      });
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      footer.appendChild(actions);
      body.appendChild(footer);
    }
  });
}

function eventAlreadyExistsForLead(leadId){
  return state().cache.events.some(e => e.leadId === leadId);
}

async function createEventFromLead(lead, onDone){
  const customer = state().getCustomerById(lead.customerId);
  if (!customer){ utils().showToast("Klant niet gevonden.", "error"); return; }

  if (!lead.eventDate){
    // Vraag alleen het ontbrekende gegeven, niet het hele formulier opnieuw.
    utils().openModal({
      title: "Eventdatum ontbreekt",
      build(body, modal){
        body.appendChild(utils().make("p", null, "Voor de boeking is een eventdatum nodig. Vul deze aan om de boeking aan te maken."));
        let dateValue = "";
        body.appendChild(utils().textField("Eventdatum", "", v => dateValue = v, { type: "date" }));
        const footer = utils().make("div", "modal-footer");
        const actions = utils().make("div", "modal-footer-actions");
        const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
        cancelBtn.type = "button";
        cancelBtn.addEventListener("click", () => modal.close());
        const okBtn = utils().make("button", "btn primary small", "Boeking aanmaken");
        okBtn.type = "button";
        okBtn.addEventListener("click", async () => {
          if (!dateValue){ utils().showToast("Vul een eventdatum in.", "error"); return; }
          lead.eventDate = dateValue;
          await storage().saveLead(lead);
          await state().refreshLeads();
          modal.close();
          await actuallyCreateEvent(lead, customer, onDone);
        });
        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        footer.appendChild(actions);
        body.appendChild(footer);
      }
    });
    return;
  }
  await actuallyCreateEvent(lead, customer, onDone);
}

async function actuallyCreateEvent(lead, customer, onDone){
  const settings = state().cache.settings;
  const comp = settings.components[lead.requestedPackage];
  const event = {
    customerId: lead.customerId,
    leadId: lead.id,
    eventName: (lead.eventType || "Event") + (customer ? " " + (customer.company || customer.contactPerson || "") : ""),
    eventType: lead.eventType || "",
    date: lead.eventDate,
    startTime: "", endTime: "",
    location: lead.eventLocation || "",
    address: "",
    package: comp ? comp.name : (lead.requestedPackage || ""),
    price: Number(lead.estimatedValue) || (comp ? comp.price : 0),
    extras: [], staff: "", notes: "",
    checklistId: null, invoiceId: null,
    status: "Gepland"
  };
  await storage().saveEvent(event);
  await state().refreshEvents();
  utils().showToast("Boeking aangemaakt — te zien op het dashboard bij aankomende events.", "success");
  if (onDone) onDone();
}

/* ============================================================
   Leads-pagina (tabel + kanban)
   ============================================================ */
function renderLeadsPage(container){
  const page = utils().make("div", "page");

  const header = utils().make("div", "page-header");
  header.appendChild(utils().make("h1", "page-title", "Leads"));
  const newBtn = utils().make("button", "btn primary", "+ Nieuwe lead");
  newBtn.type = "button";
  newBtn.addEventListener("click", () => openLeadModal(null, refresh));
  header.appendChild(newBtn);
  page.appendChild(header);

  const toolbar = utils().make("div", "toolbar");
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "search-input";
  searchInput.placeholder = "Zoek op klant, eventtype of locatie…";
  toolbar.appendChild(searchInput);
  toolbar.appendChild(utils().make("div", "spacer"));

  const viewToggle = utils().make("div", "view-toggle");
  const tableBtn = utils().make("button", null, "Tabel");
  const kanbanBtn = utils().make("button", null, "Kanban");
  tableBtn.type = "button"; kanbanBtn.type = "button";
  viewToggle.appendChild(tableBtn);
  viewToggle.appendChild(kanbanBtn);
  toolbar.appendChild(viewToggle);
  page.appendChild(toolbar);

  const content = utils().make("div");
  page.appendChild(content);
  container.appendChild(page);

  let view = localStorage.getItem(LEAD_VIEW_PREF_KEY) || "table";

  function matchingLeads(){
    const q = searchInput.value.trim().toLowerCase();
    return state().cache.leads.filter(lead => {
      if (!q) return true;
      const customer = state().getCustomerById(lead.customerId);
      const hay = [state().customerDisplayName(customer), lead.eventType, lead.eventLocation, lead.source].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function setView(v){
    view = v;
    localStorage.setItem(LEAD_VIEW_PREF_KEY, v);
    tableBtn.classList.toggle("active", v === "table");
    kanbanBtn.classList.toggle("active", v === "kanban");
    renderContent();
  }
  tableBtn.addEventListener("click", () => setView("table"));
  kanbanBtn.addEventListener("click", () => setView("kanban"));
  searchInput.addEventListener("input", renderContent);

  function renderContent(){
    utils().clear(content);
    const leads = matchingLeads();
    if (view === "table") content.appendChild(buildLeadsTable(leads, refresh));
    else content.appendChild(buildLeadsKanban(leads, refresh));
  }

  function refresh(){ renderContent(); }

  setView(view);
}

function buildLeadsTable(leads, onChanged){
  if (leads.length === 0){
    return utils().make("div", "empty-hint", "Geen leads gevonden.");
  }
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Klant", "Status", "Eventdatum", "Type", "Locatie", "Pakket", "Waarde", "Laatste contact", ""].forEach(h => {
    headRow.appendChild(utils().make("th", null, h));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  leads.slice().sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")).forEach(lead => {
    const customer = state().getCustomerById(lead.customerId);
    const settings = state().cache.settings;
    const comp = settings.components[lead.requestedPackage];
    const tr = document.createElement("tr");

    tr.appendChild(utils().make("td", null, state().customerDisplayName(customer) || "—"));

    const statusTd = document.createElement("td");
    statusTd.appendChild(utils().make("span", "badge " + leadStatusBadgeClass(lead.status), lead.status));
    tr.appendChild(statusTd);

    tr.appendChild(utils().make("td", "cell-muted", lead.eventDate ? utils().formatDateDisplay(lead.eventDate) : "—"));
    tr.appendChild(utils().make("td", "cell-muted", lead.eventType || "—"));
    tr.appendChild(utils().make("td", "cell-muted", lead.eventLocation || "—"));
    tr.appendChild(utils().make("td", null, comp ? comp.name : (lead.requestedPackage || "—")));
    tr.appendChild(utils().make("td", "cell-num", utils().formatCurrency(lead.estimatedValue || 0)));
    tr.appendChild(utils().make("td", "cell-muted", lead.lastContactAt ? utils().formatDateDisplay(lead.lastContactAt) : "—"));

    const actionTd = document.createElement("td");
    if (lead.status === "Gewonnen"){
      if (eventAlreadyExistsForLead(lead.id)){
        actionTd.appendChild(utils().make("span", "badge badge-success", "Boeking gemaakt"));
      } else {
        const bookBtn = utils().make("button", "btn secondary small", "Boeking aanmaken");
        bookBtn.type = "button";
        bookBtn.addEventListener("click", (e) => { e.stopPropagation(); createEventFromLead(lead, onChanged); });
        actionTd.appendChild(bookBtn);
      }
    }
    tr.appendChild(actionTd);

    tr.addEventListener("click", () => openLeadModal(lead, onChanged));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildLeadsKanban(leads, onChanged){
  const board = utils().make("div", "kanban-board");
  KANBAN_COLUMNS.forEach(col => {
    const column = utils().make("div", "kanban-column");
    column.dataset.columnKey = col.key;
    const title = utils().make("div", "kanban-column-title");
    title.appendChild(utils().make("span", null, col.title));
    const colLeads = leads.filter(l => col.statuses.includes(l.status));
    title.appendChild(utils().make("span", null, String(colLeads.length)));
    column.appendChild(title);

    colLeads.forEach(lead => {
      const customer = state().getCustomerById(lead.customerId);
      const card = utils().make("div", "kanban-card");
      card.draggable = true;
      card.appendChild(utils().make("div", "kanban-card-name", state().customerDisplayName(customer) || "Naamloze lead"));
      const metaBits = [lead.eventType, lead.eventDate ? utils().formatDateDisplay(lead.eventDate) : null].filter(Boolean).join(" · ");
      if (metaBits) card.appendChild(utils().make("div", "kanban-card-meta", metaBits));
      if (lead.estimatedValue) card.appendChild(utils().make("div", "kanban-card-value", utils().formatCurrency(lead.estimatedValue)));

      card.addEventListener("click", () => openLeadModal(lead, onChanged));
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      column.appendChild(card);
    });

    column.addEventListener("dragover", (e) => { e.preventDefault(); column.classList.add("drag-over"); });
    column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
    column.addEventListener("drop", async (e) => {
      e.preventDefault();
      column.classList.remove("drag-over");
      const leadId = e.dataTransfer.getData("text/plain");
      const lead = state().cache.leads.find(l => l.id === leadId);
      if (!lead || col.statuses.includes(lead.status)) return;
      lead.status = col.dropStatus;
      lead.lastContactAt = utils().todayISO();
      await storage().saveLead(lead);
      await state().refreshLeads();
      utils().showToast(`Status gewijzigd naar "${col.dropStatus}".`, "success");
      onChanged();
    });

    board.appendChild(column);
  });
  return board;
}

/* ============================================================
   Klanten: lijst + detail
   ============================================================ */
function openCustomerQuickCreateModal(onSaved){
  const customer = { company: "", contactPerson: "", street: "", houseNumber: "", postalCode: "", city: "", country: "Nederland", email: "", phone: "", notes: "" };
  utils().openModal({
    title: "Nieuwe klant",
    build(body, modal){
      body.appendChild(utils().fieldRow(
        utils().textField("Bedrijfsnaam / organisatie", customer.company, v => customer.company = v),
        utils().textField("Contactpersoon", customer.contactPerson, v => customer.contactPerson = v)
      ));
      body.appendChild(utils().fieldRow(
        utils().textField("E-mailadres", customer.email, v => customer.email = v, { type: "email" }),
        utils().textField("Telefoonnummer", customer.phone, v => customer.phone = v)
      ));
      body.appendChild(utils().fieldRow(
        utils().textField("Plaats", customer.city, v => customer.city = v),
        utils().textField("Land", customer.country, v => customer.country = v)
      ));
      const footer = utils().make("div", "modal-footer");
      const actions = utils().make("div", "modal-footer-actions");
      const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
      cancelBtn.type = "button";
      cancelBtn.addEventListener("click", () => modal.close());
      const saveBtn = utils().make("button", "btn primary small", "Aanmaken");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        if (!customer.company.trim() && !customer.contactPerson.trim()){
          utils().showToast("Vul minimaal een bedrijfsnaam of contactpersoon in.", "error");
          return;
        }
        const saved = await storage().saveCustomer(customer);
        await state().refreshCustomers();
        modal.close();
        utils().showToast("Klant aangemaakt.", "success");
        if (onSaved) onSaved(saved);
      });
      actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
      footer.appendChild(actions);
      body.appendChild(footer);
    }
  });
}

function renderCustomersListPage(container){
  const page = utils().make("div", "page");
  const header = utils().make("div", "page-header");
  header.appendChild(utils().make("h1", "page-title", "Klanten"));
  const newBtn = utils().make("button", "btn primary", "+ Nieuwe klant");
  newBtn.type = "button";
  newBtn.addEventListener("click", () => openCustomerQuickCreateModal(c => nav().navigateTo("crm/customers/" + c.id)));
  header.appendChild(newBtn);
  page.appendChild(header);

  const toolbar = utils().make("div", "toolbar");
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "search-input";
  searchInput.placeholder = "Zoek op naam, organisatie, e-mail, plaats of telefoon…";
  toolbar.appendChild(searchInput);
  page.appendChild(toolbar);

  const content = utils().make("div");
  page.appendChild(content);
  container.appendChild(page);

  function render(){
    const q = searchInput.value.trim().toLowerCase();
    const customers = state().cache.customers.filter(c => {
      if (!q) return true;
      const hay = [c.company, c.contactPerson, c.email, c.city, c.phone].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).sort((a,b) => state().customerDisplayName(a).localeCompare(state().customerDisplayName(b)));

    utils().clear(content);
    if (customers.length === 0){
      content.appendChild(utils().make("div", "empty-hint", "Geen klanten gevonden."));
      return;
    }
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Naam", "Contactpersoon", "Plaats", "E-mail", "Telefoon", "Omzet"].forEach(h => headRow.appendChild(utils().make("th", null, h)));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    customers.forEach(c => {
      const tr = document.createElement("tr");
      tr.appendChild(utils().make("td", null, c.company || c.contactPerson || "—"));
      tr.appendChild(utils().make("td", "cell-muted", c.company ? c.contactPerson || "—" : "—"));
      tr.appendChild(utils().make("td", "cell-muted", c.city || "—"));
      tr.appendChild(utils().make("td", "cell-muted", c.email || "—"));
      tr.appendChild(utils().make("td", "cell-muted", c.phone || "—"));
      tr.appendChild(utils().make("td", "cell-num", utils().formatCurrency(state().customerRevenueTotal(c.id))));
      tr.addEventListener("click", () => nav().navigateTo("crm/customers/" + c.id));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
  }

  searchInput.addEventListener("input", render);
  render();
}

function renderCustomerDetailPage(container, params){
  const original = state().getCustomerById(params.id);
  if (!original){
    const page = utils().make("div", "page");
    page.appendChild(utils().make("div", "empty-hint", "Deze klant bestaat niet (meer)."));
    const back = utils().make("a", "detail-back", "← Terug naar klanten");
    back.href = "#/crm/customers";
    page.insertBefore(back, page.firstChild);
    container.appendChild(page);
    return;
  }
  const customer = Object.assign({}, original);
  let dirty = false;

  const page = utils().make("div", "page");
  const back = utils().make("a", "detail-back", "← Terug naar klanten");
  back.href = "#/crm/customers";
  page.appendChild(back);

  const header = utils().make("div", "detail-header");
  header.appendChild(utils().make("h1", "page-title", state().customerDisplayName(customer)));
  const delBtn = utils().make("button", "btn danger small", "Klant verwijderen");
  delBtn.type = "button";
  delBtn.addEventListener("click", async () => {
    const ok = await utils().askConfirm("Klant verwijderen?", "Deze klant wordt permanent verwijderd.");
    if (!ok) return;
    try{
      await storage().deleteCustomer(customer.id);
      await state().refreshCustomers();
      utils().showToast("Klant verwijderd.", "success");
      nav().navigateTo("crm/customers");
    }catch(e){
      utils().showToast(e.message, "error");
    }
  });
  header.appendChild(delBtn);
  page.appendChild(header);

  // ---- Statistieken ----
  const leads = state().leadsForCustomer(customer.id);
  const events = state().eventsForCustomer(customer.id);
  const invoices = state().invoicesForCustomer(customer.id);
  const reviews = state().reviewsForCustomer(customer.id);
  const lastContactDates = leads.map(l => l.lastContactAt).filter(Boolean).sort();
  const lastContact = lastContactDates.length ? lastContactDates[lastContactDates.length - 1] : null;

  const stats = utils().make("div", "detail-stats");
  function stat(label, value){
    const box = utils().make("div", "detail-stat");
    box.appendChild(utils().make("div", "detail-stat-label", label));
    box.appendChild(utils().make("div", "detail-stat-value", value));
    return box;
  }
  stats.appendChild(stat("Totale omzet", utils().formatCurrency(state().customerRevenueTotal(customer.id))));
  stats.appendChild(stat("Events", String(events.length)));
  stats.appendChild(stat("Facturen", String(invoices.length)));
  stats.appendChild(stat("Reviews", String(reviews.length)));
  stats.appendChild(stat("Laatste contact", lastContact ? utils().formatDateDisplay(lastContact) : "—"));
  page.appendChild(stats);

  // ---- Klantgegevens (bewerkbaar) ----
  const infoSection = utils().make("div", "section-card");
  infoSection.appendChild(utils().make("h2", "section-heading", "Klantgegevens"));
  function markDirty(){ dirty = true; saveBtn.disabled = false; }
  infoSection.appendChild(utils().fieldRow(
    utils().textField("Bedrijfsnaam / organisatie", customer.company, v => { customer.company = v; markDirty(); }),
    utils().textField("Contactpersoon", customer.contactPerson, v => { customer.contactPerson = v; markDirty(); })
  ));
  infoSection.appendChild(utils().fieldRow(
    utils().textField("Straat", customer.street, v => { customer.street = v; markDirty(); }),
    utils().textField("Huisnummer", customer.houseNumber, v => { customer.houseNumber = v; markDirty(); })
  ));
  infoSection.appendChild(utils().fieldRow(
    utils().textField("Postcode", customer.postalCode, v => { customer.postalCode = v; markDirty(); }),
    utils().textField("Plaats", customer.city, v => { customer.city = v; markDirty(); })
  ));
  infoSection.appendChild(utils().fieldRow(
    utils().textField("E-mailadres", customer.email, v => { customer.email = v; markDirty(); }, { type: "email" }),
    utils().textField("Telefoonnummer", customer.phone, v => { customer.phone = v; markDirty(); })
  ));
  infoSection.appendChild(utils().textField("Notities", customer.notes, v => { customer.notes = v; markDirty(); }, { textarea: true, rows: 3 }));
  const saveBtn = utils().make("button", "btn primary small", "Wijzigingen opslaan");
  saveBtn.type = "button";
  saveBtn.disabled = true;
  saveBtn.addEventListener("click", async () => {
    await storage().saveCustomer(customer);
    await state().refreshCustomers();
    dirty = false;
    saveBtn.disabled = true;
    utils().showToast("Klantgegevens opgeslagen.", "success");
  });
  infoSection.appendChild(saveBtn);
  page.appendChild(infoSection);

  // ---- Gekoppelde data ----
  const columns = utils().make("div", "detail-columns");

  const leadsPanel = utils().make("div", "panel");
  leadsPanel.appendChild(utils().make("div", "panel-title", "Leads"));
  if (leads.length === 0){
    leadsPanel.appendChild(utils().make("div", "empty-hint", "Nog geen leads voor deze klant."));
  } else {
    const list = utils().make("div", "related-list");
    leads.forEach(lead => {
      const row = utils().make("div", "related-row");
      row.appendChild(utils().make("span", null, (lead.eventType || "Lead") + (lead.eventDate ? " · " + utils().formatDateDisplay(lead.eventDate) : "")));
      row.appendChild(utils().make("span", "badge " + leadStatusBadgeClass(lead.status), lead.status));
      row.style.cursor = "pointer";
      row.addEventListener("click", () => openLeadModal(lead, renderReload));
      list.appendChild(row);
    });
    leadsPanel.appendChild(list);
  }
  columns.appendChild(leadsPanel);

  const eventsPanel = utils().make("div", "panel");
  eventsPanel.appendChild(utils().make("div", "panel-title", "Events"));
  if (events.length === 0){
    eventsPanel.appendChild(utils().make("div", "empty-hint", "Nog geen events voor deze klant."));
  } else {
    const list = utils().make("div", "related-list");
    events.slice().sort((a,b) => (a.date||"").localeCompare(b.date||"")).forEach(ev => {
      const row = utils().make("div", "related-row");
      row.appendChild(utils().make("span", null, (ev.eventName || ev.eventType || "Event") + (ev.date ? " · " + utils().formatDateDisplay(ev.date) : "")));
      row.appendChild(utils().make("span", "badge badge-info", ev.status || "Gepland"));
      list.appendChild(row);
    });
    eventsPanel.appendChild(list);
  }
  columns.appendChild(eventsPanel);

  const invoicesPanel = utils().make("div", "panel");
  invoicesPanel.appendChild(utils().make("div", "panel-title", "Facturen"));
  if (invoices.length === 0){
    invoicesPanel.appendChild(utils().make("div", "empty-hint", "Nog geen facturen voor deze klant."));
  } else {
    const list = utils().make("div", "related-list");
    invoices.slice().sort((a,b) => (b.issueDate||"").localeCompare(a.issueDate||"")).forEach(inv => {
      const row = utils().make("div", "related-row");
      row.appendChild(utils().make("span", null, (inv.invoiceNumber || "Concept") + " · " + utils().formatCurrency(inv.total || 0)));
      const cls = inv.paymentStatus === "betaald" ? "badge-success" : (inv.paymentStatus === "verstuurd" ? "badge-warning" : "badge-info");
      row.appendChild(utils().make("span", "badge " + cls, inv.paymentStatus));
      list.appendChild(row);
    });
    invoicesPanel.appendChild(list);
  }
  columns.appendChild(invoicesPanel);

  const reviewsPanel = utils().make("div", "panel");
  reviewsPanel.appendChild(utils().make("div", "panel-title", "Reviews"));
  if (reviews.length === 0){
    reviewsPanel.appendChild(utils().make("div", "empty-hint", "Nog geen reviews voor deze klant."));
  } else {
    const list = utils().make("div", "related-list");
    reviews.forEach(r => {
      const row = utils().make("div", "related-row");
      row.appendChild(utils().make("span", null, r.platform || "Review"));
      const cls = r.status === "ontvangen" ? "badge-success" : (r.status === "niet_gevraagd" ? "badge-info" : "badge-warning");
      row.appendChild(utils().make("span", "badge " + cls, r.status.replace(/_/g, " ")));
      list.appendChild(row);
    });
    reviewsPanel.appendChild(list);
  }
  columns.appendChild(reviewsPanel);

  page.appendChild(columns);
  container.appendChild(page);

  function renderReload(){
    utils().clear(container);
    renderCustomerDetailPage(container, params);
  }
}

nav().registerRoute({ path: "crm/leads", label: "Leads", icon: "◔", group: "CRM", render: (c) => renderLeadsPage(c) });
nav().registerRoute({ path: "crm/customers", label: "Klanten", icon: "▤", group: "CRM", render: (c) => renderCustomersListPage(c) });
// :id-route: geen sidebar-item (navigation.js sluit :param-routes uit van de sidebar).
nav().registerRoute({ path: "crm/customers/:id", render: (c, params) => renderCustomerDetailPage(c, params) });

LachboxOS.crm = { openLeadModal, openCustomerQuickCreateModal, buildCustomerPicker };

})();
