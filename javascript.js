// ══════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════
  var members = [];
  var rowId   = 0;
  var symbol  = "₹";
  var chartOn = false;
  var SERVER  = "http://localhost:8080";
  var useJava = false;   // set to true if Java server responds

  // ══════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════
  window.onload = function() {
    addRow();
    tryJavaServer();

    var inp = document.getElementById("chipInp");
    inp.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        var v = inp.value.replace(",","").trim();
        if (v) { addMember(v); inp.value = ""; }
      }
      if (e.key === "Backspace" && inp.value === "" && members.length > 0) {
        removeMember(members.length - 1);
      }
    });
  };

  // Try to reach Java — if it works, use it; otherwise use JS engine
  function tryJavaServer() {
    fetch(SERVER + "/api/health", { method: "GET" })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.status === "ok") {
          useJava = true;
          document.getElementById("sdot").className = "sdot on";
          document.getElementById("stext").textContent = "Java Server Online";
        }
      })
      .catch(function() {
        useJava = false;
        document.getElementById("sdot").className = "sdot local";
        document.getElementById("stext").textContent = "JS Mode (No Java needed)";
      });
    setTimeout(tryJavaServer, 5000);
  }

  // ══════════════════════════════════════════
  //  MEMBERS
  // ══════════════════════════════════════════
  function addMember(name) {
    name = name.trim();
    if (!name) return;
    for (var i = 0; i < members.length; i++) {
      if (members[i].toLowerCase() === name.toLowerCase()) {
        toast("⚠️ " + name + " already added", "terr"); return;
      }
    }
    members.push(name);
    renderChips();
    refreshDropdowns();
    setBadge("mBadge", members.length, "member");
  }

  function removeMember(idx) {
    members.splice(idx, 1);
    renderChips();
    refreshDropdowns();
    setBadge("mBadge", members.length, "member");
  }

  function renderChips() {
    var box = document.getElementById("chipsBox");
    var inp = document.getElementById("chipInp");
    var old = box.querySelectorAll(".chip");
    for (var i = 0; i < old.length; i++) box.removeChild(old[i]);
    for (var i = 0; i < members.length; i++) {
      var chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = esc(members[i])
        + '<button class="chip-btn" onclick="removeMember(' + i + ')">×</button>';
      box.insertBefore(chip, inp);
    }
  }

  // ══════════════════════════════════════════
  //  EXPENSE ROWS
  // ══════════════════════════════════════════
  function addRow() {
    rowId++;
    var id = rowId;
    var wrap = document.getElementById("expRows");
    var row = document.createElement("div");
    row.className = "exp-row";
    row.id = "row" + id;
    row.innerHTML =
      '<div class="exp-cell"><select class="exp-sel pbs" id="pb' + id + '"><option value="">Who paid?</option></select></div>'
    + '<div class="exp-cell"><input class="exp-inp" id="dc' + id + '" type="text" placeholder="Description"/></div>'
    + '<div class="exp-cell"><input class="exp-inp" id="am' + id + '" type="number" placeholder="Amount" min="0" step="0.01"/></div>'
    + '<button class="exp-rm" onclick="removeRow(' + id + ')">×</button>';
    wrap.appendChild(row);
    refreshDropdowns();
    updateExpBadge();
  }

  function removeRow(id) {
    var r = document.getElementById("row" + id);
    if (r) r.parentNode.removeChild(r);
    updateExpBadge();
  }

  function updateExpBadge() {
    setBadge("eBadge", document.querySelectorAll(".exp-row").length, "expense");
  }

  function setBadge(id, n, word) {
    document.getElementById(id).textContent = n + " " + word + (n !== 1 ? "s" : "");
  }

  function refreshDropdowns() {
    var sels = document.querySelectorAll(".pbs");
    for (var i = 0; i < sels.length; i++) {
      var prev = sels[i].value;
      sels[i].innerHTML = '<option value="">Who paid?</option>';
      for (var j = 0; j < members.length; j++) {
        var o = document.createElement("option");
        o.value = members[j]; o.textContent = members[j];
        sels[i].appendChild(o);
      }
      if (prev) sels[i].value = prev;
    }
  }

  function collectExpenses() {
    var list = [];
    var rows = document.querySelectorAll(".exp-row");
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].id.replace("row","");
      var pb = document.getElementById("pb"+id).value;
      var dc = document.getElementById("dc"+id).value.trim();
      var am = parseFloat(document.getElementById("am"+id).value);
      if (pb && am > 0) {
        list.push({ paidBy: pb, description: dc || "Expense", amount: am });
      }
    }
    return list;
  }

  // ══════════════════════════════════════════
  //  CALCULATE — tries Java first, falls back to JS
  // ══════════════════════════════════════════
  function calculate() {
    symbol = document.getElementById("curSel").value;
    var exps = collectExpenses();

    if (members.length < 2) { toast("❌ Add at least 2 members", "terr"); return; }
    if (exps.length === 0)  { toast("❌ Add at least one expense with an amount", "terr"); return; }

    if (useJava) {
      // Try Java backend
      fetch(SERVER + "/api/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: members, expenses: exps })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          toast("❌ " + data.error, "terr");
        } else {
          showResults(data, exps);
          toast("✅ Done! (Java backend)", "tok");
        }
      })
      .catch(function() {
        // Java failed mid-session — fall back to JS
        useJava = false;
        var data = calculateInJS(members, exps);
        showResults(data, exps);
        toast("✅ Done! (JS fallback)", "tok");
      });
    } else {
      // Run fully in JavaScript — no server needed
      var data = calculateInJS(members, exps);
      showResults(data, exps);
      toast("✅ Settlements calculated!", "tok");
    }
  }

  // ══════════════════════════════════════════
  //  GREEDY MIN-MAX SETTLEMENT ALGORITHM (JS)
  //
  //  Same logic as Java backend:
  //  1. Sum paid per person
  //  2. fairShare = total / count
  //  3. balance = paid - fairShare
  //  4. Split into creditors (+) and debtors (-)
  //  5. Sort both largest first
  //  6. Match & transfer minimum of each pair
  //  7. Drop settled, carry remainder forward
  // ══════════════════════════════════════════
  function calculateInJS(memberList, expList) {
    // Step 1: total paid per person
    var paid = {};
    for (var i = 0; i < memberList.length; i++) paid[memberList[i]] = 0;

    var total = 0;
    for (var i = 0; i < expList.length; i++) {
      paid[expList[i].paidBy] = (paid[expList[i].paidBy] || 0) + expList[i].amount;
      total += expList[i].amount;
    }

    // Step 2: fair share
    var share = r2(total / memberList.length);

    // Step 3: balance per person
    var balMap = {};
    for (var i = 0; i < memberList.length; i++) {
      balMap[memberList[i]] = r2((paid[memberList[i]] || 0) - share);
    }

    // Step 4: split creditors / debtors
    var cNames = [], cAmts = [];
    var dNames = [], dAmts = [];
    for (var i = 0; i < memberList.length; i++) {
      var m = memberList[i];
      var b = balMap[m];
      if (b > 0.005)       { cNames.push(m); cAmts.push(b);  }
      else if (b < -0.005) { dNames.push(m); dAmts.push(-b); }
    }

    // Step 5: sort largest first
    sortDesc(cNames, cAmts);
    sortDesc(dNames, dAmts);

    // Step 6 & 7: match and generate transactions
    var txns = [];
    var ci = 0, di = 0;
    while (ci < cNames.length && di < dNames.length) {
      var give     = cAmts[ci];
      var take     = dAmts[di];
      var transfer = r2(Math.min(give, take));

      txns.push({ from: dNames[di], to: cNames[ci], amount: transfer });

      cAmts[ci] = r2(give - transfer);
      dAmts[di] = r2(take - transfer);

      if (cAmts[ci] < 0.005) ci++;
      if (dAmts[di] < 0.005) di++;
    }

    // Build response same shape as Java
    var balances = [];
    for (var i = 0; i < memberList.length; i++) {
      var m = memberList[i];
      balances.push({
        name:      m,
        paid:      r2(paid[m] || 0),
        fairShare: share,
        balance:   balMap[m]
      });
    }

    return {
      totalExpense:     r2(total),
      fairShare:        share,
      memberCount:      memberList.length,
      transactionCount: txns.length,
      balances:         balances,
      transactions:     txns
    };
  }

  // Sort two parallel arrays by amount descending
  function sortDesc(names, amts) {
    var n = amts.length;
    for (var i = 0; i < n-1; i++) {
      for (var j = 0; j < n-1-i; j++) {
        if (amts[j] < amts[j+1]) {
          var ta = amts[j]; amts[j] = amts[j+1]; amts[j+1] = ta;
          var tn = names[j]; names[j] = names[j+1]; names[j+1] = tn;
        }
      }
    }
  }

  // Round to 2 decimal places
  function r2(v) { return Math.round(v * 100) / 100; }

  // ══════════════════════════════════════════
  //  SHOW RESULTS
  // ══════════════════════════════════════════
  function showResults(data, exps) {
    // Stats
    setStat("s1", symbol + data.totalExpense.toFixed(2));
    setStat("s2", symbol + data.fairShare.toFixed(2));
    setStat("s3", data.memberCount);
    setStat("s4", data.transactionCount);

    // Show balance table
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("balContent").classList.remove("hidden");

    var tbody = document.getElementById("balTbody");
    tbody.innerHTML = "";
    for (var i = 0; i < data.balances.length; i++) {
      var b = data.balances[i];
      var badge = "";
      if      (b.balance >  0.01) badge = '<span class="bp">+' + symbol + b.balance.toFixed(2) + '</span>';
      else if (b.balance < -0.01) badge = '<span class="bn">−' + symbol + Math.abs(b.balance).toFixed(2) + '</span>';
      else                         badge = '<span class="bz">Settled ✓</span>';

      var tr = document.createElement("tr");
      tr.innerHTML = '<td><strong>' + esc(b.name) + '</strong></td>'
        + '<td>' + symbol + b.paid.toFixed(2) + '</td>'
        + '<td>' + symbol + b.fairShare.toFixed(2) + '</td>'
        + '<td>' + badge + '</td>';
      tbody.appendChild(tr);
    }

    buildBar(data.balances);

    // Settlements
    document.getElementById("settlCard").classList.remove("hidden");
    var tw = document.getElementById("txnWrap");
    tw.innerHTML = "";
    if (data.transactions.length === 0) {
      tw.innerHTML = '<p style="font-size:14px;color:var(--text-light);font-weight:600;padding:4px 0;">🎉 Everyone is already settled up!</p>';
    } else {
      for (var i = 0; i < data.transactions.length; i++) {
        var t = data.transactions[i];
        var item = document.createElement("div");
        item.className = "txn-item";
        item.innerHTML = '<span class="txn-from">' + esc(t.from) + '</span>'
          + '<span class="txn-arr">→</span>'
          + '<span class="txn-to">'  + esc(t.to)   + '</span>'
          + '<span class="txn-amt">pays ' + symbol + Number(t.amount).toFixed(2) + '</span>';
        tw.appendChild(item);
      }
    }

    // History
    document.getElementById("histCard").classList.remove("hidden");
    var hw = document.getElementById("histWrap");
    hw.innerHTML = "";
    var emos = ["🍕","🚕","🛒","🎬","🏨","☕","🍔","⚽","🎮","💊","🎂","✈️"];
    for (var i = 0; i < exps.length; i++) {
      var e = exps[i];
      var item = document.createElement("div");
      item.className = "hist-item";
      item.innerHTML = '<div class="hist-ico">' + emos[i % emos.length] + '</div>'
        + '<div class="hist-info"><div class="hist-title">' + esc(e.description) + '</div>'
        + '<div class="hist-sub">Paid by ' + esc(e.paidBy) + '</div></div>'
        + '<div class="hist-amt">' + symbol + Number(e.amount).toFixed(2) + '</div>';
      hw.appendChild(item);
    }
  }

  function setStat(id, val) {
    var el = document.getElementById(id);
    el.className = "stat-val";
    el.textContent = val;
  }

  function buildBar(balances) {
    var inner = document.getElementById("barInner");
    inner.innerHTML = "";
    var max = 0;
    for (var i = 0; i < balances.length; i++) if (balances[i].paid > max) max = balances[i].paid;
    if (!max) return;
    for (var i = 0; i < balances.length; i++) {
      var b = balances[i];
      var pct = (b.paid / max * 100).toFixed(1);
      var row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = '<div class="bar-name">' + esc(b.name) + '</div>'
        + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%">'
        + '<span class="bar-val">' + symbol + b.paid.toFixed(0) + '</span></div></div>';
      inner.appendChild(row);
    }
  }

  function toggleChart() {
    chartOn = !chartOn;
    document.getElementById("barWrap").className = "bar-wrap" + (chartOn ? " show" : "");
    document.getElementById("chartBtn").textContent = chartOn ? "📊 Hide Chart" : "📊 Show Chart";
  }

  // ══════════════════════════════════════════
  //  RESET
  // ══════════════════════════════════════════
  function resetAll() {
    members = [];
    renderChips();
    setBadge("mBadge", 0, "member");
    document.getElementById("expRows").innerHTML = "";
    rowId = 0;
    addRow();

    var ids  = ["s1","s2","s3","s4"];
    var txts = ["awaiting data","equal share","in this group","min. required"];
    for (var i = 0; i < ids.length; i++) {
      document.getElementById(ids[i]).className = "stat-val ph";
      document.getElementById(ids[i]).textContent = txts[i];
    }
    document.getElementById("emptyState").classList.remove("hidden");
    document.getElementById("balContent").classList.add("hidden");
    document.getElementById("settlCard").classList.add("hidden");
    document.getElementById("histCard").classList.add("hidden");
    chartOn = false;
    document.getElementById("barWrap").className = "bar-wrap";
    document.getElementById("chartBtn").textContent = "📊 Show Chart";
    toast("🔄 All cleared!", "tok");
  }

  // ══════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════
  function toast(msg, cls) {
    var wrap = document.getElementById("toastWrap");
    var t = document.createElement("div");
    t.className = "toast " + cls;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }