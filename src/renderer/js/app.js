(function () {
  "use strict";

  // ————— cores/constantes —————
  var REASONS = [
    { id: "conteudo", label: "Não sabia o conteúdo", color: "#B5623C" },
    { id: "interpretacao", label: "Interpretei errado", color: "#B08828" },
    { id: "distracao", label: "Distração / bobeira", color: "#7B8A8B" },
    { id: "pegadinha", label: "Caí na pegadinha", color: "#9A5B8F" },
    { id: "tempo", label: "Faltou tempo / chutei", color: "#5E7B9E" },
  ];

  // ————— estado (cache em memória, espelha o MongoDB) —————
  var subjects = [];
  var log = {};
  var entries = [];
  var viewDate = todayKey();
  var currentTab = "estudos";
  var errReason = REASONS[0].id;
  var errFilter = "todas";
  var editingMinSubject = null; // matéria cujo campo de tempo está em edição manual (separado dos botões +/-)
  var showRevised = false;
  var subjectRankSort = "min"; // 'min' | 'days' | 'q'
  var renamingSubject = null; // matéria cujo nome está em edição inline

  // ————— estado CRONÔMETRO —————
  var timerMode = "stopwatch"; // 'stopwatch' | 'countdown' | 'pomodoro'
  var timerSubject = "";
  var timerStatus = "idle"; // 'idle' | 'running' | 'paused'
  var timerInterval = null;
  var timerLastTickAt = null; // Date.now() do último tick processado, p/ medir tempo real decorrido
  var timerElapsedSec = 0; // modo cronômetro: total decorrido
  var timerTotalCountableSec = 0; // segundos "de estudo" válidos nesta sessão (usado p/ commit de minutos)
  var timerCommittedMin = 0; // minutos já gravados no banco nesta sessão
  var timerCountdownDurationMin = 25;
  var timerCountdownRemainingSec = timerCountdownDurationMin * 60;
  var timerPomodoroFocoMin = 25;
  var timerPomodoroPausaMin = 5;
  var timerPomodoroPhase = "foco"; // 'foco' | 'pausa'
  var timerPomodoroRemainingSec = timerPomodoroFocoMin * 60;
  var timerPomodoroCycles = 0;

  // ————— util —————
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDay(key) { var p = key.split("-").map(Number); var date = new Date(p[0], p[1] - 1, p[2]); var wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][date.getDay()]; return wd + " " + pad(p[2]) + "/" + pad(p[1]); }
  function fmtDate(ts) { var d = new Date(ts); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); }
  function fmtHours(min) { var h = Math.floor(min / 60), m = min % 60; if (h === 0) return m + "min"; if (m === 0) return h + "h"; return h + "h" + pad(m); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function reasonMeta(id) { for (var i = 0; i < REASONS.length; i++) { if (REASONS[i].id === id) return REASONS[i]; } return REASONS[0]; }

  // ————— persistência (MongoDB local, via processo principal do Electron) —————
  async function load() {
    subjects = await window.api.subjects.list();
    if (!subjects.length) {
      await window.api.subjects.add("Matemática");
      await window.api.subjects.add("Português");
      subjects = await window.api.subjects.list();
    }
    log = await window.api.studyLog.getAll();
    entries = await window.api.mistakes.list();
  }

  // ————— toast —————
  var toastTimer;
  function flash(msg) { var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1600); }

  // ————— matérias (compartilhadas) —————
  async function addSubject(name) {
    var n = (name || "").trim();
    if (!n) return false;
    var res = await window.api.subjects.add(n);
    if (!res.ok) { flash(res.reason === "duplicate" ? "Essa matéria já existe" : "Nome inválido"); return false; }
    subjects = await window.api.subjects.list();
    renderAll();
    flash("Matéria adicionada");
    return true;
  }
  async function removeSubject(name) {
    await window.api.subjects.remove(name);
    subjects = await window.api.subjects.list();
    Object.keys(log).forEach(function (k) { delete log[k][name]; });
    entries = entries.filter(function (e) { return e.subject !== name; });
    renderAll();
    flash("Matéria removida");
  }
  function rerenderForTab() { if (currentTab === "erros") renderErros(); else renderEstudos(); }
  function startRenameSubject(subject) {
    renamingSubject = subject;
    rerenderForTab();
    var input = document.querySelector("[data-renameinput]");
    if (input) { input.focus(); input.select(); }
  }
  function cancelRenameSubject() {
    renamingSubject = null;
    rerenderForTab();
  }
  async function commitRenameSubject(oldName, novo) {
    novo = (novo || "").trim();
    renamingSubject = null;
    if (!novo || novo === oldName) { rerenderForTab(); return; }
    var res = await window.api.subjects.rename(oldName, novo);
    if (!res.ok) { flash(res.reason === "duplicate" ? "Já existe uma matéria com esse nome" : "Nome inválido"); rerenderForTab(); return; }
    await load();
    renderAll();
    flash("Matéria renomeada");
  }

  // ————— backup —————
  async function exportBackup() {
    var res = await window.api.backup.export();
    if (res.ok) flash("Backup salvo ✓");
    else if (res.reason !== "canceled") flash("Não foi possível salvar o backup");
  }
  async function importBackup() {
    var res = await window.api.backup.import();
    if (res.ok) { await load(); renderAll(); flash("Dados restaurados ✓"); }
    else if (res.reason === "invalid-file") flash("Arquivo inválido");
  }

  // ————— cálculos ESTUDOS —————
  function computeStats() {
    var keys = Object.keys(log), totalMin = 0, totalQ = 0, activeDays = 0, perDay = [];
    keys.forEach(function (k) {
      var m = 0, q = 0; var day = log[k];
      Object.keys(day).forEach(function (s) { m += day[s].min || 0; q += day[s].q || 0; });
      if (m > 0 || q > 0) { activeDays++; perDay.push({ key: k, min: m, q: q }); }
      totalMin += m; totalQ += q;
    });
    perDay.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
    var avg = activeDays ? Math.round(totalMin / activeDays) : 0;
    var set = {}; perDay.forEach(function (d) { set[d.key] = true; });
    var streak = 0; var d = new Date();
    for (var i = 0; i < 400; i++) {
      var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      if (set[key]) { streak++; d.setDate(d.getDate() - 1); }
      else if (i === 0) { d.setDate(d.getDate() - 1); }
      else break;
    }
    return { totalMin: totalMin, totalQ: totalQ, activeDays: activeDays, avg: avg, streak: streak, perDay: perDay.slice(0, 14) };
  }

  function dayTotals() {
    var day = log[viewDate] || {}, min = 0, q = 0;
    Object.keys(day).forEach(function (s) { min += day[s].min || 0; q += day[s].q || 0; });
    return { min: min, q: q };
  }

  async function updateEntry(subject, field, delta) {
    var result = field === "min"
      ? await window.api.studyLog.adjustMinutes(viewDate, subject, delta)
      : await window.api.studyLog.adjustQuestions(viewDate, subject, delta);
    if (!log[viewDate]) log[viewDate] = {};
    log[viewDate][subject] = { min: result.minutes, q: result.questions };
    renderEstudos();
  }
  async function setEntryQ(subject, value) {
    var result = await window.api.studyLog.setQuestions(viewDate, subject, value);
    if (!log[viewDate]) log[viewDate] = {};
    log[viewDate][subject] = { min: result.minutes, q: result.questions };
    renderMetricsAndHistory();
  }
  async function setEntryMin(subject, value) {
    var result = await window.api.studyLog.setMinutes(viewDate, subject, value);
    if (!log[viewDate]) log[viewDate] = {};
    log[viewDate][subject] = { min: result.minutes, q: result.questions };
    editingMinSubject = null;
    renderEstudos();
  }
  function startMinEdit(subject) {
    editingMinSubject = subject;
    renderEstudos();
    var input = document.querySelector("#subjRows input[data-mininput]");
    if (input) { input.focus(); input.select(); }
  }
  function cancelMinEdit() {
    editingMinSubject = null;
    renderEstudos();
  }

  // ————— render ESTUDOS —————
  function renderEstudos() {
    renderMetricsAndHistory();
    // dia
    var isToday = viewDate === todayKey();
    document.getElementById("dayTitle").textContent = isToday ? "Hoje" : fmtDay(viewDate);
    var dt = dayTotals();
    document.getElementById("daySub").textContent = fmtHours(dt.min) + " · " + dt.q + " questões";
    document.getElementById("nextDay").disabled = isToday;
    // linhas
    var host = document.getElementById("subjRows"); host.innerHTML = "";
    if (!subjects.length) {
      host.innerHTML = '<div class="muted" style="padding:22px 4px; font-size:14px; font-style:italic;">Nenhuma matéria ainda. Adicione uma abaixo.</div>';
    }
    var day = log[viewDate] || {};
    subjects.forEach(function (subj) {
      var e = day[subj] || { min: 0, q: 0 };
      var row = document.createElement("div");
      row.className = "subjrow";
      row.style.cssText = "display:grid; grid-template-columns:1fr auto auto; gap:12px; align-items:center; padding:12px 4px; border-bottom:1px solid var(--line);";
      row.innerHTML =
        '<div style="display:flex; align-items:center; gap:6px; min-width:0;">' +
        (renamingSubject === subj
          ? '<input class="inp" data-renameinput="' + esc(subj) + '" value="' + esc(subj) + '" style="max-width:220px; padding:4px 8px;" title="Enter para salvar · Esc para cancelar" />'
          : '<span style="font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(subj) + '</span>' +
            '<button class="xbtn" data-rename-subj="' + esc(subj) + '" title="Renomear matéria">✎</button>' +
            '<button class="xbtn" data-rm-subj="' + esc(subj) + '" title="Remover matéria">✕</button>'
        ) +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:5px; width:148px; justify-content:center;">' +
        '<span class="stepbtn" data-min="' + esc(subj) + '" data-d="-15">−</span>' +
        (editingMinSubject === subj
          ? '<input class="num" data-mininput="' + esc(subj) + '" value="' + (e.min || 0) + '" inputmode="numeric" title="Enter para salvar · Esc para cancelar" />'
          : '<span style="font-size:13px; color:' + (e.min ? "var(--ink)" : "var(--ink-soft)") + '; min-width:48px; text-align:center; font-variant-numeric:tabular-nums;">' + fmtHours(e.min) + '</span>' +
            '<button class="xbtn" data-edit-min="' + esc(subj) + '" title="Digitar valor exato de minutos">✎</button>'
        ) +
        '<span class="stepbtn" data-min="' + esc(subj) + '" data-d="15">+</span>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:5px; width:148px; justify-content:center;">' +
        '<span class="stepbtn" data-q="' + esc(subj) + '" data-d="-5">−</span>' +
        '<input class="num" data-qinput="' + esc(subj) + '" value="' + (e.q || 0) + '" inputmode="numeric" />' +
        '<span class="stepbtn" data-q="' + esc(subj) + '" data-d="5">+</span>' +
        '</div>';
      host.appendChild(row);
    });
  }

  function renderMetricsAndHistory() {
    var s = computeStats();
    document.getElementById("streakNum").textContent = s.streak;
    document.getElementById("streakNum").style.color = s.streak > 0 ? "var(--olive)" : "var(--ink-soft)";
    document.getElementById("streakLabel").textContent = s.streak === 1 ? "dia seguido" : "dias seguidos";
    document.getElementById("mTotal").textContent = fmtHours(s.totalMin);
    document.getElementById("mAvg").textContent = fmtHours(s.avg);
    document.getElementById("mDays").textContent = s.activeDays;
    document.getElementById("mQ").textContent = s.totalQ;
    renderSubjectRanking();
    var dt = dayTotals();
    document.getElementById("daySub").textContent = fmtHours(dt.min) + " · " + dt.q + " questões";
    // history
    var chart = document.getElementById("historyChart"); chart.innerHTML = "";
    if (!s.perDay.length) {
      chart.innerHTML = '<div class="muted" style="font-size:14px; font-style:italic;">Seu histórico aparece aqui após o primeiro dia registrado.</div>';
      return;
    }
    var maxBar = Math.max(60); s.perDay.forEach(function (d) { if (d.min > maxBar) maxBar = d.min; });
    s.perDay.forEach(function (d) {
      var pct = Math.min(100, (d.min / maxBar) * 100);
      var row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; gap:10px;";
      row.innerHTML =
        '<span class="muted" style="width:62px; font-size:12px; text-align:right; font-variant-numeric:tabular-nums;">' + fmtDay(d.key) + '</span>' +
        '<div style="flex:1; background:#EDE7D8; border-radius:5px; height:22px; position:relative; overflow:hidden;">' +
        '<div style="width:' + pct + '%; height:100%; background:linear-gradient(90deg, var(--olive-soft), var(--olive)); border-radius:5px;"></div>' +
        '<span style="position:absolute; right:8px; top:0; height:100%; display:flex; align-items:center; font-size:11.5px; color:var(--ink); font-weight:600;">' + fmtHours(d.min) + (d.q ? " · " + d.q + "q" : "") + '</span>' +
        '</div>';
      chart.appendChild(row);
    });
  }

  function computeSubjectRanking() {
    var map = {};
    subjects.forEach(function (s) { map[s] = { subject: s, min: 0, q: 0, days: 0 }; });
    Object.keys(log).forEach(function (dateKey) {
      var day = log[dateKey];
      Object.keys(day).forEach(function (s) {
        if (!map[s]) map[s] = { subject: s, min: 0, q: 0, days: 0 };
        var e = day[s];
        map[s].min += e.min || 0;
        map[s].q += e.q || 0;
        if ((e.min || 0) > 0 || (e.q || 0) > 0) map[s].days += 1;
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return b[subjectRankSort] - a[subjectRankSort]; });
    return arr;
  }

  function renderSubjectRanking() {
    document.querySelectorAll(".ranksort").forEach(function (el) {
      el.classList.toggle("on", el.getAttribute("data-sort") === subjectRankSort);
    });
    var host = document.getElementById("subjRankRows"); host.innerHTML = "";
    var arr = computeSubjectRanking();
    if (!arr.length) {
      host.innerHTML = '<div class="muted" style="padding:22px 4px; font-size:14px; font-style:italic;">Sem dados ainda. Registre estudos para ver o ranking aqui.</div>';
      return;
    }
    arr.forEach(function (d, idx) {
      var row = document.createElement("div");
      row.style.cssText = "display:grid; grid-template-columns:1fr 74px 56px 70px; gap:12px; align-items:center; padding:10px 4px; border-bottom:1px solid var(--line);";
      row.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; min-width:0;">' +
        '<span class="muted" style="font-size:11.5px; width:16px; text-align:right;">' + (idx + 1) + '</span>' +
        '<span style="font-size:14.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(d.subject) + '</span>' +
        '</div>' +
        '<span style="text-align:center; font-size:13px; font-variant-numeric:tabular-nums;' + (subjectRankSort === "min" ? " font-weight:700; color:var(--olive);" : "") + '">' + fmtHours(d.min) + '</span>' +
        '<span style="text-align:center; font-size:13px; font-variant-numeric:tabular-nums;' + (subjectRankSort === "days" ? " font-weight:700; color:var(--olive);" : "") + '">' + d.days + '</span>' +
        '<span style="text-align:center; font-size:13px; font-variant-numeric:tabular-nums;' + (subjectRankSort === "q" ? " font-weight:700; color:var(--olive);" : "") + '">' + d.q + '</span>';
      host.appendChild(row);
    });
  }

  // ————— cálculos/render ERROS —————
  function computeErrStats() {
    var pending = 0, bySubj = {}, byReason = {};
    entries.forEach(function (e) {
      if (!e.revised) { pending++; bySubj[e.subject] = (bySubj[e.subject] || 0) + 1; byReason[e.reason] = (byReason[e.reason] || 0) + 1; }
    });
    var weak = null, max = -1;
    Object.keys(bySubj).forEach(function (k) { if (bySubj[k] > max) { max = bySubj[k]; weak = k; } });
    return { pending: pending, revised: entries.length - pending, weak: weak, byReason: byReason };
  }

  function renderErros() {
    var s = computeErrStats();
    document.getElementById("evPending").textContent = s.pending;
    document.getElementById("evRevised").textContent = s.revised;
    document.getElementById("evWeak").textContent = s.weak || "—";
    var badge = document.getElementById("badgeErros");
    if (s.pending > 0) { badge.textContent = s.pending; badge.classList.remove("hide"); } else { badge.classList.add("hide"); }
    var box = document.getElementById("reasonBox"); var chips = document.getElementById("reasonChips"); chips.innerHTML = "";
    if (s.pending > 0) {
      box.classList.remove("hide");
      var arr = REASONS.filter(function (r) { return s.byReason[r.id]; }).sort(function (a, b) { return s.byReason[b.id] - s.byReason[a.id]; });
      arr.forEach(function (r) {
        var span = document.createElement("span");
        span.style.cssText = "font-size:12.5px; background:#fff; border:1px solid var(--line); border-radius:6px; padding:4px 9px;";
        span.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:' + r.color + '; margin-right:6px;"></span>' + esc(r.label) + ': <strong>' + s.byReason[r.id] + '</strong>';
        chips.appendChild(span);
      });
    } else { box.classList.add("hide"); }

    var sel = document.getElementById("errSubject"); var prev = sel.value; sel.innerHTML = "";
    subjects.forEach(function (su) { var o = document.createElement("option"); o.value = su; o.textContent = su; sel.appendChild(o); });
    if (subjects.indexOf(prev) > -1) sel.value = prev;

    var rp = document.getElementById("reasonPicker"); rp.innerHTML = "";
    REASONS.forEach(function (r) {
      var span = document.createElement("span");
      span.className = "reason-chip"; span.setAttribute("data-reason", r.id);
      var on = errReason === r.id;
      span.style.borderColor = on ? r.color : "var(--line)";
      span.style.background = on ? r.color : "#fff";
      span.style.color = on ? "#fff" : "var(--ink)";
      span.textContent = r.label;
      rp.appendChild(span);
    });

    var ec = document.getElementById("errSubjChips"); ec.innerHTML = "";
    subjects.forEach(function (su) {
      var span = document.createElement("span");
      span.className = "subjchip";
      span.style.cssText = "font-size:12.5px; background:var(--card); border:1px solid var(--line); border-radius:6px; padding:4px 8px; display:inline-flex; align-items:center;";
      span.innerHTML = renamingSubject === su
        ? '<input class="inp" data-renameinput="' + esc(su) + '" value="' + esc(su) + '" style="width:130px; padding:3px 6px; font-size:12.5px;" title="Enter para salvar · Esc para cancelar" />'
        : esc(su) + '<button class="subjx" data-rename-subj="' + esc(su) + '" title="Renomear">✎</button><button class="subjx" data-rm-subj="' + esc(su) + '" title="Remover">✕</button>';
      ec.appendChild(span);
    });

    var fc = document.getElementById("filterChips"); fc.innerHTML = "";
    var all = document.createElement("span"); all.className = "ghost" + (errFilter === "todas" ? " on" : ""); all.setAttribute("data-filter", "todas"); all.textContent = "Todas"; fc.appendChild(all);
    subjects.forEach(function (su) {
      var span = document.createElement("span"); span.className = "ghost" + (errFilter === su ? " on" : ""); span.setAttribute("data-filter", su); span.textContent = su; fc.appendChild(span);
    });
    var tr = document.getElementById("toggleRevised");
    tr.className = "ghost" + (showRevised ? " on" : "");
    tr.textContent = showRevised ? "✓ mostrando revisados" : "mostrar revisados";

    var list = document.getElementById("errList"); list.innerHTML = "";
    var visible = entries.filter(function (e) {
      if (!showRevised && e.revised) return false;
      if (errFilter !== "todas" && e.subject !== errFilter) return false;
      return true;
    });
    if (!visible.length) {
      var msg = entries.length === 0
        ? "Seu caderno está vazio. Toda vez que errar uma questão, registre aqui — é assim que o erro vira aprendizado."
        : "Nada por aqui com esse filtro. Revisou tudo? Excelente.";
      list.innerHTML = '<div class="muted" style="text-align:center; padding:36px 20px; font-size:14px; font-style:italic; background:var(--card); border:1px dashed var(--line); border-radius:12px;">' + msg + '</div>';
      return;
    }
    visible.forEach(function (e) {
      var rm = reasonMeta(e.reason);
      var card = document.createElement("div");
      card.className = "card-e";
      card.style.cssText = "background:var(--card); border:1px solid " + (e.revised ? "var(--line)" : "var(--clay-soft)") + "; border-left:4px solid " + (e.revised ? "var(--line)" : rm.color) + "; border-radius:10px; padding:14px 16px; opacity:" + (e.revised ? "0.72" : "1") + ";";
      card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">' +
        '<div style="min-width:0; flex:1;">' +
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:5px;">' +
        '<span style="font-size:11.5px; font-weight:700; color:var(--olive); text-transform:uppercase; letter-spacing:.5px;">' + esc(e.subject) + '</span>' +
        '<span class="muted" style="font-size:11px;">· ' + fmtDate(e.ts) + '</span>' +
        '<span style="font-size:11px; color:#fff; background:' + rm.color + '; border-radius:5px; padding:2px 7px;">' + esc(rm.label) + '</span>' +
        '</div>' +
        '<div style="font-size:15px; font-weight:600; margin-bottom:' + (e.lesson ? "5px" : "0") + '; text-decoration:' + (e.revised ? "line-through" : "none") + ';">' + esc(e.topic) + '</div>' +
        (e.lesson ? '<div class="muted" style="font-size:13.5px; line-height:1.45;">💡 ' + esc(e.lesson) + '</div>' : '') +
        '</div>' +
        '<button class="xbtn" data-rm-err="' + e.id + '" title="Remover">✕</button>' +
        '</div>' +
        '<div style="margin-top:11px;">' +
        '<button class="revbtn' + (e.revised ? " done" : "") + '" data-rev="' + e.id + '">' + (e.revised ? "↺ marcar como pendente" : "✓ revisei este") + '</button>' +
        '</div>';
      list.appendChild(card);
    });
  }

  async function addErr() {
    var topic = document.getElementById("errTopic").value.trim();
    var subject = document.getElementById("errSubject").value;
    var lesson = document.getElementById("errLesson").value.trim();
    if (!topic) { flash("Escreva o assunto da questão"); return; }
    if (!subject) { flash("Adicione uma matéria primeiro"); return; }
    await window.api.mistakes.add({ subject: subject, topic: topic, reason: errReason, lesson: lesson });
    entries = await window.api.mistakes.list();
    document.getElementById("errTopic").value = "";
    document.getElementById("errLesson").value = "";
    renderErros(); flash("Erro registrado");
  }

  // ————— CRONÔMETRO —————
  function fmtClock(totalSec) {
    totalSec = Math.max(0, Math.floor(totalSec));
    var h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    return (h > 0 ? h + ":" + pad(m) : pad(m)) + ":" + pad(s);
  }

  function notifyUser(title, body) {
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") { new Notification(title, { body: body }); }
      else if (Notification.permission !== "denied") { Notification.requestPermission(); }
    } catch (e) { /* notificações são só um extra, ignora falha */ }
  }

  async function commitTimerMinutes(subject, minutes) {
    var tKey = todayKey();
    var result = await window.api.studyLog.adjustMinutes(tKey, subject, minutes);
    if (!log[tKey]) log[tKey] = {};
    log[tKey][subject] = { min: result.minutes, q: result.questions };
    renderEstudos();
  }

  function timerResetCounters() {
    timerElapsedSec = 0;
    timerTotalCountableSec = 0;
    timerCommittedMin = 0;
    timerPomodoroPhase = "foco";
    timerPomodoroCycles = 0;
    timerPomodoroRemainingSec = timerPomodoroFocoMin * 60;
    timerCountdownRemainingSec = timerCountdownDurationMin * 60;
  }

  function timerMaybeCommit() {
    var wholeMin = Math.floor(timerTotalCountableSec / 60);
    if (wholeMin > timerCommittedMin) {
      var delta = wholeMin - timerCommittedMin;
      timerCommittedMin = wholeMin;
      commitTimerMinutes(timerSubject, delta);
    }
  }

  function timerTick() {
    if (timerStatus !== "running") return;

    // usa o tempo real decorrido (não "+1 por tick"): setInterval não é confiável
    // quando a janela perde o foco/é minimizada (o Chromium pode atrasar os ticks).
    // Um teto evita contar como estudo um hiato grande (ex.: PC hibernou).
    var now = Date.now();
    var deltaSec = timerLastTickAt ? (now - timerLastTickAt) / 1000 : 1;
    timerLastTickAt = now;
    deltaSec = Math.max(0, Math.min(deltaSec, 3));

    var countable = false;
    if (timerMode === "stopwatch") {
      timerElapsedSec += deltaSec; countable = true;
    } else if (timerMode === "countdown") {
      timerCountdownRemainingSec = Math.max(0, timerCountdownRemainingSec - deltaSec);
      countable = true;
    } else if (timerMode === "pomodoro") {
      timerPomodoroRemainingSec = Math.max(0, timerPomodoroRemainingSec - deltaSec);
      countable = timerPomodoroPhase === "foco";
    }

    if (countable) timerTotalCountableSec += deltaSec;
    timerMaybeCommit();

    if (timerMode === "countdown" && timerCountdownRemainingSec <= 0) {
      clearInterval(timerInterval); timerInterval = null; timerStatus = "idle"; timerLastTickAt = null;
      notifyUser("Tempo esgotado!", timerSubject + " · sessão de " + timerCountdownDurationMin + " min concluída");
      flash("Tempo esgotado — sessão registrada ✓");
      timerResetCounters();
    } else if (timerMode === "pomodoro" && timerPomodoroRemainingSec <= 0) {
      if (timerPomodoroPhase === "foco") {
        timerPomodoroCycles++;
        timerPomodoroPhase = "pausa";
        timerPomodoroRemainingSec = timerPomodoroPausaMin * 60;
        notifyUser("Hora da pausa", "Você focou " + timerPomodoroFocoMin + " min em " + timerSubject);
        flash("Pausa · " + timerPomodoroPausaMin + " min de descanso");
      } else {
        timerPomodoroPhase = "foco";
        timerPomodoroRemainingSec = timerPomodoroFocoMin * 60;
        notifyUser("De volta ao foco", "Retomando " + timerSubject);
        flash("Foco! Vamos lá");
      }
    }

    renderTimer();
  }

  function startTimer() {
    if (!timerSubject) { flash("Escolha uma matéria primeiro"); return; }
    if (timerStatus === "idle") timerResetCounters();
    timerStatus = "running";
    timerLastTickAt = Date.now();
    if (!timerInterval) timerInterval = setInterval(timerTick, 1000);
    renderTimer();
  }

  function pauseTimer() {
    if (timerStatus !== "running") return;
    timerStatus = "paused";
    clearInterval(timerInterval); timerInterval = null;
    timerLastTickAt = null;
    renderTimer();
  }

  function finalizeTimer() {
    clearInterval(timerInterval); timerInterval = null;
    timerLastTickAt = null;
    var min = timerCommittedMin;
    timerStatus = "idle";
    timerResetCounters();
    flash(min > 0 ? "Sessão encerrada · " + fmtHours(min) + " registrados" : "Sessão encerrada");
    renderTimer();
  }

  function setTimerMode(mode) {
    if (timerStatus !== "idle") return;
    timerMode = mode;
    timerResetCounters();
    renderTimer();
  }

  function renderTimer() {
    // matéria
    var sel = document.getElementById("timerSubject");
    if (!subjects.length) {
      sel.innerHTML = '<option value="">Adicione uma matéria</option>';
      timerSubject = "";
    } else {
      var prev = subjects.indexOf(timerSubject) > -1 ? timerSubject : subjects[0];
      sel.innerHTML = "";
      subjects.forEach(function (su) { var o = document.createElement("option"); o.value = su; o.textContent = su; sel.appendChild(o); });
      sel.value = prev;
      timerSubject = prev;
    }
    sel.disabled = timerStatus !== "idle";

    // modos
    ["stopwatch", "countdown", "pomodoro"].forEach(function (m) {
      var btn = document.getElementById("timerMode_" + m);
      btn.classList.toggle("on", timerMode === m);
      btn.disabled = timerStatus !== "idle";
    });
    document.getElementById("timerConfigCountdown").classList.toggle("hide", !(timerMode === "countdown" && timerStatus === "idle"));
    document.getElementById("timerConfigPomodoro").classList.toggle("hide", !(timerMode === "pomodoro" && timerStatus === "idle"));

    // badge de fase (pomodoro)
    var badge = document.getElementById("timerPhaseBadge");
    if (timerMode === "pomodoro" && timerStatus !== "idle") {
      badge.classList.remove("hide");
      badge.textContent = timerPomodoroPhase === "foco"
        ? "Foco · ciclo " + (timerPomodoroCycles + 1)
        : "Pausa · ciclo " + timerPomodoroCycles;
      badge.style.background = timerPomodoroPhase === "foco" ? "var(--olive)" : "var(--gold)";
    } else { badge.classList.add("hide"); }

    // display
    var display;
    if (timerMode === "stopwatch") display = fmtClock(timerElapsedSec);
    else if (timerMode === "countdown") display = fmtClock(timerCountdownRemainingSec);
    else display = fmtClock(timerPomodoroRemainingSec);
    document.getElementById("timerDisplay").textContent = display;

    // subtítulo
    var sub = document.getElementById("timerSub");
    sub.textContent = timerSubject
      ? ("estudando " + timerSubject + (timerCommittedMin > 0 ? " · " + fmtHours(timerCommittedMin) + " registrados" : ""))
      : "adicione uma matéria para começar";

    // botões
    var btnStart = document.getElementById("timerStart"), btnPause = document.getElementById("timerPause"), btnFinish = document.getElementById("timerFinish");
    btnStart.classList.toggle("hide", timerStatus === "running");
    btnStart.textContent = timerStatus === "paused" ? "▶ Retomar" : "▶ Iniciar";
    btnStart.disabled = !timerSubject;
    btnPause.classList.toggle("hide", timerStatus !== "running");
    btnFinish.classList.toggle("hide", timerStatus === "idle");
  }

  function renderAll() { renderEstudos(); renderErros(); renderTimer(); }

  async function clearDay() {
    var dt = dayTotals();
    if (!dt.min && !dt.q) { flash("Esse dia já está zerado"); return; }
    if (!confirm("Zerar todos os minutos e questões de " + (viewDate === todayKey() ? "hoje" : fmtDay(viewDate)) + "?")) return;
    await window.api.studyLog.clearDay(viewDate);
    delete log[viewDate];
    renderEstudos();
    flash("Dia zerado");
  }

  // ————— navegação de data —————
  function shiftDate(delta) {
    var p = viewDate.split("-").map(Number); var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + delta);
    if (d > new Date()) return;
    viewDate = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    renderEstudos();
  }

  // ————— eventos —————
  function bind() {
    document.getElementById("btnExport").addEventListener("click", exportBackup);
    document.getElementById("btnImport").addEventListener("click", importBackup);

    document.getElementById("tabEstudos").addEventListener("click", function () { switchTab("estudos"); });
    document.getElementById("tabErros").addEventListener("click", function () { switchTab("erros"); });

    document.getElementById("prevDay").addEventListener("click", function () { shiftDate(-1); });
    document.getElementById("nextDay").addEventListener("click", function () { shiftDate(1); });
    document.getElementById("clearDay").addEventListener("click", clearDay);

    document.getElementById("addSubjEstudos").addEventListener("click", async function () {
      var i = document.getElementById("newSubjEstudos"); if (await addSubject(i.value)) i.value = "";
    });
    document.getElementById("newSubjEstudos").addEventListener("keydown", async function (e) {
      if (e.key === "Enter") { if (await addSubject(this.value)) this.value = ""; }
    });
    document.getElementById("addSubjErros").addEventListener("click", async function () {
      var i = document.getElementById("newSubjErros"); if (await addSubject(i.value)) i.value = "";
    });
    document.getElementById("newSubjErros").addEventListener("keydown", async function (e) {
      if (e.key === "Enter") { if (await addSubject(this.value)) this.value = ""; }
    });

    document.getElementById("addErr").addEventListener("click", addErr);
    document.getElementById("errTopic").addEventListener("keydown", function (e) { if (e.key === "Enter") addErr(); });
    document.getElementById("errLesson").addEventListener("keydown", function (e) { if (e.key === "Enter") addErr(); });

    document.getElementById("toggleRevised").addEventListener("click", function () { showRevised = !showRevised; renderErros(); });

    // delegação de cliques
    document.body.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.hasAttribute("data-min")) { updateEntry(t.getAttribute("data-min"), "min", parseInt(t.getAttribute("data-d"), 10)); }
      else if (t.hasAttribute("data-q")) { updateEntry(t.getAttribute("data-q"), "q", parseInt(t.getAttribute("data-d"), 10)); }
      else if (t.hasAttribute("data-rm-subj")) { removeSubject(t.getAttribute("data-rm-subj")); }
      else if (t.hasAttribute("data-rename-subj")) { startRenameSubject(t.getAttribute("data-rename-subj")); }
      else if (t.hasAttribute("data-sort")) { subjectRankSort = t.getAttribute("data-sort"); renderSubjectRanking(); }
      else if (t.hasAttribute("data-edit-min")) { startMinEdit(t.getAttribute("data-edit-min")); }
      else if (t.hasAttribute("data-reason")) { errReason = t.getAttribute("data-reason"); renderErros(); }
      else if (t.hasAttribute("data-filter")) { errFilter = t.getAttribute("data-filter"); renderErros(); }
      else if (t.hasAttribute("data-rev")) { toggleRev(t.getAttribute("data-rev")); }
      else if (t.hasAttribute("data-rm-err")) { removeErr(t.getAttribute("data-rm-err")); }
    });

    // input de questões (digitar direto)
    document.body.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t.hasAttribute("data-qinput")) { setEntryQ(t.getAttribute("data-qinput"), t.value); }
      else if (t.hasAttribute("data-mininput")) { setEntryMin(t.getAttribute("data-mininput"), t.value); }
    });

    // dispara sempre ao perder o foco (Enter sem alterar o texto não gera "change")
    document.body.addEventListener("focusout", function (ev) {
      var t = ev.target;
      if (!t.hasAttribute || !t.hasAttribute("data-renameinput")) return;
      var subj = t.getAttribute("data-renameinput");
      if (renamingSubject === subj) commitRenameSubject(subj, t.value);
    });

    // Enter salva / Esc cancela a edição manual de minutos e o renomear de matéria
    document.body.addEventListener("keydown", function (ev) {
      var t = ev.target;
      if (!t.hasAttribute) return;
      if (t.hasAttribute("data-mininput")) {
        if (ev.key === "Enter") { t.blur(); }
        else if (ev.key === "Escape") { cancelMinEdit(); }
      } else if (t.hasAttribute("data-renameinput")) {
        if (ev.key === "Enter") { commitRenameSubject(t.getAttribute("data-renameinput"), t.value); }
        else if (ev.key === "Escape") { cancelRenameSubject(); }
      }
    });

    // cronômetro
    document.getElementById("timerMode_stopwatch").addEventListener("click", function () { setTimerMode("stopwatch"); });
    document.getElementById("timerMode_countdown").addEventListener("click", function () { setTimerMode("countdown"); });
    document.getElementById("timerMode_pomodoro").addEventListener("click", function () { setTimerMode("pomodoro"); });
    document.getElementById("timerSubject").addEventListener("change", function () {
      if (timerStatus === "idle") timerSubject = this.value;
      renderTimer();
    });
    document.getElementById("timerStart").addEventListener("click", startTimer);
    document.getElementById("timerPause").addEventListener("click", pauseTimer);
    document.getElementById("timerFinish").addEventListener("click", finalizeTimer);
    document.getElementById("timerCountdownMin").addEventListener("change", function () {
      var v = Math.max(1, Math.min(300, parseInt(this.value, 10) || 25));
      timerCountdownDurationMin = v; this.value = v;
      if (timerStatus === "idle") timerCountdownRemainingSec = v * 60;
      renderTimer();
    });
    document.getElementById("timerPomodoroFoco").addEventListener("change", function () {
      var v = Math.max(1, Math.min(120, parseInt(this.value, 10) || 25));
      timerPomodoroFocoMin = v; this.value = v;
      if (timerStatus === "idle") timerPomodoroRemainingSec = v * 60;
      renderTimer();
    });
    document.getElementById("timerPomodoroPausa").addEventListener("change", function () {
      var v = Math.max(1, Math.min(60, parseInt(this.value, 10) || 5));
      timerPomodoroPausaMin = v; this.value = v;
      renderTimer();
    });
  }

  async function toggleRev(id) {
    await window.api.mistakes.toggleRevised(id);
    entries = await window.api.mistakes.list();
    renderErros();
  }
  async function removeErr(id) {
    await window.api.mistakes.remove(id);
    entries = await window.api.mistakes.list();
    renderErros(); flash("Removido");
  }

  function switchTab(tab) {
    currentTab = tab;
    document.getElementById("tabEstudos").classList.toggle("on", tab === "estudos");
    document.getElementById("tabErros").classList.toggle("on", tab === "erros");
    document.getElementById("viewEstudos").classList.toggle("hide", tab !== "estudos");
    document.getElementById("viewErros").classList.toggle("hide", tab !== "erros");
  }

  // ————— init —————
  async function init() {
    bind();
    await load();
    renderAll();
  }
  init();
})();
