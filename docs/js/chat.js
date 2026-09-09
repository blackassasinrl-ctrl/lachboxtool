/* ============================================================
   LACHBOX OS — TEAMCHAT
   Eén gedeeld kanaal (geen aparte threads per klant/lead/event) —
   past bij een team van 3 en is met de bestaande architectuur (RLS +
   Realtime, zie state.js/storage.js) meteen live. Berichten staan
   los van backup/restore/demodata (zie storage.js) — een gespreks-
   geschiedenis hoort niet zomaar mee te gaan bij een restore.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const state = () => LachboxOS.state;
const storage = () => LachboxOS.storage;
const nav = () => LachboxOS.navigation;

function myDisplayName(){
  return (LachboxOS.auth && LachboxOS.auth.displayName && LachboxOS.auth.displayName()) || "";
}

function formatChatTime(iso){
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderChatPage(container){
  const page = utils().make("div", "page chat-page");
  page.appendChild(utils().make("h1", "page-title", "Teamchat"));

  const chatCard = utils().make("div", "section-card chat-card");
  const messageList = utils().make("div", "chat-messages");
  chatCard.appendChild(messageList);

  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.placeholder = "Typ een bericht... (Enter verstuurt, Shift+Enter voor een nieuwe regel)";
  chatCard.appendChild(utils().buildMentionButtons(name => utils().insertMentionAtCursor(textarea, name)));

  const inputRow = utils().make("div", "chat-input-row");
  inputRow.appendChild(textarea);
  const sendBtn = utils().make("button", "btn primary", "Versturen");
  sendBtn.type = "button";
  inputRow.appendChild(sendBtn);
  chatCard.appendChild(inputRow);

  page.appendChild(chatCard);
  container.appendChild(page);

  function renderMessages(){
    utils().clear(messageList);
    const messages = state().cache.messages;
    if (!messages.length){
      messageList.appendChild(utils().make("div", "empty-hint", "Nog geen berichten. Begin het gesprek!"));
      return;
    }
    const myName = myDisplayName();
    messages.forEach(msg => {
      const row = utils().make("div", "chat-message");
      const head = utils().make("div", "chat-message-head");
      head.appendChild(utils().make("span", "chat-message-sender", msg.senderName || "Onbekend"));
      head.appendChild(utils().make("span", "chat-message-time", formatChatTime(msg.createdAt)));
      if (myName && msg.senderName === myName){
        const delBtn = utils().make("button", "chat-message-delete", "×");
        delBtn.type = "button";
        delBtn.title = "Bericht verwijderen";
        delBtn.addEventListener("click", async () => {
          try{ await storage().deleteMessage(msg.id); await state().refreshMessages(); }
          catch(e){ utils().showToast("Verwijderen is niet gelukt: " + e.message, "error"); }
        });
        head.appendChild(delBtn);
      }
      row.appendChild(head);
      const body = utils().make("div", "chat-message-body");
      body.appendChild(utils().renderTextWithMentions(msg.body));
      row.appendChild(body);
      messageList.appendChild(row);
    });
    messageList.scrollTop = messageList.scrollHeight;
  }

  async function sendMessage(){
    const body = textarea.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    try{
      await storage().saveMessage({ body, senderName: myDisplayName() || "Onbekend" });
      textarea.value = "";
      await state().refreshMessages();
    }catch(e){
      utils().showToast("Versturen is niet gelukt: " + e.message, "error");
    }finally{
      sendBtn.disabled = false;
      textarea.focus();
    }
  }
  sendBtn.addEventListener("click", sendMessage);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });

  renderMessages();
  state().refreshMessages().catch(e => utils().showToast("Berichten laden mislukt: " + e.message, "error"));
  return state().on("messages:changed", renderMessages);
}

nav().registerRoute({ path: "communicatie/chat", label: "Chat", icon: "💬", group: "Communicatie", render: (c) => renderChatPage(c) });

})();
