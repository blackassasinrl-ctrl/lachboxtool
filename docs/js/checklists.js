/* ============================================================
   LACHBOX OS — CHECKLISTS
   Sjablonen (Basis/Premium/Deluxe), gereedheidsscore en het
   herbruikbare checklist-paneel (afvinken/toevoegen/verwijderen/
   aanpassen) dat events.js in de eventdetailpagina inbedt.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const storage = () => LachboxOS.storage;
const state = () => LachboxOS.state;

// "key: true" items tellen mee voor de gereedheidsscore (sectie 13:
// Factuur, Betaling, Design, Personeel, Materiaal, Locatie).
const BASE_CATEGORIES = [
  { name: "Administratie", items: [
    { label: "Offerte geaccepteerd" },
    { label: "Factuur gemaakt", key: true },
    { label: "Betaling gecontroleerd", key: true }
  ]},
  { name: "Klant", items: [
    { label: "Contactpersoon bevestigd" },
    { label: "Telefoonnummer gecontroleerd" },
    { label: "Tijden bevestigd" },
    { label: "Locatie bevestigd", key: true }
  ]},
  { name: "Design", items: [
    { label: "Fotostrip ontvangen" },
    { label: "Fotostrip gemaakt", key: true },
    { label: "Klant akkoord" }
  ]},
  { name: "Apparatuur", items: [
    { label: "Photobooth", key: true },
    { label: "Camera" }, { label: "Scherm" }, { label: "Printer" },
    { label: "Laptop/computer" }, { label: "Stroomkabels" },
    { label: "Verlengkabel" }, { label: "Stekkerdoos" }
  ]},
  { name: "Print", items: [
    { label: "Printerpapier" }, { label: "Cartridge/inkt" }, { label: "Reservepapier" }
  ]},
  { name: "Event", items: [
    { label: "Props" }, { label: "Achterwand" }, { label: "Rode loper" }, { label: "Paaltjes" }
  ]},
  { name: "Logistiek", items: [
    { label: "Transport geregeld" }, { label: "Adres gecontroleerd" },
    { label: "Parkeerinformatie" }, { label: "Opbouwtijd bekend" }
  ]},
  { name: "Personeel", items: [
    { label: "Medewerker toegewezen", key: true }, { label: "Medewerker geïnformeerd" }
  ]},
  { name: "Na afloop", items: [
    { label: "Apparatuur gecontroleerd" }, { label: "Galerij verstuurd" }, { label: "Reviewverzoek gestuurd" }
  ]}
];

// Premium/Deluxe voegen automatisch extra items toe aan bestaande categorieën.
const TEMPLATE_EXTRAS = {
  basis: [],
  premium: [
    { category: "Print", label: "Onbeperkt printen gecontroleerd" },
    { category: "Event", label: "Extra rekwisieten" }
  ],
  deluxe: [
    { category: "Print", label: "Onbeperkt printen gecontroleerd" },
    { category: "Event", label: "Extra rekwisieten" },
    { category: "Event", label: "VIP-decor gecontroleerd" },
    { category: "Personeel", label: "Extra medewerker ingepland" }
  ]
};
const TEMPLATE_LABELS = { basis: "Basis", premium: "Premium", deluxe: "Deluxe" };

function generateChecklistFromTemplate(templateKey, eventId){
  const categories = BASE_CATEGORIES.map(cat => ({
    name: cat.name,
    items: cat.items.map(it => ({ id: utils().uuid(), label: it.label, done: false, key: !!it.key }))
  }));
  (TEMPLATE_EXTRAS[templateKey] || []).forEach(extra => {
    const cat = categories.find(c => c.name === extra.category);
    if (cat) cat.items.push({ id: utils().uuid(), label: extra.label, done: false, key: false });
  });
  return { id: utils().uuid(), eventId: eventId || null, template: templateKey, categories };
}

// Percentage + niveau, gebaseerd op de "key"-items (sectie 13). Valt terug op
// alle items als een checklist geen enkel key-item meer heeft (bv. verwijderd).
function computeChecklistReadiness(checklist){
  if (!checklist) return { percent: 0, level: "red", label: "Geen checklist" };
  const allItems = checklist.categories.flatMap(c => c.items);
  let pool = allItems.filter(i => i.key);
  if (pool.length === 0) pool = allItems;
  if (pool.length === 0) return { percent: 0, level: "red", label: "Leeg" };
  const done = pool.filter(i => i.done).length;
  const percent = Math.round((done / pool.length) * 100);
  const level = percent >= 90 ? "green" : (percent >= 50 ? "orange" : "red");
  const label = level === "green" ? "Gereed" : (level === "orange" ? "Aandacht nodig" : "Niet gereed");
  return { percent, level, label };
}

function readinessDot(level){
  return level === "green" ? "🟢" : (level === "orange" ? "🟠" : "🔴");
}

/* ---------- Herbruikbaar checklist-paneel ---------- */
// Rendert direct in `container`; roept onChanged() aan na elke opslag zodat
// de aanroeper (events.js) bv. de gereedheidsscore kan verversen.
function renderChecklistPanel(container, event, onChanged){
  utils().clear(container);

  const existing = state().checklistForEvent(event.id);
  if (!existing){
    const box = utils().make("div", "section-card");
    box.appendChild(utils().make("h2", "section-heading", "Checklist"));
    box.appendChild(utils().make("div", "empty-hint", "Nog geen checklist voor dit event. Genereer er één op basis van een pakket-sjabloon."));
    const btnRow = utils().make("div", "data-actions");
    ["basis", "premium", "deluxe"].forEach(key => {
      const btn = utils().make("button", "btn secondary small", "Genereer " + TEMPLATE_LABELS[key]);
      btn.type = "button";
      btn.addEventListener("click", async () => {
        const checklist = generateChecklistFromTemplate(key, event.id);
        await storage().saveChecklist(checklist);
        event.checklistId = checklist.id;
        await storage().saveEvent(event);
        await Promise.all([state().refreshChecklists(), state().refreshEvents()]);
        utils().showToast(`${TEMPLATE_LABELS[key]}-checklist aangemaakt.`, "success");
        renderChecklistPanel(container, event, onChanged);
        if (onChanged) onChanged();
      });
      btnRow.appendChild(btn);
    });
    box.appendChild(btnRow);
    container.appendChild(box);
    return;
  }

  const checklist = existing;
  const box = utils().make("div", "section-card");
  const heading = utils().make("div", "section-heading-row");
  heading.appendChild(utils().make("h2", "section-heading", "Checklist (" + (TEMPLATE_LABELS[checklist.template] || "aangepast") + ")"));
  const readiness = computeChecklistReadiness(checklist);
  heading.appendChild(utils().make("span", "readiness-pill readiness-" + readiness.level, `${readinessDot(readiness.level)} ${readiness.percent}% — ${readiness.label}`));
  box.appendChild(heading);

  async function persist(){
    await storage().saveChecklist(checklist);
    await state().refreshChecklists();
    if (onChanged) onChanged();
  }

  checklist.categories.forEach(cat => {
    const catBox = utils().make("div", "checklist-category");
    catBox.appendChild(utils().make("div", "checklist-category-title", cat.name));
    const list = utils().make("div", "checklist-items");

    cat.items.forEach(item => {
      const row = utils().make("div", "checklist-item" + (item.key ? " checklist-item-key" : ""));
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!item.done;
      checkbox.addEventListener("change", async () => {
        item.done = checkbox.checked;
        await persist();
        const pill = heading.querySelector(".readiness-pill");
        const r = computeChecklistReadiness(checklist);
        pill.className = "readiness-pill readiness-" + r.level;
        pill.textContent = `${readinessDot(r.level)} ${r.percent}% — ${r.label}`;
      });
      row.appendChild(checkbox);

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "checklist-item-label";
      labelInput.value = item.label;
      labelInput.addEventListener("change", async () => { item.label = labelInput.value; await persist(); });
      row.appendChild(labelInput);

      const delBtn = utils().make("button", "icon-btn", "✕");
      delBtn.type = "button";
      delBtn.addEventListener("click", async () => {
        cat.items = cat.items.filter(i => i.id !== item.id);
        await persist();
        renderChecklistPanel(container, event, onChanged);
      });
      row.appendChild(delBtn);

      list.appendChild(row);
    });
    catBox.appendChild(list);

    const addBtn = utils().make("button", "btn ghost small", "+ item");
    addBtn.type = "button";
    addBtn.addEventListener("click", async () => {
      cat.items.push({ id: utils().uuid(), label: "Nieuw item", done: false, key: false });
      await persist();
      renderChecklistPanel(container, event, onChanged);
    });
    catBox.appendChild(addBtn);

    box.appendChild(catBox);
  });

  container.appendChild(box);
}

LachboxOS.checklists = {
  TEMPLATE_LABELS,
  generateChecklistFromTemplate, computeChecklistReadiness, readinessDot,
  renderChecklistPanel
};

})();
