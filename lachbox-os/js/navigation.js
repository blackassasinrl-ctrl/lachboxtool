/* ============================================================
   LACHBOX OS — NAVIGATION
   Hash-router zonder afhankelijkheden + sidebar-rendering. Modules
   registreren zichzelf via registerRoute(); alleen wat daadwerkelijk
   geregistreerd (dus: werkend gebouwd) is verschijnt in de sidebar —
   geen dode links naar nog niet gebouwde onderdelen (zie sectie 38
   van het bouwplan: geen nepknoppen).

   Ondersteunt simpele parameter-routes zoals "events/:id".
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;

const routes = []; // { path, label, icon, group, render }
let currentCleanup = null;

function registerRoute(route){
  if (!route.path || typeof route.render !== "function"){
    throw new Error("registerRoute vereist minimaal { path, render }");
  }
  routes.push(route);
}

function matchRoute(hashPath){
  const hashSegments = hashPath.split("/").filter(Boolean);
  for (const route of routes){
    const routeSegments = route.path.split("/").filter(Boolean);
    if (routeSegments.length !== hashSegments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < routeSegments.length; i++){
      const rs = routeSegments[i], hs = hashSegments[i];
      if (rs.startsWith(":")){
        params[rs.slice(1)] = decodeURIComponent(hs);
      } else if (rs !== hs){
        ok = false; break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

function currentHashPath(){
  return (location.hash || "").replace(/^#\/?/, "");
}

async function handleRouteChange(){
  const path = currentHashPath();
  let match = matchRoute(path);
  if (!match && routes.length){
    // Onbekende/lege route: terug naar de eerste geregistreerde (dashboard).
    location.hash = "#/" + routes[0].path;
    return;
  }
  if (!match) return;

  if (typeof currentCleanup === "function"){
    try{ currentCleanup(); }catch(e){ console.error(e); }
    currentCleanup = null;
  }

  const container = utils().el("appContent");
  utils().clear(container);
  renderSidebar(match.route.path);

  try{
    const cleanup = await match.route.render(container, match.params);
    if (typeof cleanup === "function") currentCleanup = cleanup;
  }catch(e){
    console.error("Fout bij renderen van route " + match.route.path, e);
    utils().showToast("Er ging iets mis bij het laden van dit scherm.", "error");
  }
}

function navigateTo(path){
  location.hash = "#/" + path;
}

function renderSidebar(activePath){
  const nav = utils().el("sidebarNav");
  if (!nav) return;
  utils().clear(nav);

  // Groepeer op route.group (null = los bovenaan) in registratievolgorde.
  const groups = [];
  const groupIndex = {};
  routes.forEach(route => {
    const key = route.group || "__ungrouped__";
    if (!(key in groupIndex)){
      groupIndex[key] = groups.length;
      groups.push({ name: route.group || null, items: [] });
    }
    groups[groupIndex[key]].items.push(route);
  });

  groups.forEach(group => {
    if (group.name){
      nav.appendChild(utils().make("div", "sidebar-group-label", group.name));
    }
    group.items.forEach(route => {
      const link = document.createElement("a");
      link.href = "#/" + route.path;
      link.className = "sidebar-link" + (route.path === activePath ? " active" : "");
      if (route.icon){
        const icon = utils().make("span", "sidebar-icon", route.icon);
        icon.setAttribute("aria-hidden", "true");
        link.appendChild(icon);
      }
      link.appendChild(document.createTextNode(route.label));
      nav.appendChild(link);
    });
  });
}

function init(){
  window.addEventListener("hashchange", handleRouteChange);
  handleRouteChange();
}

LachboxOS.navigation = { registerRoute, navigateTo, init, renderSidebar };

})();
