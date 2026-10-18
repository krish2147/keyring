(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const LS_KEY = "keyring.vault.v1";
  const LAST_BACKUP = "keyring.lastBackup";
  const ITER = 310000;
  let stored = null;            // encrypted blob {v,salt,iv,ct,updatedAt}
  let key = null, salt = null, entries = [];
  let revealed = new Set(), editingId = null, idleTimer = null;

  // ---------- crypto ----------
  const b64 = buf => { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(pw, saltBytes){
    const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt:saltBytes, iterations:ITER, hash:"SHA-256"},
      base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  }
  async function encryptAll(){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, enc.encode(JSON.stringify(entries)));
    return {app:"keyring", v:1, salt:b64(salt), iv:b64(iv), ct:b64(ct), updatedAt:new Date().toISOString()};
  }
  async function decryptBlob(blob, pw){
    const s = unb64(blob.salt);
    const k = await deriveKey(pw, s);
    const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:unb64(blob.iv)}, k, unb64(blob.ct));
    return {k, s, list: JSON.parse(dec.decode(pt))};
  }
  const validBlob = b => b && typeof b === "object" && b.v === 1 && typeof b.salt === "string" && typeof b.iv === "string" && typeof b.ct === "string";

  // ---------- storage ----------
  function readLocal(){ try { const r = localStorage.getItem(LS_KEY); const b = r ? JSON.parse(r) : null; return validBlob(b) ? b : null; } catch { return null; } }
  function writeLocal(blob){ try { localStorage.setItem(LS_KEY, JSON.stringify(blob)); return true; } catch { return false; } }
  async function save(){
    stored = await encryptAll();
    if (!writeLocal(stored)) toast("This device blocked saving. Download a backup now so you don't lose changes.");
    updateBackupText();
  }

  // ---------- boot ----------
  function boot(){
    stored = readLocal();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    showLock();
  }

  function showLock(){
    $("lockForm").hidden = false;
    const isNew = !stored;
    $("lockTitle").textContent = isNew ? "Set up your Keyring" : "Keyring is locked";
    $("lockSub").textContent = isNew
      ? "One master password protects every login you save here: Gmail, Instagram, client dashboards, Wi-Fi codes."
      : "Enter your master password to see your saved logins.";
    $("confirmWrap").hidden = !isNew;
    $("setupNote").hidden = !isNew;
    $("master").autocomplete = isNew ? "new-password" : "current-password";
    $("lockBtn").textContent = isNew ? "Create vault" : "Unlock";
    $("master").value = ""; $("master2").value = ""; $("lockMsg").textContent = ""; $("lockMsg").className = "msg";
    $("masterMeter").style.width = "0";
    $("lockView").hidden = false; $("vaultView").hidden = true;
    setTimeout(() => $("master").focus(), 50);
  }

  function strength(pw){
    let s = 0; if (pw.length >= 10) s++; if (pw.length >= 14) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  }
  $("master").addEventListener("input", () => {
    if ($("confirmWrap").hidden) return;
    const s = strength($("master").value), m = $("masterMeter");
    m.style.width = (s/5*100) + "%";
    m.style.background = s >= 4 ? "var(--good)" : s >= 3 ? "var(--accent)" : "var(--bad)";
  });

  $("lockForm").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = $("master").value, msg = $("lockMsg"), btn = $("lockBtn");
    msg.className = "msg";
    if (!stored){
      if (pw.length < 8){ msg.className = "msg bad"; msg.textContent = "Use at least 8 characters. Longer is safer."; return; }
      if (pw !== $("master2").value){ msg.className = "msg bad"; msg.textContent = "The two passwords don't match. Type them again."; return; }
      btn.disabled = true; msg.textContent = "Creating your vault…";
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(pw, salt);
      entries = [];
      await save();
      btn.disabled = false; openVault();
      return;
    }
    btn.disabled = true; msg.textContent = "Unlocking…";
    try {
      const r = await decryptBlob(stored, pw);
      key = r.k; salt = r.s; entries = Array.isArray(r.list) ? r.list : [];
      openVault();
    } catch {
      msg.className = "msg bad"; msg.textContent = "That master password is wrong. Check caps lock and try again.";
    }
    btn.disabled = false;
  });

  function openVault(){
    $("master").value = ""; $("master2").value = "";
    $("lockView").hidden = true; $("vaultView").hidden = false;
    revealed.clear(); editingId = null; $("confirmSlot").innerHTML = "";
    renderEditor(); render(); updateBackupText(); bumpIdle();
  }

  function lock(){
    key = null; entries = []; revealed.clear(); editingId = null;
    $("editorSlot").innerHTML = ""; $("list").innerHTML = ""; $("confirmSlot").innerHTML = ""; $("search").value = "";
    clearTimeout(idleTimer); showLock();
  }
  $("lockNow").addEventListener("click", lock);

  function bumpIdle(){ if (!key) return; clearTimeout(idleTimer); idleTimer = setTimeout(lock, 5*60*1000); }
  ["pointerdown","keydown","scroll"].forEach(ev => document.addEventListener(ev, bumpIdle, {passive:true}));

  // ---------- list ----------
  function el(tag, attrs = {}, ...kids){
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)){
      if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && n.append(c.nodeType ? c : document.createTextNode(c)));
    return n;
  }

  function render(){
    const q = $("search").value.trim().toLowerCase();
    const list = $("list"); list.innerHTML = "";
    const items = entries.filter(e => !q || [e.site,e.username,e.notes].join(" ").toLowerCase().includes(q))
      .sort((a,b) => a.site.localeCompare(b.site));
    $("countText").textContent = entries.length ? `${entries.length} saved.` : "";
    if (!entries.length){
      list.append(el("div",{class:"empty"},
        el("h2",{},"Nothing saved yet"),
        el("p",{class:"muted small"},"Tap + Add to save your first login."),
      ));
      return;
    }
    if (!items.length){ list.append(el("p",{class:"muted small"},`No saved login matches "${q}".`)); return; }
    for (const e of items){
      const shown = revealed.has(e.id);
      const pwCode = el("code",{}, shown ? e.password : "•".repeat(Math.min(12, Math.max(8, e.password.length))));
      const card = el("article",{class:"card"},
        el("div",{class:"card-head"},
          el("div",{class:"badge","aria-hidden":"true"}, (e.site[0]||"?").toUpperCase()),
          el("div",{class:"grow"}, el("div",{class:"title"}, e.site), e.username ? el("div",{class:"user"}, e.username) : null),
        ),
        el("div",{class:"pw"}, pwCode,
          el("button",{type:"button",class:"ghost","aria-label":shown?"Hide password":"Show password",onclick:()=>{shown?revealed.delete(e.id):revealed.add(e.id);render();}}, shown?"Hide":"Show"),
          el("button",{type:"button",onclick:()=>copy(e.password,"Password copied")},"Copy"),
        ),
        e.notes ? el("div",{class:"notes"}, e.notes) : null,
      );
      const actions = el("div",{class:"actions"});
      if (e.username) actions.append(el("button",{type:"button",class:"ghost",onclick:()=>copy(e.username,"Username copied")},"Copy username"));
      actions.append(el("button",{type:"button",class:"ghost",onclick:()=>{editingId=e.id;renderEditor();window.scrollTo({top:0,behavior:"smooth"});}},"Edit"));
      const del = el("button",{type:"button",class:"ghost danger"},"Delete");
      del.addEventListener("click", async () => {
        if (del.dataset.armed){ entries = entries.filter(x => x.id !== e.id); await save(); render(); toast(`Deleted ${e.site}`); return; }
        del.dataset.armed = "1"; del.textContent = "Tap again to delete";
        setTimeout(() => { if (del.isConnected){ delete del.dataset.armed; del.textContent = "Delete"; } }, 3000);
      });
      actions.append(del);
      card.append(actions);
      list.append(card);
    }
  }
  $("search").addEventListener("input", render);

  // ---------- editor ----------
  function genPassword(len = 18){
    const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ","abcdefghijkmnopqrstuvwxyz","23456789","!@#$%&*?-_+="];
    const all = sets.join("");
    const rnd = n => { const a = new Uint32Array(1); const lim = 4294967296 - (4294967296 % n); do { crypto.getRandomValues(a); } while (a[0] >= lim); return a[0] % n; };
    let out = sets.map(s => s[rnd(s.length)]);
    while (out.length < len) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--){ const j = rnd(i+1); [out[i],out[j]] = [out[j],out[i]]; }
    return out.join("");
  }

  function renderEditor(){
    const slot = $("editorSlot"); slot.innerHTML = "";
    $("addBtn").disabled = editingId !== null;
    if (editingId === null) return;
    const cur = editingId === "new" ? {site:"",username:"",password:"",notes:""} : entries.find(x => x.id === editingId);
    if (!cur){ editingId = null; $("addBtn").disabled = false; return; }
    const site = el("input",{id:"fSite",placeholder:"e.g. Gmail, Instagram, Hostinger",autocomplete:"off"}); site.value = cur.site;
    const user = el("input",{id:"fUser",placeholder:"Email, phone or username",autocomplete:"off"}); user.value = cur.username;
    const pw = el("input",{id:"fPw",type:"text",placeholder:"Password",autocomplete:"off",spellcheck:"false",style:"font-family:var(--mono)"}); pw.value = cur.password;
    const notes = el("textarea",{id:"fNotes",placeholder:"Security questions, PIN hints, recovery codes…"}); notes.value = cur.notes || "";
    const msg = el("p",{class:"msg"});
    const form = el("form",{class:"editor"},
      el("h2",{}, editingId === "new" ? "Add a login" : `Edit ${cur.site}`),
      el("div",{class:"field"}, el("label",{class:"label",for:"fSite"},"Site or app"), site),
      el("div",{class:"field"}, el("label",{class:"label",for:"fUser"},"Username"), user),
      el("div",{class:"field"}, el("label",{class:"label",for:"fPw"},"Password"),
        el("div",{class:"row"}, el("div",{class:"grow"},pw),
          el("button",{type:"button",onclick:()=>{pw.value=genPassword();}},"Generate"))),
      el("div",{class:"field"}, el("label",{class:"label",for:"fNotes"},"Notes"), notes),
      msg,
      el("div",{class:"row",style:"justify-content:flex-end"},
        el("button",{type:"button",class:"ghost",onclick:()=>{editingId=null;renderEditor();}},"Cancel"),
        el("button",{type:"submit",class:"primary"},"Save")),
    );
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      if (!site.value.trim()){ msg.className="msg bad"; msg.textContent="Add the site or app name so you can find it later."; return; }
      if (!pw.value){ msg.className="msg bad"; msg.textContent="Enter a password, or tap Generate for a strong one."; return; }
      const data = {site:site.value.trim(), username:user.value.trim(), password:pw.value, notes:notes.value.trim(), updated:Date.now()};
      if (editingId === "new") entries.push({id:(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()), ...data});
      else Object.assign(entries.find(x => x.id === editingId), data);
      const name = data.site;
      editingId = null; renderEditor(); await save(); render(); toast(`Saved ${name}`);
    });
    slot.append(form);
    setTimeout(() => site.focus(), 30);
  }
  $("addBtn").addEventListener("click", () => { editingId = "new"; renderEditor(); });

  // ---------- backup ----------
  function updateBackupText(){
    let last = null; try { last = localStorage.getItem(LAST_BACKUP); } catch {}
    $("backupText").textContent = last
      ? `Last backup: ${new Date(last).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}.`
      : "No backup yet. Download one so you don't lose everything if this phone is lost.";
  }
  $("backupBtn").addEventListener("click", async () => {
    if (!key) return;
    const blob = await encryptAll();
    const file = new Blob([JSON.stringify(blob, null, 2)], {type:"application/json"});
    const name = `keyring-backup-${new Date().toISOString().slice(0,10)}.json`;
    try {
      const f = new File([file], name, {type:"application/json"});
      if (navigator.canShare && navigator.canShare({files:[f]}) && /iPhone|iPad|Android/i.test(navigator.userAgent)){
        await navigator.share({files:[f], title:"Keyring backup"});
      } else {
        const url = URL.createObjectURL(file);
        const a = el("a",{href:url,download:name}); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      try { localStorage.setItem(LAST_BACKUP, new Date().toISOString()); } catch {}
      updateBackupText();
      toast("Backup ready. It's encrypted with your master password.");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      toast("Couldn't create the backup file. Try again.");
    }
  });

  let pendingImport = null;
  function pickBackup(){ $("fileInput").value = ""; $("fileInput").click(); }
  $("restoreBtn").addEventListener("click", pickBackup);
  $("fileInput").addEventListener("change", async () => {
    const f = $("fileInput").files[0]; if (!f) return;
    let blob = null;
    try { blob = JSON.parse(await f.text()); } catch {}
    if (!validBlob(blob)){ toast("That file isn't a Keyring backup."); return; }
    pendingImport = blob;
    if (!stored){ applyImport(); return; }
    showReplaceConfirm();
  });
  function showReplaceConfirm(){
    const inVault = !$("vaultView").hidden;
    const slot = inVault ? $("confirmSlot") : $("lockMsg");
    if (!inVault){
      $("lockMsg").className = "msg bad";
      $("lockMsg").textContent = "";
    }
    const box = el("div",{class:"confirm"},
      el("p",{}, el("strong",{},"Replace the vault on this device?"), " Logins saved here that aren't in the backup will be removed. You'll unlock with the backup's master password."),
      el("div",{class:"row",style:"justify-content:flex-end"},
        el("button",{type:"button",class:"ghost",onclick:()=>{pendingImport=null;box.remove();}},"Cancel"),
        el("button",{type:"button",class:"primary",onclick:()=>{box.remove();applyImport();}},"Replace")));
    if (inVault){ slot.innerHTML = ""; slot.append(box); box.scrollIntoView({behavior:"smooth",block:"center"}); }
    else { $("lockForm").after(box); }
  }
  function applyImport(){
    if (!pendingImport) return;
    stored = pendingImport; pendingImport = null;
    if (!writeLocal(stored)){ toast("This device blocked saving the backup."); return; }
    lock();
    $("lockMsg").className = "msg good";
    $("lockMsg").textContent = "Backup restored. Enter the master password you used when you made it.";
  }

  // ---------- helpers ----------
  async function copy(text, label){
    try { await navigator.clipboard.writeText(text); toast(label); }
    catch {
      const t = el("textarea",{style:"position:fixed;opacity:0"}); t.value = text; document.body.append(t); t.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch {}
      t.remove(); toast(ok ? label : "Copy was blocked. Tap Show and copy it by hand.");
    }
  }
  let tt; function toast(t){ const n = $("toast"); n.textContent = t; n.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => n.classList.remove("on"), 2200); }

  // ---------- install + offline ----------
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; if (!standalone) $("installBar").hidden = false; });
  $("installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null; $("installBar").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("installBar").hidden = true; toast("Keyring installed"); });
  if (!standalone && /iPhone|iPad|iPod/i.test(navigator.userAgent)) $("iosTip").hidden = false;

  const setOnline = () => { $("offlineText").textContent = navigator.onLine ? "" : "You're offline. Keyring still works and saves normally."; };
  window.addEventListener("online", setOnline); window.addEventListener("offline", setOnline); setOnline();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  boot();
})();
