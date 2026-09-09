/* ============================================================
   LACHBOX OS — E-MAIL
   Sjabloongenerator (sectie 20-ish van het bouwplan: communicatie).
   Geen backend, dus geen "versturen"-knop die iets voorspiegelt wat
   niet gebeurt (sectie 38: geen nepfunctionaliteit) — in plaats
   daarvan vult dit scherm een sjabloon met echte klant/event/factuur-
   gegevens en biedt het "Kopiëren naar klembord" en "Open in
   e-mailprogramma" (mailto:) aan, zodat Mats het zelf verstuurt vanuit
   zijn eigen mailbox.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;

/* ---------- Openen vanuit een andere pagina (event/klant/factuur) ----------
   Andere modules roepen LachboxOS.email.openEmailGenerator({customerId,
   eventId, invoiceId, leadId, templateKey}) aan; deze module navigeert
   naar zijn eigen route en pakt de context daar op (de router kent geen
   querystrings, dus dit gaat via een simpele module-variabele). */
let pendingContext = null;
function openEmailGenerator(ctx){
  pendingContext = ctx || {};
  nav().navigateTo("communicatie/email");
}

/* ---------- Kleine tekst-hulpjes ---------- */
function firstName(customer){
  if (!customer) return "";
  const src = (customer.contactPerson || customer.company || "").trim();
  return src ? src.split(/\s+/)[0] : "";
}
function greeting(customer){
  const naam = firstName(customer);
  return naam ? `Beste ${naam},` : "Beste,";
}
function orPlaceholder(value, placeholder){
  return value ? value : `[${placeholder}]`;
}
function occasionOf(ctx){
  return (ctx.lead && ctx.lead.eventType) || (ctx.event && (ctx.event.eventType || ctx.event.eventName)) || "";
}
function companyOf(settings){ return (settings && settings.company) || {}; }
function emailSettingsOf(settings){ return (settings && settings.email) || {}; }

/* ---------- Handtekening ----------
   Sjablonen zijn platte tekst (mailto: en klembord ondersteunen geen
   HTML/afbeeldingen), dus hier komt alleen de afsluiting + naam onder
   te staan — geen herhaling van telefoon/e-mail/adres, want die staan
   al in de volledige (echte) handtekening met logo die hieronder op
   deze pagina te zien is, en die je eenmalig instelt in Outlook/Gmail
   (zie Instellingen > E-mailhandtekening) zodat hij er dan altijd
   automatisch bij staat.
   De naam is die van de ingelogde gebruiker (zie auth.js: elk teamlid
   tekent met zijn eigen naam, niet met een gedeelde "Team Lachbox").
   Alleen de eerste regel van "Standaard afsluiting e-mail" wordt
   gebruikt, zodat een oude, nu overbodige naam op regel 2 van dat veld
   niet nog eens verschijnt naast de naam van de inlogger. */
function buildSignature(settings){
  const emailSettings = emailSettingsOf(settings);
  const closing = (emailSettings.signOff || "Met vriendelijke groet,").split("\n")[0].trim();
  const signerName = utils().currentSenderName(settings);
  return `${closing}\n\n${signerName}`;
}

/* ---------- Context opbouwen uit de cache (sel = {customerId,eventId,invoiceId,leadId}) ---------- */
function buildContext(sel){
  sel = sel || {};
  const s = state();
  const settings = s.cache.settings || {};
  const customer = sel.customerId ? s.getCustomerById(sel.customerId) : null;
  const event = sel.eventId ? s.cache.events.find(e => e.id === sel.eventId) : null;
  const invoice = sel.invoiceId ? s.cache.invoices.find(i => i.id === sel.invoiceId) : null;
  const lead = sel.leadId ? s.cache.leads.find(l => l.id === sel.leadId) : null;
  return { customer, event, invoice, lead, settings };
}

/* ============================================================
   Sjablonen — elk krijgt de volledige context en geeft {subject, body}
   terug. Ontbrekende gegevens worden nooit stilletjes "undefined":
   ze krijgen een duidelijke [placeholder] zodat je meteen ziet wat je
   nog moet invullen.
   ============================================================ */
function tplLeadReactie(ctx){
  const c = ctx.customer;
  const occasion = occasionOf(ctx);
  const dateISO = (ctx.lead && ctx.lead.eventDate) || (ctx.event && ctx.event.date);
  const dateBit = dateISO ? ` op ${utils().formatDateLong(dateISO)}` : "";
  return {
    subject: `Jouw aanvraag bij Lachbox${occasion ? " - " + occasion : ""}`,
    body: `${greeting(c)}

Hartelijk dank voor je aanvraag bij Lachbox. Fijn dat je een photobooth overweegt${occasion ? " voor je " + occasion.toLowerCase() : ""}${dateBit}.

Zou je ons willen laten weten wat de locatie is en welk pakket je voorkeur heeft (de Mirrorbooth is bij elk pakket inbegrepen)? Dan stellen we graag een passende offerte voor je op.

${buildSignature(ctx.settings)}`
  };
}

function tplOfferte(ctx){
  const c = ctx.customer, l = ctx.lead;
  const occasion = occasionOf(ctx) || "je evenement";
  const dateISO = (l && l.eventDate) || (ctx.event && ctx.event.date);
  const dateBit = orPlaceholder(dateISO ? utils().formatDateLong(dateISO) : null, "datum");
  const location = orPlaceholder(l && l.eventLocation, "locatie");
  const pakket = orPlaceholder(l && LachboxOS.crm && LachboxOS.crm.leadPackageSummary(l, ctx.settings), "pakket");
  const prijs = l && l.estimatedValue ? utils().formatCurrency(l.estimatedValue) : "[bedrag]";
  return {
    subject: `Offerte Lachbox voor ${occasion}`,
    body: `${greeting(c)}

Hierbij ontvang je graag de offerte voor ${occasion} op ${dateBit} in ${location}:

Pakket: ${pakket}
Prijs: ${prijs} (inclusief btw, opbouw en afbouw)

Laat je ons weten of dit aansluit bij je wensen? Dan leggen we de datum graag voor je vast.

${buildSignature(ctx.settings)}`
  };
}

function tplLeadOpvolgen(ctx){
  const c = ctx.customer;
  const occasion = occasionOf(ctx);
  return {
    subject: "Nog interesse in Lachbox?",
    body: `${greeting(c)}

Enige tijd geleden spraken we over een photobooth via Lachbox${occasion ? " voor " + occasion.toLowerCase() : ""}. Graag horen we of je hier nog interesse in hebt.

Heb je nog vragen over de offerte, of moet er iets worden aangepast? Laat het ons gerust weten.

${buildSignature(ctx.settings)}`
  };
}

function tplBoekingBevestiging(ctx){
  const c = ctx.customer, ev = ctx.event;
  const naamBit = ev ? (ev.eventName || ev.eventType || "je event") : "je event";
  const dateBit = orPlaceholder(ev && ev.date ? utils().formatDateLong(ev.date) : null, "datum");
  const tijdBit = ev && ev.startTime ? ev.startTime + (ev.endTime ? " - " + ev.endTime : "") : "[tijd]";
  const locatie = orPlaceholder(ev && ev.location, "locatie");
  const pakket = orPlaceholder(ev && ev.package, "pakket");
  const prijs = ev && ev.price ? utils().formatCurrency(ev.price) : "[bedrag]";
  return {
    subject: `Boeking bevestigd - ${naamBit}`,
    body: `${greeting(c)}

Je boeking is definitief bevestigd. Hieronder de gegevens op een rij:

Datum: ${dateBit}
Tijd: ${tijdBit}
Locatie: ${locatie}
Pakket: ${pakket}
Prijs: ${prijs}

Zodra het event dichterbij komt, ontvang je van ons nog de praktische informatie. Heb je in de tussentijd vragen? Neem gerust contact met ons op.

${buildSignature(ctx.settings)}`
  };
}

function tplPraktischeInfo(ctx){
  const c = ctx.customer, ev = ctx.event, company = companyOf(ctx.settings);
  const dateBit = orPlaceholder(ev && ev.date ? utils().formatDateLong(ev.date) : null, "datum");
  const tijdBit = ev && ev.startTime ? `we bouwen ruim voor ${ev.startTime} op` : "[aankomsttijd]";
  const locatie = orPlaceholder(ev && ev.location, "locatie");
  const senderName = orPlaceholder(emailSettingsOf(ctx.settings).senderName, "naam");
  const senderEmail = orPlaceholder(company.email, "e-mailadres");
  return {
    subject: `Praktische info voor ${ev && ev.date ? utils().formatDateDisplay(ev.date) : "je event"}`,
    body: `${greeting(c)}

Hierbij graag de praktische informatie voor het event op ${dateBit}:

Opbouw: ${tijdBit}
Locatie: ${locatie}
Contactpersoon op de dag zelf: ${senderName} (${senderEmail})

Mocht er onderweg nog iets wijzigen (parkeren, ingang, contactpersoon ter plekke), laat het ons dan gerust tijdig weten.

We kijken ernaar uit!

${buildSignature(ctx.settings)}`
  };
}

function tplFactuurVersturen(ctx){
  const c = ctx.customer, inv = ctx.invoice, company = companyOf(ctx.settings);
  const nummer = orPlaceholder(inv && inv.invoiceNumber, "factuurnummer");
  const bedrag = inv ? utils().formatCurrency(inv.total || 0) : "[bedrag]";
  const vervalBit = orPlaceholder(inv && inv.dueDate ? utils().formatDateLong(inv.dueDate) : null, "vervaldatum");
  const iban = orPlaceholder(company.iban, "IBAN");
  const kenmerk = orPlaceholder(inv && (inv.reference || inv.invoiceNumber), "factuurnummer");
  return {
    subject: `Factuur ${nummer}`,
    body: `${greeting(c)}

Hierbij ontvang je factuur ${nummer} voor een bedrag van ${bedrag}.

Wij verzoeken je vriendelijk dit bedrag vóór ${vervalBit} over te maken naar ${iban}, onder vermelding van ${kenmerk}.

${buildSignature(ctx.settings)}`
  };
}

function tplBetalingsherinnering(ctx){
  const c = ctx.customer, inv = ctx.invoice, company = companyOf(ctx.settings);
  const nummer = orPlaceholder(inv && inv.invoiceNumber, "factuurnummer");
  const bedrag = inv ? utils().formatCurrency(inv.total || 0) : "[bedrag]";
  const dueLong = inv && inv.dueDate ? utils().formatDateLong(inv.dueDate) : null;
  const daysOver = inv && inv.dueDate ? utils().daysBetween(inv.dueDate, utils().todayISO()) : null;
  const overdueText = (daysOver != null && daysOver > 0)
    ? `sinds ${dueLong} (${daysOver} dag${daysOver === 1 ? "" : "en"}) verlopen`
    : (dueLong ? `en verloopt op ${dueLong}` : "nog open");
  const iban = orPlaceholder(company.iban, "IBAN");
  const kenmerk = orPlaceholder(inv && (inv.reference || inv.invoiceNumber), "factuurnummer");
  return {
    subject: `Herinnering: factuur ${nummer} nog openstaand`,
    body: `${greeting(c)}

Graag vragen we vriendelijk je aandacht voor het volgende: factuur ${nummer} van ${bedrag} staat nog open, ${overdueText}.

Zou je het bedrag alsnog willen overmaken naar ${iban}, onder vermelding van ${kenmerk}? Mocht de factuur onbedoeld zijn blijven liggen, of speelt er iets anders, laat het ons dan gerust weten.

${buildSignature(ctx.settings)}`
  };
}

function tplBedanktNaEvent(ctx){
  const c = ctx.customer, ev = ctx.event;
  const naamBit = ev ? (ev.eventName || ev.eventType || "het event") : "het event";
  const dateBit = ev && ev.date ? " op " + utils().formatDateLong(ev.date) : "";
  return {
    subject: "Bedankt namens Lachbox!",
    body: `${greeting(c)}

Hartelijk dank voor je vertrouwen in Lachbox! We hebben met veel plezier meegewerkt aan ${naamBit}${dateBit}.

De foto's worden zo snel mogelijk beschikbaar gesteld via een online galerij. Zodra deze klaarstaat, ontvang je de link van ons.

${buildSignature(ctx.settings)}`
  };
}

function tplReviewVerzoek(ctx){
  const c = ctx.customer, ev = ctx.event;
  const naamBit = ev ? (ev.eventName || ev.eventType || "de boeking") : "de boeking";
  const url = (ctx.settings.reviews && ctx.settings.reviews.googleReviewUrl) || "";
  const linkBit = url || "[Google review-link nog invullen bij Instellingen > Reviews & e-mail]";
  return {
    subject: "Zou je een review willen achterlaten?",
    body: `${greeting(c)}

Nogmaals hartelijk dank voor ${naamBit}! Zou je ons enorm helpen door een korte review achter te laten?

${linkBit}

Alvast hartelijk dank voor de moeite.

${buildSignature(ctx.settings)}`
  };
}

function tplReviewHerinnering(ctx){
  const c = ctx.customer, ev = ctx.event;
  const naamBit = ev ? (ev.eventName || ev.eventType || "het event") : "het event";
  const url = (ctx.settings.reviews && ctx.settings.reviews.googleReviewUrl) || "";
  const linkBit = url || "[Google review-link nog invullen bij Instellingen > Reviews & e-mail]";
  return {
    subject: "Nog even een reminder - review Lachbox",
    body: `${greeting(c)}

Eerder vroegen we of je een review wilde achterlaten na ${naamBit}. Mocht dit er nog niet van zijn gekomen: het kost je slechts een minuutje en helpt ons enorm.

${linkBit}

${buildSignature(ctx.settings)}`
  };
}

function tplAlgemeen(ctx){
  const c = ctx.customer;
  return {
    subject: "Bericht van Lachbox",
    body: `${greeting(c)}



${buildSignature(ctx.settings)}`
  };
}

const TEMPLATES = [
  { key: "lead_reactie", label: "Eerste reactie op aanvraag", category: "Lead", build: tplLeadReactie },
  { key: "offerte", label: "Offerte versturen", category: "Lead", build: tplOfferte },
  { key: "lead_opvolgen", label: "Lead opvolgen (geen reactie)", category: "Lead", build: tplLeadOpvolgen },
  { key: "boeking_bevestiging", label: "Boeking bevestigen", category: "Boeking", build: tplBoekingBevestiging },
  { key: "praktische_info", label: "Praktische info vooraf", category: "Boeking", build: tplPraktischeInfo },
  { key: "factuur_versturen", label: "Factuur versturen", category: "Facturatie", build: tplFactuurVersturen },
  { key: "betalingsherinnering", label: "Betalingsherinnering", category: "Facturatie", build: tplBetalingsherinnering },
  { key: "bedankt_na_event", label: "Bedankt na het event", category: "Nazorg", build: tplBedanktNaEvent },
  { key: "review_verzoek", label: "Review-verzoek", category: "Nazorg", build: tplReviewVerzoek },
  { key: "review_herinnering", label: "Review-herinnering", category: "Nazorg", build: tplReviewHerinnering },
  { key: "algemeen", label: "Algemeen bericht", category: "Overig", build: tplAlgemeen }
];

/* ---------- Klembord + mailto ---------- */
async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }catch(e2){ return false; }
  }
}
function buildMailto(customer, subject, body){
  const to = customer && customer.email ? encodeURIComponent(customer.email) : "";
  return `mailto:${to}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;
}

/* ============================================================
   Generatorpagina
   ============================================================ */
function renderEmailGeneratorPage(container){
  const ctxSel = { customerId: null, eventId: null, invoiceId: null, leadId: null };
  Object.assign(ctxSel, pendingContext || {});
  let activeTemplateKey = (pendingContext && pendingContext.templateKey) || TEMPLATES[0].key;
  pendingContext = null;

  let subjectDirty = false, bodyDirty = false;
  let manualSubject = "", manualBody = "";

  const page = utils().make("div", "page");
  page.appendChild(utils().make("h1", "page-title", "E-mail opstellen"));

  const grid = utils().make("div", "invoice-editor-grid");
  const formCol = utils().make("div", "invoice-editor-form");
  const previewCol = utils().make("div", "invoice-editor-preview");
  grid.appendChild(formCol); grid.appendChild(previewCol);
  page.appendChild(grid);
  container.appendChild(page);

  // ---- Voorbeeld-kolom staat hier al, vóór de klant-picker verderop:
  // die roept zijn onChange-callback synchroon aan tijdens het bouwen,
  // dus refreshPreview() moet al kunnen draaien (zelfde patroon/valkuil
  // als de factuureditor uit Milestone 4). ----
  const previewPanel = utils().make("div", "section-card");
  previewPanel.appendChild(utils().make("h2", "section-heading", "Voorbeeld"));
  const toRow = utils().make("div", "kv-row");
  toRow.appendChild(utils().make("span", "kv-key", "Aan"));
  const toValue = utils().make("span", null, "Kies eerst een klant");
  toRow.appendChild(toValue);
  previewPanel.appendChild(toRow);
  const subjectField = utils().textField("Onderwerp", "", v => { manualSubject = v; subjectDirty = true; });
  previewPanel.appendChild(subjectField);
  const bodyField = utils().textField("Bericht", "", v => { manualBody = v; bodyDirty = true; }, { textarea: true, rows: 16 });
  previewPanel.appendChild(bodyField);
  const previewActions = utils().make("div", "btn-row");
  const copyBtn = utils().make("button", "btn secondary small", "Kopiëren naar klembord");
  copyBtn.type = "button";
  const mailBtn = utils().make("a", "btn primary small", "Open in e-mailprogramma");
  previewActions.appendChild(copyBtn); previewActions.appendChild(mailBtn);
  previewPanel.appendChild(previewActions);
  previewCol.appendChild(previewPanel);

  // ---- Volledige handtekening (met logo) ----
  // De tekst hierboven eindigt bewust alleen met de afsluiting + naam
  // (geen herhaling van telefoon/e-mail/adres). Dit is hoe de complete
  // handtekening eruitziet zodra je 'm instelt in Outlook of Gmail (zie
  // Instellingen > E-mailhandtekening) — die verschijnt dan automatisch
  // onder dit bericht, dus dit is puur ter voorbeeld/controle.
  const signaturePanel = utils().make("div", "section-card");
  signaturePanel.appendChild(utils().make("h2", "section-heading", "Volledige handtekening"));
  signaturePanel.appendChild(utils().make("div", "field-hint", "Zo ziet je handtekening eruit zodra je 'm instelt in Outlook of Gmail (Instellingen > E-mailhandtekening) — die verschijnt dan automatisch onder dit bericht."));
  const signatureBox = utils().make("div", "signature-preview");
  signatureBox.appendChild(utils().buildEmailSignatureNode(state().cache.settings));
  signaturePanel.appendChild(signatureBox);
  previewCol.appendChild(signaturePanel);

  copyBtn.addEventListener("click", async () => {
    const text = manualSubject ? `${manualSubject}\n\n${manualBody}` : manualBody;
    const ok = await copyToClipboard(text);
    utils().showToast(ok ? "Gekopieerd naar klembord." : "Kopiëren is niet gelukt. Selecteer de tekst handmatig.", ok ? "success" : "error");
  });

  function currentCtx(){ return buildContext(ctxSel); }

  function refreshPreview(){
    const ctx = currentCtx();
    toValue.textContent = ctx.customer ? (ctx.customer.email || "(geen e-mailadres bekend bij deze klant)") : "Kies eerst een klant";
    const tpl = TEMPLATES.find(t => t.key === activeTemplateKey) || TEMPLATES[0];
    const rendered = tpl.build(ctx);
    if (!subjectDirty){ manualSubject = rendered.subject; subjectField._input.value = manualSubject; }
    if (!bodyDirty){ manualBody = rendered.body; bodyField._input.value = manualBody; }
    mailBtn.href = buildMailto(ctx.customer, manualSubject, manualBody);
  }

  // ---- Context: klant + optioneel event/factuur/lead ----
  const contextSection = utils().make("div", "section-card");
  contextSection.appendChild(utils().make("h2", "section-heading", "Aan wie?"));
  contextSection.appendChild(utils().make("div", "field-hint", "Kies een klant en eventueel een event, factuur of lead — het sjabloon vult zich dan met de echte gegevens."));
  const relatedSlot = utils().make("div");
  contextSection.appendChild(relatedSlot);

  // ---- Factuur-bijlage ----
  // mailto: en "Kopiëren naar klembord" kunnen geen bestanden meebrengen
  // — dat is een harde beperking van mailto zelf, geen keuze van deze
  // app, en gaat pas echt weg met de Microsoft 365-koppeling (Fase 8c),
  // waar de factuur automatisch als bijlage meegestuurd kan worden. Tot
  // die tijd: één klik om de factuur-PDF vast te downloaden, zodat je
  // 'm alleen nog handmatig hoeft aan te hangen in je mailprogramma.
  function invoiceForContext(){
    return ctxSel.invoiceId ? state().cache.invoices.find(i => i.id === ctxSel.invoiceId) : null;
  }
  async function downloadLinkedInvoicePdf(){
    const invoice = invoiceForContext();
    const customer = state().getCustomerById(ctxSel.customerId);
    if (!invoice || !customer) return;
    const event = invoice.eventId ? state().cache.events.find(e => e.id === invoice.eventId) : null;
    const settings = state().cache.settings;
    const company = Object.assign({}, settings.company, { defaultPaymentTermDays: settings.invoicing.defaultPaymentTermDays });
    try{
      await LachboxOS.invoices.downloadInvoicePdf(invoice, customer, event, company);
    }catch(e){
      utils().showToast("PDF genereren is niet gelukt: " + e.message, "error");
    }
  }
  const invoiceAttachmentSlot = utils().make("div");
  contextSection.appendChild(invoiceAttachmentSlot);

  function renderRelatedSelectors(){
    utils().clear(relatedSlot);
    utils().clear(invoiceAttachmentSlot);
    if (!ctxSel.customerId) return;
    const events = state().eventsForCustomer(ctxSel.customerId).slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
    const invoices = state().invoicesForCustomer(ctxSel.customerId).slice().sort((a,b) => (b.issueDate||"").localeCompare(a.issueDate||""));
    const leads = state().leadsForCustomer(ctxSel.customerId);

    if (!events.some(e => e.id === ctxSel.eventId)) ctxSel.eventId = events.length === 1 ? events[0].id : null;
    const eventOptions = [["", "Geen event gekoppeld"]].concat(events.map(e => [e.id, (e.eventName || e.eventType || "Event") + (e.date ? " · " + utils().formatDateDisplay(e.date) : "")]));
    relatedSlot.appendChild(utils().selectField("Event", ctxSel.eventId || "", eventOptions, v => { ctxSel.eventId = v || null; refreshPreview(); }));

    if (!invoices.some(i => i.id === ctxSel.invoiceId)) ctxSel.invoiceId = invoices.length === 1 ? invoices[0].id : null;
    const invoiceOptions = [["", "Geen factuur gekoppeld"]].concat(invoices.map(i => [i.id, (i.invoiceNumber || "Concept") + " · " + utils().formatCurrency(i.total || 0)]));
    relatedSlot.appendChild(utils().selectField("Factuur", ctxSel.invoiceId || "", invoiceOptions, v => { ctxSel.invoiceId = v || null; refreshPreview(); renderInvoiceAttachment(); }));

    if (!leads.some(l => l.id === ctxSel.leadId)) ctxSel.leadId = leads.length === 1 ? leads[0].id : null;
    const leadOptions = [["", "Geen lead gekoppeld"]].concat(leads.map(l => [l.id, (l.eventType || "Lead") + " · " + l.status]));
    relatedSlot.appendChild(utils().selectField("Lead", ctxSel.leadId || "", leadOptions, v => { ctxSel.leadId = v || null; refreshPreview(); }));

    renderInvoiceAttachment();
  }

  function renderInvoiceAttachment(){
    utils().clear(invoiceAttachmentSlot);
    const invoice = invoiceForContext();
    if (!invoice) return;
    invoiceAttachmentSlot.appendChild(utils().make("div", "field-hint", `Deze factuur wordt NIET automatisch bijgevoegd — mailto/kopiëren kan geen bestanden meesturen. Download 'm hier en hang 'm daarna zelf aan in je mailprogramma.`));
    const dlBtn = utils().make("button", "btn secondary small", `Download factuur ${invoice.invoiceNumber || "(concept)"} (PDF)`);
    dlBtn.type = "button";
    dlBtn.addEventListener("click", downloadLinkedInvoicePdf);
    invoiceAttachmentSlot.appendChild(dlBtn);
  }

  const picker = LachboxOS.crm.buildCustomerPicker({
    label: "Klant",
    initialCustomerId: ctxSel.customerId,
    onChange: v => { ctxSel.customerId = v; renderRelatedSelectors(); refreshPreview(); }
  });
  contextSection.insertBefore(picker.el, relatedSlot);
  formCol.appendChild(contextSection);

  // ---- Sjabloonkeuze ----
  const templateSection = utils().make("div", "section-card");
  templateSection.appendChild(utils().make("h2", "section-heading", "Sjabloon"));
  const templateList = utils().make("div", "template-list");
  const templateButtons = {};
  const categories = [];
  TEMPLATES.forEach(t => { if (!categories.includes(t.category)) categories.push(t.category); });
  categories.forEach(cat => {
    templateList.appendChild(utils().make("div", "template-list-group-label", cat));
    TEMPLATES.filter(t => t.category === cat).forEach(t => {
      const btn = utils().make("button", "template-list-item", t.label);
      btn.type = "button";
      btn.addEventListener("click", () => selectTemplate(t.key));
      templateButtons[t.key] = btn;
      templateList.appendChild(btn);
    });
  });
  templateSection.appendChild(templateList);
  formCol.appendChild(templateSection);

  function updateTemplateButtons(){
    TEMPLATES.forEach(t => templateButtons[t.key].classList.toggle("active", t.key === activeTemplateKey));
  }
  function selectTemplate(key){
    activeTemplateKey = key;
    subjectDirty = false; bodyDirty = false;
    updateTemplateButtons();
    refreshPreview();
  }

  updateTemplateButtons();
  refreshPreview();
}

nav().registerRoute({ path: "communicatie/email", label: "E-mail", icon: "email", group: "Communicatie", render: (c) => renderEmailGeneratorPage(c) });

LachboxOS.email = { openEmailGenerator, TEMPLATES, buildContext };

})();
