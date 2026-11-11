(function(){
  const CATS = ["أواني الطهي","أدوات المائدة","البلاستيك والتخزين","رفايع المطبخ","الأجهزة الصغيرة","أدوات التنظيف","جهاز العروسة","أخرى"];
  const S = {
    mode: "guest", tab: "products", isAdmin: false, user: null, ownerUid: undefined,
    products: [], offers: [], priv: { products: {}, offers: {} },
    loaded: { products: false, offers: false },
    db: null, auth: null, unsubs: [], filters: {}, imgCache: {}
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = v => { const t = String(v ?? "").trim().replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٫,]/g, "."); if (t === "") return null; const n = parseFloat(t); return isFinite(n) ? n : null; };
  const fmt = n => n == null ? "" : Number(n).toLocaleString("ar-EG", {maximumFractionDigits: 2});
  const money = n => n == null ? "—" : fmt(n) + " ج.م";
  const r2 = n => Math.round(n * 100) / 100;
  const finalPrice = (p, d) => p == null ? null : r2(p * (1 - (d || 0) / 100));
  const visible = x => x.visible !== false;
  const PRIV = { products: "privateProducts", offers: "privateOffers" };

  function toast(m){ const t=$("toast"); t.textContent=m; t.style.display="block"; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display="none",2600); }
  function status(html, cls){ $("status").innerHTML = html ? `<div class="note ${cls||""}">${html}</div>` : ""; }

  function offerState(o){
    if(!o.validUntil) return {k:"active", t:"ساري", c:"ok"};
    const days = Math.ceil((new Date(o.validUntil + "T23:59:59") - new Date()) / 86400000);
    if (days < 0) return {k:"expired", t:"منتهي", c:"exp"};
    if (days <= 7) return {k:"soon", t: days===0 ? "ينتهي النهارده" : `باقي ${fmt(days)} يوم`, c:"soon"};
    return {k:"active", t:"ساري", c:"ok"};
  }

  // ================= images (stored in Firestore, no paid storage needed) =================
  function loadImg(file){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => res({img, url}); img.onerror = () => { URL.revokeObjectURL(url); rej(); };
      img.src = url;
    });
  }
  function toDataUrl(img, max, q){
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  }
  async function prepare(file){
    const {img, url} = await loadImg(file);
    let max = 1400, q = 0.82, data = toDataUrl(img, max, q);
    while (data.length > 750000 && (q > 0.45 || max > 700)) { if (q > 0.45) q -= 0.1; else max -= 200; data = toDataUrl(img, max, q); }
    const thumb = toDataUrl(img, 420, 0.7);
    URL.revokeObjectURL(url);
    return {data, thumb};
  }
  async function getImg(id){
    if (S.imgCache[id]) return S.imgCache[id];
    const d = await S.db.collection("images").doc(id).get();
    const v = d.exists ? d.data() : null;
    if (v) S.imgCache[id] = v;
    return v;
  }

  // ================= routing =================
  function route(){
    S.mode = location.hash === "#admin" ? "admin" : "guest";
    const adminOn = S.mode === "admin" && S.isAdmin;
    const tabs = S.mode === "admin" ? [["products","المنتجات"],["offers","عروض التجار"],["prices","تعديل الأسعار"]] : [["products","المنتجات"],["offers","العروض"]];
    if (!tabs.some(t => t[0] === S.tab)) S.tab = "products";
    document.body.classList.toggle("admin", adminOn);
    $("roleTag").hidden = !adminOn;
    $("title").textContent = adminOn ? "لوحة التحكم" : "كتالوج الأدوات المنزلية";
    $("switch").hidden = !(S.isAdmin || S.mode === "admin");
    $("switch").textContent = S.mode === "admin" ? "عرض كضيف" : "لوحة الأدمن";
    $("switch").setAttribute("href", S.mode === "admin" ? "#shop" : "#admin");
    $("logout").hidden = !(S.mode === "admin" && S.user);
    $("tabs").innerHTML = adminOn || S.mode === "guest" ? tabs.map(([k,t]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab===k}">${t}<span class="n" id="n-${k}"></span></button>`).join("") : "";
    $("tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; route(); });
    $("fab").hidden = !(adminOn && S.tab !== "prices");
    $("fab").textContent = S.tab === "offers" ? "+ إضافة عرض" : "+ إضافة منتج";
    subscribe();
    render(true);
  }
  window.addEventListener("hashchange", route);

  // ================= data subscriptions =================
  let subKey = "";
  function subscribe(){
    if (!S.db) return;
    const adminData = S.mode === "admin" && S.isAdmin;
    const key = adminData ? "admin" : "guest";
    if (key === subKey) return;
    subKey = key;
    S.unsubs.forEach(u => u()); S.unsubs = [];
    S.loaded = { products: false, offers: false };
    const timer = setTimeout(() => status("البيانات مش بتوصل دلوقتي، ممكن النت ضعيف."), 10000);
    ["products","offers"].forEach(col => {
      let q = S.db.collection(col);
      if (!adminData) q = q.where("visible", "==", true);
      S.unsubs.push(q.onSnapshot(snap => {
        S[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        S.loaded[col] = true; clearTimeout(timer); status("");
        render();
      }, e => { clearTimeout(timer); S.loaded[col] = true; render(); status("حصلت مشكلة في تحميل البيانات. افتح الصفحة تاني بعد شوية.", "err"); console.error(e); }));
      if (adminData){
        S.unsubs.push(S.db.collection(PRIV[col]).onSnapshot(snap => {
          const m = {}; snap.docs.forEach(d => m[d.id] = d.data()); S.priv[col] = m;
        }, () => {}));
      }
    });
  }

  // ================= render =================
  function counts(){
    const set = (k,v) => { const el = $("n-"+k); if (el) el.textContent = fmt(v); };
    set("products", S.products.filter(p => S.mode==="admin" || visible(p)).length);
    set("offers", S.offers.filter(o => S.mode==="admin" || offerState(o).k !== "expired").length);
  }

  function loginView(){
    if (S.ownerUid === undefined) return `<div class="empty">جاري التحقق…</div>`;
    if (!S.user) return `<div class="empty"><b>لوحة الأدمن</b>سجّل دخول بحساب جوجل بتاعك عشان تتحكم في المنتجات والأسعار.<br><br><button class="btn primary" id="login">دخول بحساب جوجل</button></div>`;
    if (!S.ownerUid) return `<div class="empty"><b>أول تشغيل</b>إنت داخل بحساب<br><span class="ltr">${esc(S.user.email || "")}</span><br>الحساب ده هيبقى الأدمن الوحيد للتطبيق.<br><br><button class="btn primary" id="claim">اعتمد الحساب ده كأدمن</button></div>`;
    return `<div class="empty"><b>الحساب ده مش أدمن</b><span class="ltr">${esc(S.user.email || "")}</span><br><br><button class="btn" id="out2">خروج</button> <a class="btn" href="#shop">ارجع للكتالوج</a></div>`;
  }

  function render(rebuild){
    counts();
    const m = $("main");
    if (S.mode === "admin" && !S.isAdmin){
      m.dataset.view = "login"; m.innerHTML = loginView();
      if ($("login")) $("login").onclick = login;
      if ($("claim")) $("claim").onclick = claim;
      if ($("out2")) $("out2").onclick = () => S.auth.signOut();
      return;
    }
    if (rebuild || m.dataset.view !== S.mode + S.tab){
      m.dataset.view = S.mode + S.tab;
      m.innerHTML = shell();
      bindShell();
    }
    fill();
  }

  function shell(){
    if (S.tab === "prices") return `
      <div class="note info">غيّر السعر أو الخصم في أي صف، والتغيير بيتحفظ لوحده أول ما تخرج من الخانة.</div>
      <div class="bulk">
        <div class="f"><label for="b-cat">خصم جماعي على</label><select id="b-cat"><option value="">كل المنتجات</option>${CATS.map(c=>`<option>${c}</option>`).join("")}</select></div>
        <div class="f"><label for="b-disc">نسبة الخصم ٪</label><input id="b-disc" inputmode="decimal" style="width:100px;border:1px solid var(--line);border-radius:10px;padding:9px 11px"></div>
        <button class="btn primary" id="b-go">طبّق</button>
      </div>
      <div class="bar"><input id="q" type="search" placeholder="ابحث باسم المنتج"></div>
      <div class="scroll"><table class="qp"><thead><tr><th>المنتج</th><th>السعر</th><th>الخصم ٪</th><th>بعد الخصم</th></tr></thead><tbody id="qp"></tbody></table></div>`;
    if (S.tab === "products") return `
      <div class="bar">
        <input id="q" type="search" placeholder="ابحث باسم المنتج أو الماركة أو الوصف">
        <select id="cat"><option value="">كل الأقسام</option>${CATS.map(c=>`<option>${c}</option>`).join("")}</select>
        <select id="sort"><option value="new">الأحدث</option><option value="disc">أعلى خصم</option><option value="low">الأرخص</option><option value="high">الأغلى</option><option value="name">بالاسم</option></select>
      </div><div id="out"></div>`;
    return `
      <div class="bar">
        <input id="q" type="search" placeholder="ابحث باسم التاجر أو المنتج">
        <select id="merch"><option value="">كل التجار</option></select>
        ${S.mode==="admin" ? `<select id="state"><option value="">كل العروض</option><option value="active">السارية</option><option value="soon">تنتهي خلال ٧ أيام</option><option value="expired">المنتهية</option></select>` : ""}
      </div><div id="out"></div>`;
  }

  function bindShell(){
    ["q","cat","sort","merch","state"].forEach(id => { const el = $(id); if (el){ if (S.filters[S.tab+id]) el.value = S.filters[S.tab+id]; el.addEventListener("input", () => { S.filters[S.tab+id] = el.value; fill(); }); }});
    if ($("b-go")) $("b-go").onclick = bulkDiscount;
  }

  function filteredProducts(){
    const q = ($("q")?.value || "").trim().toLowerCase(), cat = $("cat")?.value || "", sort = $("sort")?.value || "new";
    let list = S.products.filter(p => (S.mode==="admin" || visible(p)) && (!cat || p.category===cat) &&
      (!q || [p.name,p.brand,p.description].join(" ").toLowerCase().includes(q)));
    const fp = p => finalPrice(p.price, p.discount) ?? 0;
    list.sort((a,b)=> sort==="disc" ? (b.discount||0)-(a.discount||0) : sort==="low" ? fp(a)-fp(b) : sort==="high" ? fp(b)-fp(a) :
      sort==="name" ? String(a.name).localeCompare(String(b.name),"ar") : (b.createdAt||0)-(a.createdAt||0));
    return list;
  }
  function filteredOffers(){
    const q = ($("q")?.value || "").trim().toLowerCase(), m = $("merch")?.value || "", st = $("state")?.value || "";
    let list = S.offers.filter(o => (S.mode==="admin" || (visible(o) && offerState(o).k!=="expired")) &&
      (!m || o.merchant===m) && (!st || offerState(o).k===st) &&
      (!q || [o.merchant,o.title,o.description].join(" ").toLowerCase().includes(q)));
    const ra = {soon:0,active:1,expired:2};
    list.sort((a,b)=> (ra[offerState(a).k]-ra[offerState(b).k]) || (b.createdAt||0)-(a.createdAt||0));
    return list;
  }

  function priceHtml(x){
    const f = finalPrice(x.price, x.discount);
    return `<span class="final">${money(f)}</span>${x.discount>0 ? `<span class="old">${money(x.price)}</span>` : ""}`;
  }

  function fill(){
    if (S.mode === "admin" && !S.isAdmin) return;
    if (S.tab === "prices") return fillPrices();
    const out = $("out"); if (!out) return;
    const kind = S.tab === "products" ? "p" : "o";
    if (kind === "o" && $("merch")){
      const ms = [...new Set(S.offers.map(o=>o.merchant).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
      const cur = $("merch").value;
      $("merch").innerHTML = `<option value="">كل التجار</option>` + ms.map(x=>`<option ${x===cur?"selected":""}>${esc(x)}</option>`).join("");
    }
    if (!S.loaded[kind==="p"?"products":"offers"]) { out.innerHTML = `<div class="grid"><div class="empty">جاري التحميل…</div></div>`; return; }
    const list = kind==="p" ? filteredProducts() : filteredOffers();
    const total = kind==="p" ? S.products.length : S.offers.length;
    if (!list.length){
      const msg = total ? ["مفيش نتايج", "جرّب كلمة بحث أو فلتر تاني"] :
        (S.mode==="admin" ? [kind==="p" ? "لسه مفيش منتجات" : "لسه مفيش عروض", "دوس زرار الإضافة تحت"] : [kind==="p" ? "مفيش منتجات معروضة دلوقتي" : "مفيش عروض دلوقتي", ""]);
      out.innerHTML = `<div class="grid"><div class="empty"><b>${msg[0]}</b>${msg[1]}</div></div>`; return;
    }
    const nImgs = x => (x.images || []).length;
    if (S.mode === "admin"){
      out.innerHTML = `<div class="list">${list.map(x => {
        const s = kind==="o" ? offerState(x) : null;
        return `<div class="item ${visible(x)?"":"off"}">
          ${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : `<div class="noimg"></div>`}
          <div class="info"><div class="name">${esc(kind==="p"?x.name:x.title)}</div>
            <div class="sub">${kind==="p" ? esc(x.category||"") : esc(x.merchant||"")} · ${money(finalPrice(x.price,x.discount))}${x.discount>0?` · خصم ${fmt(x.discount)}٪`:""}</div>
            <div>${visible(x) ? "" : `<span class="pill hid">مخفي عن الضيوف</span> `}${s ? `<span class="pill ${s.c}">${s.t}</span>` : ""} <span class="sub">${fmt(nImgs(x))} صورة</span></div>
          </div>
          <div class="tools"><button class="btn sm" data-vis="${esc(x._id)}">${visible(x)?"إخفاء":"إظهار"}</button><button class="btn sm primary" data-edit="${esc(x._id)}">تعديل</button></div>
        </div>`; }).join("")}</div>`;
      out.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openForm(kind, (kind==="p"?S.products:S.offers).find(x=>x._id===b.dataset.edit)));
      out.querySelectorAll("[data-vis]").forEach(b => b.onclick = async () => {
        const x = (kind==="p"?S.products:S.offers).find(y=>y._id===b.dataset.vis); b.disabled = true;
        try { await S.db.collection(kind==="p"?"products":"offers").doc(x._id).update({visible: !visible(x)}); toast(visible(x) ? "اتخفى" : "ظاهر للضيوف"); }
        catch(e){ b.disabled = false; toast("مقدرتش أغيّر، جرّب تاني"); }
      });
      return;
    }
    out.innerHTML = `<div class="grid">${list.map(x => `<div class="card" data-id="${esc(x._id)}">
        <div class="thumb">${x.thumb ? `<img loading="lazy" src="${esc(x.thumb)}" alt="">` : "بدون صورة"}
          ${x.discount>0 ? `<span class="badge">خصم ${fmt(x.discount)}٪</span>` : ""}
          ${nImgs(x)>1 ? `<span class="imgcount">${fmt(nImgs(x))} صور</span>` : ""}</div>
        <div class="body"><div class="name">${esc(kind==="p"?x.name:x.title)}</div>
          <div class="sub">${esc(kind==="p" ? [x.brand,x.category].filter(Boolean).join(" · ") : x.merchant||"")}</div>
          ${x.description ? `<div class="desc">${esc(x.description)}</div>` : ""}
          ${kind==="o" && offerState(x).k==="soon" ? `<div><span class="pill soon">${offerState(x).t}</span></div>` : ""}
          <div class="price">${priceHtml(x)}</div>
        </div></div>`).join("")}</div>`;
    out.querySelectorAll(".card").forEach(c => c.onclick = () => openDetail(kind, (kind==="p"?S.products:S.offers).find(x=>x._id===c.dataset.id)));
  }

  // ---------- quick prices ----------
  function fillPrices(){
    const tb = $("qp"); if (!tb) return;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#qp")) return;
    const q = ($("q")?.value || "").trim().toLowerCase();
    const list = S.products.filter(p => !q || String(p.name).toLowerCase().includes(q)).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ar"));
    if (!list.length){ tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">${S.loaded.products ? "مفيش منتجات" : "جاري التحميل…"}</td></tr>`; return; }
    tb.innerHTML = list.map(p => `<tr data-id="${esc(p._id)}">
      <td>${esc(p.name)}</td>
      <td><input data-k="price" inputmode="decimal" value="${p.price ?? ""}"></td>
      <td><input data-k="discount" inputmode="decimal" value="${p.discount || ""}" placeholder="0"></td>
      <td class="f">${money(finalPrice(p.price,p.discount))}</td></tr>`).join("");
    tb.querySelectorAll("tr[data-id]").forEach(tr => {
      const ins = tr.querySelectorAll("input");
      const live = () => { tr.querySelector(".f").textContent = money(finalPrice(num(ins[0].value), num(ins[1].value)||0)); };
      ins.forEach(i => { i.addEventListener("focus", () => i.select()); i.addEventListener("input", live); i.addEventListener("change", () => saveRow(tr)); });
    });
  }
  async function saveRow(tr){
    const p = S.products.find(x => x._id === tr.dataset.id); if (!p) return;
    const price = num(tr.querySelector('[data-k="price"]').value), disc = num(tr.querySelector('[data-k="discount"]').value) || 0;
    if (price == null || price < 0 || disc < 0 || disc > 100){ toast("رقم مش صحيح"); return; }
    if (price === p.price && disc === (p.discount||0)) return;
    tr.className = "saving";
    try { await S.db.collection("products").doc(p._id).update({price, discount: disc, updatedAt: Date.now()}); tr.className = "saved"; setTimeout(()=>tr.className="",1200); }
    catch(e){ tr.className = ""; toast("الحفظ فشل، جرّب تاني"); }
  }
  async function bulkDiscount(){
    const cat = $("b-cat").value, d = num($("b-disc").value);
    if (d == null || d < 0 || d > 100) return toast("اكتب نسبة بين ٠ و ١٠٠");
    const list = S.products.filter(p => !cat || p.category === cat);
    if (!list.length) return toast("مفيش منتجات في القسم ده");
    openSheet(`<h2>تأكيد الخصم الجماعي</h2><p>هيتحط خصم ${fmt(d)}٪ على ${fmt(list.length)} منتج${cat ? " في قسم «"+esc(cat)+"»" : ""}. الخصم القديم هيتشال.</p>
      <div class="actions"><button class="btn" id="c-no">رجوع</button><button class="btn primary" id="c-yes">طبّق</button></div>`);
    $("c-no").onclick = closeSheet;
    $("c-yes").onclick = async () => {
      $("c-yes").disabled = true;
      try {
        const batch = S.db.batch(); let n = 0;
        list.forEach(p => { if ((p.discount||0) !== d){ batch.update(S.db.collection("products").doc(p._id), {discount: d, updatedAt: Date.now()}); n++; } });
        if (n) await batch.commit();
        closeSheet(); toast(`اتطبق على ${fmt(list.length)} منتج`);
      } catch(e){ $("c-yes").disabled = false; toast("التطبيق فشل، جرّب تاني"); }
    };
  }

  // ================= sheet =================
  function openSheet(html){ $("sheet").innerHTML = html; $("ov").classList.add("open"); $("sheet").scrollTop = 0; }
  function closeSheet(){ $("ov").classList.remove("open"); $("sheet").innerHTML = ""; }
  $("ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

  function openDetail(kind, it){
    const ids = it.images || []; let i = 0;
    const s = kind==="o" ? offerState(it) : null;
    const rows = kind==="p" ? [["القسم", it.category], ["الماركة", it.brand]] :
      [["التاجر", it.merchant], ["أقل كمية", it.minQty],
       ["ساري لحد", it.validUntil ? new Date(it.validUntil+"T12:00:00").toLocaleDateString("ar-EG",{day:"numeric",month:"long",year:"numeric"}) : ""]];
    openSheet(`<h2>${esc(kind==="p"?it.name:it.title)}</h2>
      ${ids.length ? `<div class="gal" id="gal"><img id="gm" src="${esc(it.thumb || "")}" alt="">
        ${ids.length>1 ? `<button class="nav prev" id="gp" aria-label="السابقة">›</button><button class="nav next" id="gn" aria-label="التالية">‹</button><span class="cnt" id="gc"></span>` : ""}</div>
        ${ids.length>1 ? `<div class="strip" id="gs">${ids.map((_,k)=>`<img data-i="${k}" alt="">`).join("")}</div>` : ""}` : ""}
      <div class="bigprice">${priceHtml(it)}${it.discount>0 ? `<span class="pill ok">وفّر ${money(r2(it.price - finalPrice(it.price,it.discount)))}</span>` : ""}${s ? ` <span class="pill ${s.c}">${s.t}</span>` : ""}</div>
      ${it.description ? `<div class="ddesc">${esc(it.description)}</div>` : ""}
      <dl class="kv">${rows.filter(r=>r[1]).map(r=>`<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join("")}</dl>
      <div class="actions"><button class="btn" id="d-close">إغلاق</button></div>`);
    $("d-close").onclick = closeSheet;
    if (!ids.length) return;
    const show = async k => {
      i = (k + ids.length) % ids.length; const want = i;
      if ($("gc")) $("gc").textContent = `${fmt(i+1)} من ${fmt(ids.length)}`;
      if ($("gs")) { $("gs").querySelectorAll("img").forEach((x,n)=>x.classList.toggle("on", n===i)); const on = $("gs").children[i]; on && on.scrollIntoView({block:"nearest",inline:"nearest"}); }
      const v = await getImg(ids[want]).catch(()=>null);
      if (v && i === want && $("gm")) $("gm").src = v.data;
    };
    if (ids.length > 1){
      $("gp").onclick = () => show(i-1); $("gn").onclick = () => show(i+1);
      $("gs").querySelectorAll("img").forEach(x => x.onclick = () => show(+x.dataset.i));
      ids.forEach((id, k) => getImg(id).then(v => { const el = $("gs") && $("gs").children[k]; if (v && el) el.src = v.thumb || v.data; }).catch(()=>{}));
      let sx = null; const g = $("gal");
      g.addEventListener("touchstart", e => sx = e.touches[0].clientX, {passive:true});
      g.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(dx > 0 ? i+1 : i-1); sx = null; });
    }
    show(0);
  }

  // ================= admin form =================
  let draft = [];
  function openForm(kind, it){
    it = it || {};
    const P = kind === "p", pv = (it._id && S.priv[P?"products":"offers"][it._id]) || {};
    draft = (it.images || []).map(id => ({id, thumb: S.imgCache[id]?.thumb, loading: !S.imgCache[id]}));
    draft.forEach(d => { if (d.loading) getImg(d.id).then(v => { d.thumb = v ? (v.thumb || v.data) : ""; d.loading = false; drawImgs(); }).catch(() => { d.loading = false; drawImgs(); }); });
    openSheet(`<h2>${it._id ? "تعديل" : "إضافة"} ${P ? "منتج" : "عرض تاجر"}</h2>
      <form id="frm" novalidate>
        <div class="f"><label>الصور · أول صورة هي اللي بتظهر في الكتالوج</label><div class="imgs" id="imgs"></div></div>
        ${P ? `
        <div class="f"><label for="x-name">اسم المنتج *</label><input id="x-name" value="${esc(it.name)}" placeholder="مثلاً: طقم حلل جرانيت 10 قطع"></div>
        <div class="row">
          <div class="f"><label for="x-cat">القسم</label><select id="x-cat">${CATS.map(c=>`<option ${c===(it.category||CATS[0])?"selected":""}>${c}</option>`).join("")}</select></div>
          <div class="f"><label for="x-brand">الماركة</label><input id="x-brand" value="${esc(it.brand)}"></div>
        </div>` : `
        <div class="f"><label for="x-merchant">اسم التاجر *</label><input id="x-merchant" value="${esc(it.merchant)}" list="ml"><datalist id="ml">${[...new Set(S.offers.map(o=>o.merchant).filter(Boolean))].map(x=>`<option value="${esc(x)}">`).join("")}</datalist></div>
        <div class="f"><label for="x-title">المنتج أو العرض *</label><input id="x-title" value="${esc(it.title)}" placeholder="مثلاً: كرتونة طاسات تيفلون 24 قطعة"></div>`}
        <div class="f"><label for="x-desc">الوصف</label><textarea id="x-desc" placeholder="الخامة، المقاسات، عدد القطع، الاستخدام، الضمان…">${esc(it.description)}</textarea></div>
        <div class="row">
          <div class="f"><label for="x-price">السعر قبل الخصم *</label><input id="x-price" inputmode="decimal" value="${it.price ?? ""}"></div>
          <div class="f"><label for="x-disc">الخصم ٪</label><input id="x-disc" inputmode="decimal" value="${it.discount || ""}" placeholder="0"></div>
        </div>
        <div class="calc" id="calc"></div>
        ${P ? "" : `<div class="row">
          <div class="f"><label for="x-min">أقل كمية</label><input id="x-min" value="${esc(it.minQty)}" placeholder="مثلاً: 2 كرتونة"></div>
          <div class="f"><label for="x-until">ساري لحد</label><input id="x-until" type="date" value="${esc(it.validUntil)}"></div>
        </div>`}
        <label class="check"><input type="checkbox" id="x-vis" ${visible(it) ? "checked" : ""}> ظاهر للضيوف</label>
        <div class="private"><h3>بيانات للأدمن بس، الضيف مش بيشوفها</h3>
          ${P ? `<div class="row">
            <div class="f"><label for="x-cost">سعر الشراء</label><input id="x-cost" inputmode="decimal" value="${pv.cost ?? ""}"></div>
            <div class="f"><label for="x-sup">المورد</label><input id="x-sup" value="${esc(pv.supplier)}"></div></div>`
          : `<div class="f"><label for="x-phone">تليفون التاجر</label><input id="x-phone" inputmode="tel" dir="ltr" value="${esc(pv.phone)}"></div>`}
          <div class="f"><label for="x-pnotes">ملاحظات خاصة</label><textarea id="x-pnotes" style="min-height:60px">${esc(pv.notes)}</textarea></div>
        </div>
        <div id="ferr"></div>
        <div class="actions">
          ${it._id ? `<button type="button" class="btn danger" id="f-del">حذف</button><span class="spacer"></span>` : ""}
          <button type="button" class="btn" id="f-cancel">إلغاء</button><button type="submit" class="btn primary" id="f-save">حفظ</button>
        </div>
      </form>`);
    drawImgs();
    const upd = () => {
      const p = num($("x-price").value), d = num($("x-disc").value) || 0, f = finalPrice(p, d), c = P ? num($("x-cost").value) : null;
      let h = `السعر بعد الخصم: <b>${money(f)}</b>`;
      if (p != null && d > 0) h += `<span>التوفير: <b>${money(r2(p - f))}</b></span>`;
      if (c != null && f != null) h += `<span>ربحك في القطعة: <b>${money(r2(f - c))}</b>${c > 0 ? ` · زيادة ${fmt(r2((f/c-1)*100))}٪` : ""}</span>`;
      $("calc").innerHTML = h;
    };
    ["x-price","x-disc","x-cost"].forEach(id => $(id) && $(id).addEventListener("input", upd)); upd();
    $("f-cancel").onclick = closeSheet;
    if ($("f-del")) $("f-del").onclick = () => confirmDelete(kind, it);
    $("frm").onsubmit = e => { e.preventDefault(); save(kind, it); };
  }

  function drawImgs(){
    const box = $("imgs"); if (!box) return;
    box.innerHTML = draft.map((im,i) => `<div class="im ${i===0?"main":""}">
      ${im.pending || im.loading ? `<div style="display:flex;height:100%;align-items:center;justify-content:center;font-size:12px;color:#777">${im.pending ? "بيترفع…" : "…"}</div>` : `<img src="${esc(im.thumb || "")}" alt="">`}
      ${i===0 ? `<span class="tag">الرئيسية</span>` : ""}
      <button type="button" class="x" data-rm="${i}" aria-label="شيل الصورة">×</button>
      ${draft.length>1 && !im.pending ? `<div class="mv">${i>0?`<button type="button" data-mv="${i}" data-d="-1" aria-label="قدّم">→</button>`:""}${i<draft.length-1?`<button type="button" data-mv="${i}" data-d="1" aria-label="أخّر">←</button>`:""}</div>` : ""}
    </div>`).join("") + `<button type="button" class="add" id="addimg"><span>+</span>صور</button>`;
    box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { draft.splice(+b.dataset.rm, 1); drawImgs(); });
    box.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + (+b.dataset.d); [draft[i], draft[j]] = [draft[j], draft[i]]; drawImgs(); });
    $("addimg").onclick = () => $("file").click();
  }

  $("file").addEventListener("change", async e => {
    const files = [...e.target.files]; e.target.value = "";
    const slots = files.map(() => ({pending:true, fresh:true})); draft.push(...slots); drawImgs();
    let failed = 0;
    for (let k = 0; k < files.length; k++){
      const slot = slots[k];
      try {
        const {data, thumb} = await prepare(files[k]);
        const ref = await S.db.collection("images").add({ data, thumb, createdAt: Date.now() });
        S.imgCache[ref.id] = {data, thumb};
        Object.assign(slot, {id: ref.id, thumb}); delete slot.pending;
      } catch(err){ const at = draft.indexOf(slot); if (at > -1) draft.splice(at, 1); failed++; console.error(err); }
      drawImgs();
    }
    if (failed) toast(`${fmt(failed)} صورة مترفعتش، جرّب تاني`);
  });

  async function save(kind, it){
    const P = kind === "p", err = m => { $("ferr").innerHTML = `<div class="note err">${m}</div>`; };
    if (draft.some(x => x.pending)) return err("استنى لحد ما الصور تخلص رفع");
    const price = num($("x-price").value), disc = num($("x-disc").value) || 0;
    const pub = P ? { name: $("x-name").value.trim(), category: $("x-cat").value, brand: $("x-brand").value.trim() }
                  : { merchant: $("x-merchant").value.trim(), title: $("x-title").value.trim(), minQty: $("x-min").value.trim(), validUntil: $("x-until").value || "" };
    if (P && !pub.name) return err("اكتب اسم المنتج");
    if (!P && (!pub.merchant || !pub.title)) return err("اكتب اسم التاجر والمنتج");
    if (price == null || price < 0) return err("اكتب سعر صحيح");
    if (disc < 0 || disc > 100) return err("الخصم لازم يكون بين ٠ و ١٠٠");
    let thumb = "";
    if (draft[0]) thumb = draft[0].thumb || (await getImg(draft[0].id).catch(()=>null))?.thumb || "";
    Object.assign(pub, { description: $("x-desc").value.trim(), price, discount: disc, visible: $("x-vis").checked,
      images: draft.map(x => x.id), thumb, createdAt: it.createdAt || Date.now(), updatedAt: Date.now() });
    const priv = P ? { cost: num($("x-cost").value), supplier: $("x-sup").value.trim(), notes: $("x-pnotes").value.trim() }
                   : { phone: $("x-phone").value.trim(), notes: $("x-pnotes").value.trim() };
    const removed = (it.images || []).filter(id => !draft.some(n => n.id === id));
    $("f-save").disabled = true;
    try{
      const col = P ? "products" : "offers";
      const ref = it._id ? S.db.collection(col).doc(it._id) : S.db.collection(col).doc();
      const batch = S.db.batch();
      batch.set(ref, pub);
      batch.set(S.db.collection(PRIV[col]).doc(ref.id), priv);
      removed.forEach(id => batch.delete(S.db.collection("images").doc(id)));
      await batch.commit();
      closeSheet(); toast("اتحفظ");
    }catch(e){
      $("f-save").disabled = false; console.error(e);
      err("الحفظ فشل، جرّب تاني");
    }
  }

  function confirmDelete(kind, it){
    openSheet(`<h2>متأكد إنك عايز تحذف؟</h2><p>«${esc(kind==="p"?it.name:it.title)}» وصوره هيتحذفوا نهائياً.</p>
      <div class="actions"><button class="btn" id="c-no">رجوع</button><button class="btn danger" id="c-yes">احذف</button></div>`);
    $("c-no").onclick = () => openForm(kind, it);
    $("c-yes").onclick = async () => {
      $("c-yes").disabled = true; const col = kind==="p" ? "products" : "offers";
      try{
        const batch = S.db.batch();
        batch.delete(S.db.collection(col).doc(it._id));
        batch.delete(S.db.collection(PRIV[col]).doc(it._id));
        (it.images || []).forEach(id => batch.delete(S.db.collection("images").doc(id)));
        await batch.commit();
        closeSheet(); toast("اتحذف");
      }catch(e){ $("c-yes").disabled = false; toast("مقدرتش أحذف، جرّب تاني"); }
    };
  }

  $("fab").onclick = () => openForm(S.tab === "offers" ? "o" : "p");

  // ================= auth =================
  async function login(){
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await S.auth.signInWithPopup(provider); }
    catch(e){
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment" || e.code === "auth/cancelled-popup-request")) {
        try { await S.auth.signInWithRedirect(provider); } catch(e2){ toast("الدخول فشل، جرّب تاني"); }
      } else if (e && e.code !== "auth/popup-closed-by-user") { toast("الدخول فشل، جرّب تاني"); console.error(e); }
    }
  }
  async function claim(){
    const b = $("claim"); if (b) b.disabled = true;
    try { await S.db.collection("settings").doc("owner").set({ uid: S.user.uid, at: Date.now() }); }
    catch(e){ toast("مقدرتش أعتمد الحساب. يمكن فيه أدمن متسجّل قبل كده."); if (b) b.disabled = false; }
  }
  $("logout").onclick = () => S.auth.signOut();

  // ================= start =================
  (function init(){
    const cfg = window.FIREBASE_CONFIG;
    if (!window.firebase || !cfg || !cfg.apiKey || String(cfg.apiKey).indexOf("PUT_") === 0){
      status("التطبيق لسه محتاج يتربط بمشروع فايربيس.", "err"); route(); return;
    }
    firebase.initializeApp(cfg);
    S.db = firebase.firestore();
    S.auth = firebase.auth();
    if (cfg.emulator){ S.db.useEmulator("localhost", 8080); S.auth.useEmulator("http://localhost:9099"); window.__S = S; }
    else { try { S.db.enablePersistence({synchronizeTabs: true}).catch(()=>{}); } catch(e){} }
    S.auth.getRedirectResult().catch(()=>{});
    S.db.collection("settings").doc("owner").onSnapshot(d => {
      S.ownerUid = d.exists ? d.data().uid : null;
      const was = S.isAdmin; S.isAdmin = !!(S.user && S.ownerUid === S.user.uid);
      if (was !== S.isAdmin) subKey = ""; route();
    }, () => { S.ownerUid = null; route(); });
    S.auth.onAuthStateChanged(u => {
      S.user = u;
      const was = S.isAdmin; S.isAdmin = !!(u && S.ownerUid && S.ownerUid === u.uid);
      if (was !== S.isAdmin) subKey = "";
      route();
    });
    route();
  })();
})();
