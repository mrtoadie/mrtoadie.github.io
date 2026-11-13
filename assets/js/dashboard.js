(function () {
  "use strict";

  /* ================================================================
   *  dashboard.js — live renderer for the homelab cluster page
   *
   *  Fetches data/cluster.json (published by collect.sh on the
   *  control-plane) and data/watcher.json (heartbeat pushed by the
   *  watcher Pi) and renders stats, the cluster overview card, node
   *  cards, the storage card and the watcher card. Falls back to
   *  demo data when the live feed is unreachable, empty, or written
   *  in collector-error mode.
   *
   *  Layout of this file:
   *    1.  Constants & configuration
   *    2.  Helpers (escaping, formatting, icons)
   *    3.  Demo data
   *    4.  Renderers (badge, gauges, bars, cluster card, node cards,
   *        storage, watcher, hardware ages)
   *    5.  Render & load
   *    6.  Bootstrap & polling
   *
   *  Everything lives in one IIFE on purpose: an earlier version had
   *  load() declared twice (inside and outside the closure) and the
   *  outer copy could not see SOURCE / REFRESH_MS. One scope, no trap.
   * ================================================================ */

  /* ================================================================
   *  1. Constants & configuration
   * ================================================================ */

  var SOURCE = "data/cluster.json";
  var WATCHER_SOURCE = "data/watcher.json";
  var REFRESH_MS = 5 * 60 * 1000; // poll interval
  var WATCHER_MAX_AGE_MS = 30 * 60 * 1000; // two missed heartbeats = offline

  /* Static spec line for the watcher card. The cluster nodes show
     specs in the hardware table on the index page instead. */
  var WATCHER_SPECS = ["Raspberry Pi Zero 2W · 512 MB RAM"];

  /* Data contract for data/cluster.json:
     {
       timestamp: "2026-10-24T08:12:00Z",
       nodes: [{ name, role, status, version, age }],
       resource_usage: { "winterfell": {
         cpu_percent, cpu_millicores,
         mem_percent, mem_mib,
         disk_percent,        <- rootfs, feeds the DISK bar
         disk_usb,            <- USB-SSD mount, feeds the storage card
         temp_c, load1, uptime_s, pods
       }},
       pods: { total, running, pending },
       namespaces, deployments, services,
       collector_error  <- set when collect.sh could not reach the API
     }
     The watcher feed (data/watcher.json) carries host, timestamp,
     cpu_percent, mem_percent, disk_percent, temp_c, load1, uptime_s. */

  /* ================================================================
   *  2. Helpers
   * ================================================================ */

  /* HTML-escape anything that came from a JSON feed. */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  /* Value -> number or null (accepts "42%" from older feeds). */
  function num(v) {
    if (v === undefined || v === null) return null;
    var n = parseFloat(String(v).replace("%", ""));
    return isNaN(n) ? null : n;
  }

  /* Thresholds: 65+ warn, 85+ crit — shared by gauges AND bars,
     so both representations speak the same colour vocabulary. */
  function ringClass(p) {
    if (p === null) return "na";
    if (p >= 85) return "crit";
    if (p >= 65) return "warn";
    return "ok";
  }

  /* Temperature: 60 C+ gets the amber warning style. */
  function tempClass(t) {
    if (t === null) return "";
    if (t >= 60) return "stat-warn";
    return "";
  }

  /* Seconds -> compact string: "3 d 4 h" / "14 h 36 m" / "42 Min." */
  function fmtUptime(sec) {
    if (sec === null || sec < 0) return null;
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + " d " + h + " h";
    if (h > 0) return h + " h " + m + " m";
    return m + " Min.";
  }

  /* Timestamp -> "just now" / "5 m" / "3 h" / German date. */
  function ago(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "–";
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " m";
    if (s < 86400) return Math.floor(s / 3600) + " h";
    return d.toLocaleDateString("de-DE");
  }

  /* Mask-icon span; decorative, hence aria-hidden. */
  function icon(id) {
    return '<span class="ic ic-' + id + '" aria-hidden="true"></span>';
  }

  function specLine(iconId, text, extraClass) {
    return (
      '<div class="node-spec ' +
      (extraClass || "") +
      '">' +
      icon(iconId) +
      "<span>" +
      esc(text) +
      "</span></div>"
    );
  }

  /* ================================================================
   *  3. Demo data (used when the live feed is unusable)
   * ================================================================ */

  var DEMO = {
    timestamp: new Date().toISOString(),
    nodes: [
      {
        name: "winterfell",
        role: "control-plane",
        status: "True",
        version: "v1.36.3+k3s1",
      },
      {
        name: "worker01",
        role: "worker",
        status: "True",
        version: "v1.36.2+k3s1",
      },
      {
        name: "worker02",
        role: "worker",
        status: "True",
        version: "v1.36.3+k3s1",
      },
      {
        name: "worker03",
        role: "worker",
        status: "True",
        version: "v1.36.3+k3s1",
      },
    ],
    resource_usage: {
      winterfell: {
        cpu_percent: 14,
        mem_percent: 41,
        disk_percent: 78,
        disk_usb: 43,
        temp_c: 37,
        pods: 25,
        uptime_s: 52546,
      },
      worker01: {
        cpu_percent: 9,
        mem_percent: 33,
        disk_percent: 84,
        disk_usb: null,
        temp_c: 38,
        pods: 4,
        uptime_s: 22005,
      },
      worker02: {
        cpu_percent: 22,
        mem_percent: 58,
        disk_percent: 82,
        disk_usb: null,
        temp_c: 41,
        pods: 3,
        uptime_s: 16094,
      },
      worker03: {
        cpu_percent: 76,
        mem_percent: 26,
        disk_percent: 69,
        disk_usb: null,
        temp_c: 44,
        pods: 2,
        uptime_s: 62551,
      },
    },
    pods: { total: 47, running: 45, pending: 2 },
    namespaces: 12,
    deployments: 18,
    services: 9,
  };

  /* ================================================================
   *  4. Renderers
   * ================================================================ */

  /* -------- LIVE / DEMO DATA badge in the top bar --------
     feedNote (optional) goes into the title attribute, so hovering
     shows the failure reason even when the banner is scrolled away. */
  function setFeedBadge(isDemo, feedNote) {
    var el = document.getElementById("feed-badge");
    if (!el) return;
    el.className = "feed-badge " + (isDemo ? "demo" : "live");
    el.innerHTML =
      '<span class="dot"></span>' + (isDemo ? "DEMO DATA" : "LIVE");
    el.title = feedNote || "";
  }

  /* -------- Gauge ring (cluster overview only) --------
     The overview shows the state of the WHOLE cluster at a glance,
     the node cards below carry the precise per-node values — hence
     rings up top, bars below. Both use ringClass(), so thresholds
     and colours are identical. Markup matches the existing
     .gauge / .gauge-wrap / small CSS. */
  function gauge(p, label) {
    var pct = p === null ? 0 : Math.max(0, Math.min(100, p));
    return (
      '<div class="gauge-wrap">' +
      '<div class="gauge ' +
      ringClass(p) +
      '" style="--pct:' +
      pct +
      '">' +
      "<span>" +
      (p === null ? "–" : p.toFixed(0) + "%") +
      "</span>" +
      "</div>" +
      "<small>" +
      label +
      "</small>" +
      "</div>"
    );
  }

  /* -------- Metric bar (node cards) --------
     Colour = state (ok / warn / crit / na), consistent across
     every card. Never colour per metric — colour is the vocabulary. */
  function bar(p, label) {
    var c = ringClass(p); // keeps the 65/85 thresholds
    var pct = p === null ? 0 : Math.max(0, Math.min(100, p));
    return (
      '<div class="metric">' +
      '<div class="metric-top">' +
      "<span>" +
      label +
      '</span><span class="metric-val">' +
      (p === null ? "–" : p.toFixed(0) + "%") +
      "</span></div>" +
      '<div class="metric-track"><div class="metric-fill ' +
      c +
      '" style="width:' +
      pct +
      '%"></div></div>' +
      "</div>"
    );
  }

  /* -------- Temperature bar (absolute scale, not a percentage) -------- */
  function tempBar(t) {
    var MAX_C = 80; // scale ceiling: 80 °C = full bar
    var c = t === null ? "na" : t >= 70 ? "crit" : t >= 60 ? "warn" : "ok";
    var pct = t === null ? 0 : Math.max(0, Math.min(100, (t / MAX_C) * 100));
    return (
      '<div class="metric">' +
      '<div class="metric-top"><span>Temp</span>' +
      '<span class="metric-val">' +
      (t === null ? "–" : t.toFixed(0) + " °C") +
      "</span></div>" +
      '<div class="metric-track"><div class="metric-fill ' +
      c +
      '" style="width:' +
      pct +
      '%"></div></div>' +
      "</div>"
    );
  }

  /* -------- Cluster-wide aggregate (avg of Ready nodes only) --------
     Nodes without data are skipped per metric, NotReady nodes are
     excluded entirely — no fake zeros ever enter an average. */
  function clusterTotals(usage, nodes) {
    var vals = { cpu: [], mem: [], disk: [] };
    nodes.forEach(function (n) {
      if (n.status !== "True") return;
      var u = usage[n.name] || {};
      var c = num(u.cpu_percent !== undefined ? u.cpu_percent : u.cpu);
      var m = num(u.mem_percent !== undefined ? u.mem_percent : u.mem);
      var d = num(u.disk_percent);
      if (c !== null) vals.cpu.push(c);
      if (m !== null) vals.mem.push(m);
      if (d !== null) vals.disk.push(d);
    });
    function avg(a) {
      return a.length
        ? a.reduce(function (x, y) {
            return x + y;
          }, 0) / a.length
        : null;
    }
    return { cpu: avg(vals.cpu), mem: avg(vals.mem), disk: avg(vals.disk) };
  }

  /* -------- Cluster overview: one tile per metric, matching the
     stats row above. Rings = cluster at a glance, bars = per-node
     precision in the cards below. */
  /* -------- Cluster overview: tiles + legend -------- */
  function clusterCard(t, readyCount, totalCount) {
    var caption =
      "Cluster Overview — average across " +
      readyCount +
      " ready node" +
      (readyCount === 1 ? "" : "s") +
      " of " +
      totalCount;
    return (
      '<p class="cluster-caption">' +
      caption +
      "</p>" +
      '<div class="cluster-grid">' +
      '<article class="cluster-tile">' +
      gauge(t.cpu, "CPU ø") +
      "</article>" +
      '<article class="cluster-tile">' +
      gauge(t.mem, "RAM ø") +
      "</article>" +
      '<article class="cluster-tile">' +
      gauge(t.disk, "DISK ø") +
      "</article>" +
      "</div>" +
      '<div class="cluster-legend">' +
      '<span title="under 65%"><i class="lg lg-ok"></i>Healthy</span>' +
      '<span title="65–84%"><i class="lg lg-warn"></i>Warning</span>' +
      '<span title="85% and above"><i class="lg lg-crit"></i>Critical</span>' +
      "</div>"
    );
  }

  /* -------- Node card --------
     Structure: head (role/status) -> name -> uptime -> four bars ->
     footer (version, pods). Board/RAM/OS live in the hardware
     table on the index page, not here — one home per information. */
  function nodeCard(n, usage) {
    var u = usage[n.name] || {};
    var cpu = num(u.cpu_percent !== undefined ? u.cpu_percent : u.cpu);
    var mem = num(u.mem_percent !== undefined ? u.mem_percent : u.mem);
    var temp = num(u.temp_c);
    var pods = num(u.pods);
    var disk = num(u.disk_percent);
    var uptime = fmtUptime(num(u.uptime_s));
    var isReady = n.status === "True";
    var isCp = /control/i.test(n.role || "");

    /* Uptime — visible above the bars */
    var uptimeHtml = "";
    if (uptime !== null) {
      uptimeHtml = specLine("clock", "Uptime " + uptime);
    }

    /* Footer below the bars: version + pods */
    var footerHtml = "";
    if (n.version) footerHtml += specLine("tag", esc(n.version));
    if (pods !== null) {
      footerHtml += specLine("pods", "Pods " + pods.toFixed(0));
    }

    return (
      '<article class="node-card ' +
      (isReady ? "ready" : "notready") +
      (isCp ? " cp" : "") +
      '">' +
      '<div class="node-head">' +
      '<span class="led"></span>' +
      '<span class="node-role">' +
      icon(isCp ? "crown" : "server") +
      (isCp ? "Control Plane" : "Worker Node") +
      "</span>" +
      '<span class="node-status ' +
      (isReady ? "ready" : "notready") +
      '">' +
      icon(isReady ? "check" : "alert") +
      (isReady ? "Ready" : "NotReady") +
      "</span>" +
      "</div>" +
      '<div class="node-name">' +
      esc(n.name) +
      "</div>" +
      uptimeHtml +
      '<div class="metrics">' +
      bar(cpu, "CPU") +
      bar(mem, "RAM") +
      bar(disk, "DISK") +
      tempBar(temp) +
      "</div>" +
      '<div class="node-footer">' +
      footerHtml +
      "</div>" +
      "</article>"
    );
  }

  /* -------- USB-SSD storage card --------
     Renders from winterfell's disk_usb value. Falls back to
     disk_percent (rootfs) when disk_usb is absent. Bails out
     silently if the container is not in the markup. */
  function renderStorageUsage(data) {
    var el = document.getElementById("usb-storage-card");
    if (!el) return;

    var usage = (data && data.resource_usage) || {};
    var winterfell = usage.winterfell || {};
    var raw = winterfell.disk_usb;
    if (raw === undefined || raw === null) raw = winterfell.disk_percent;

    var percent = num(raw);
    var isFallback =
      winterfell.disk_usb === undefined || winterfell.disk_usb === null;

    el.classList.remove("ok", "warn", "crit");
    if (percent !== null) {
      if (percent >= 85) el.classList.add("crit");
      else if (percent >= 70) el.classList.add("warn");
      else el.classList.add("ok");
    }

    var bar =
      percent !== null
        ? '<div class="diskbar"><div class="diskbar-fill" style="width:' +
          Math.min(100, Math.round(percent)) +
          '%"></div></div>'
        : '<div class="diskbar"><div class="diskbar-fill na"></div></div>';

    var detail =
      percent === null
        ? "No data in the feed"
        : Math.round(percent) +
          "% in use" +
          (isFallback ? " (Rootfs-Fallback)" : "");

    el.innerHTML =
      '<div class="storage-header">' +
      '<span class="label">USB-SSD · winterfell</span>' +
      '<span class="percent">' +
      (percent !== null ? Math.round(percent) + "%" : "–") +
      "</span>" +
      "</div>" +
      bar +
      '<div class="storage-detail">' +
      esc(detail) +
      "</div>";
  }

  /* -------- Watcher card --------
     Offline = no heartbeat for two 15-minute intervals (30 min).
     The watcher Pi sleeps at night, so an offline badge after dark
     is expected behaviour, not an error. */
  function watcherCard(w) {
    var age = Date.now() - new Date(w.timestamp).getTime();
    var online = age < WATCHER_MAX_AGE_MS;

    var temp = num(w.temp_c);
    var uptime = fmtUptime(num(w.uptime_s));
    var load = num(w.load1);

    var specHtml = specLine("tag", "nights watch");
    WATCHER_SPECS.forEach(function (s) {
      specHtml += specLine("tag", s);
    });

    if (temp !== null) {
      specHtml += specLine(
        "thermometer",
        "Temp " + temp.toFixed(0) + " °C",
        tempClass(temp),
      );
    }
    if (load !== null) {
      specHtml += specLine("clock", "Load " + load.toFixed(2));
    }
    if (uptime !== null) {
      specHtml += specLine("clock", "Uptime " + uptime);
    }
    specHtml += online
      ? specLine("check", "Heartbeat " + ago(w.timestamp))
      : specLine("alert", "Letzter Heartbeat " + ago(w.timestamp));

    return (
      '<article class="node-card ' +
      (online ? "ready" : "notready") +
      ' watcher">' +
      '<div class="node-head">' +
      '<span class="led"></span>' +
      '<span class="node-role">' +
      icon("nightswatch") +
      "Night's Watch" +
      "</span>" +
      '<span class="node-status ' +
      (online ? "ready" : "notready") +
      '">' +
      icon(online ? "check" : "alert") +
      (online ? "Online" : "Offline") +
      "</span>" +
      "</div>" +
      '<div class="node-name">watcher</div>' +
      specHtml +
      "</article>"
    );
  }

  function renderWatcherCard(w) {
    var el = document.getElementById("watcher-card");
    if (!el) return;
    el.innerHTML = watcherCard(w);
  }

  /* -------- Node-age cells in the static hardware table --------
     Name-based lookup via the data-age attribute, order-independent. */
  function fillHardwareAges(nodes) {
    var map = {};
    nodes.forEach(function (n) {
      if (n.age) map[n.name] = n.age;
    });
    document.querySelectorAll("[data-age]").forEach(function (cell) {
      cell.textContent = map[cell.dataset.age] || "–";
    });
  }

  /* ================================================================
   *  5. Render & load
   * ================================================================ */

  function render(d, isDemo, feedNote) {
    var nodes = Array.isArray(d.nodes) ? d.nodes : [];
    var pods = d.pods || {};
    var usage = d.resource_usage || {};
    var ready = nodes.filter(function (n) {
      return n.status === "True";
    }).length;
    var totals = clusterTotals(usage, nodes);

    /* Stats tiles: what runs (counts) */
    var statsEl = document.getElementById("stats");
    if (statsEl) {
      statsEl.innerHTML =
        '<div class="stat"><div class="k">Nodes ready</div><div class="v">' +
        ready +
        "<small> / " +
        nodes.length +
        "</small></div></div>" +
        '<div class="stat"><div class="k">Pods running</div><div class="v">' +
        (pods.running != null ? pods.running : "–") +
        "<small> / " +
        (pods.total != null ? pods.total : "–") +
        "</small></div></div>" +
        '<div class="stat"><div class="k">Namespaces</div><div class="v">' +
        (d.namespaces != null ? d.namespaces : "–") +
        "</div></div>" +
        '<div class="stat"><div class="k">Deployments</div><div class="v">' +
        (d.deployments != null ? d.deployments : "–") +
        "</div></div>";
    }

    /* Cluster overview card: how loaded the cluster is */
    var clusterEl = document.getElementById("cluster-overview");
    if (clusterEl) {
      clusterEl.innerHTML = clusterCard(totals, ready, nodes.length);
    }

    /* Per-node cards */
    fillHardwareAges(nodes);
    var metricsEl = document.getElementById("node-metrics");
    if (metricsEl) {
      metricsEl.innerHTML = nodes.length
        ? nodes
            .map(function (n) {
              return nodeCard(n, usage);
            })
            .join("")
        : '<p class="loading">Keine Node-Daten im Feed.</p>';
    }

    var info = document.getElementById("refresh-info");
    if (info) {
      info.textContent =
        "auto-refresh: 5 m · last updated: " + ago(d.timestamp);
    }

    var note = document.getElementById("demo-note");
    if (note) {
      note.style.display = isDemo ? "block" : "none";
      if (feedNote) note.textContent = feedNote;
    }

    setFeedBadge(isDemo, feedNote);
    renderStorageUsage(d);
  }

  function load() {
    fetch(SOURCE + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        /* Feed written by collect.sh in error mode: collector_error is
           set and nodes is empty. Treat it exactly like a missing file.
           The feed timestamp tells the visitor how long the outage has
           been visible in the feed. */
        if (data && data.collector_error) {
          throw new Error(
            "collector: " +
              data.collector_error +
              " · no live data since " +
              ago(data.timestamp),
          );
        }
        if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) {
          throw new Error("empty feed");
        }
        render(data, false);
      })
      .catch(function (err) {
        console.warn("cluster.json unusable:", err.message);
        render(
          DEMO,
          true,
          "Live feed unavailable — showing demo data (" + err.message + ")",
        );
      });
  }

  function loadWatcherStatus() {
    fetch(WATCHER_SOURCE + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(renderWatcherCard)
      .catch(function () {
        /* keep the previous badge state */
      });
  }

  /* ================================================================
   *  6. Bootstrap & polling
   * ================================================================ */

  load();
  loadWatcherStatus();
  setInterval(load, REFRESH_MS);
  setInterval(loadWatcherStatus, REFRESH_MS);
})();

/* ================================================================
 *  REMINDER — style.css needs these blocks IN THE MAIN SCOPE
 *  (not inside a media query):
 *
 *  .cluster-card {
 *      margin: 1.5rem 0;
 *  }
 *  .cluster-card-inner {
 *      border: 1px solid var(--accent);
 *      border-radius: 6px;
 *      background: var(--card);
 *      padding: 1rem 1.25rem;
 *  }
 *  .cluster-head {
 *      display: flex;
 *      justify-content: space-between;
 *      align-items: baseline;
 *      flex-wrap: wrap;
 *      gap: 0.25rem 1rem;
 *      padding-bottom: 0.75rem;
 *      margin-bottom: 1rem;
 *      border-bottom: 1px solid var(--border);
 *  }
 *  .cluster-head .label {
 *      color: var(--accent);
 *      font-weight: 600;
 *      letter-spacing: 0.04em;
 *      text-transform: uppercase;
 *      font-size: 0.85rem;
 *  }
 *  .cluster-caption {
 *      font-size: 0.78rem;
 *      color: var(--faint);
 *  }
 *
 *  Cluster gauges scaled up for the wide card (desktop):
 *  .cluster-gauges {
 *      margin-top: 0.75rem;
 *      padding-top: 0;
 *      justify-content: space-evenly;
 *      gap: 1rem;
 *  }
 *  .cluster-gauges .gauge {
 *      width: 90px;
 *      height: 90px;
 *  }
 *  .cluster-gauges .gauge span {
 *      width: 72px;
 *      height: 72px;
 *      font-size: 1.2rem;
 *  }
 *  .cluster-gauges .gauge-wrap small {
 *      font-size: 0.9rem;
 *  }
 *
 *  index.html already has the container between #stats and
 *  #node-metrics — verified, nothing to add there.
 * ================================================================ */
