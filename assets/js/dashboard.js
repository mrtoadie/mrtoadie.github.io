(function () {
    "use strict";

    /* Data contract for data/cluster.json:
     *       {
     *         timestamp: "2026-10-24T08:12:00Z",
     *         nodes: [{
     *           name: "winterfell",
     *           role: "control-plane" | "worker",
     *           status: "True" | "False",
     *           version: "v1.36.3+k3s1",
}],
resource_usage: { "winterfell": {
cpu_percent: 14, cpu_millicores: 507,
mem_percent: 41, mem_mib: 3714,
disk_percent: 39, temp_c: 37,
load1: 0.64, uptime_s: 36361,
pods: 25
}},
pods: { total: 47, running: 45, pending: 2 },
namespaces: 12,
deployments: 18,
services: 9
}

Rendered per node card:
version + specs  -> static / fallback text
temp_c           -> text line (°C), amber from 60 °C
pods             -> text line
load1 + uptime_s -> combined text line
cpu/mem/disk     -> the three ring gauges
temp_c comes from /sys/class/thermal on each host, pods is the number of
Running pods scheduled on that node (both added in collect.sh v2). */

    var SOURCE = "data/cluster.json";
    var REFRESH_MS = 5 * 60 * 1000;

    var SPEC_FALLBACK = {
        winterfell: ["Raspberry Pi 4 · 8 GB RAM"],
 worker01: ["Raspberry Pi 4 · 1 GB RAM"],
 worker02: ["Raspberry Pi 4 · 1 GB RAM"],
 worker03: ["Raspberry Pi 4 · 2 GB RAM"],
 "*": [],
    };

    var DEMO = {
        timestamp: new Date().toISOString(),
 nodes: [
     { name: "winterfell", role: "control-plane", status: "True", version: "v1.36.3+k3s1", specs: ["Raspberry Pi 4 · 8 GB RAM"] },
 { name: "worker01", role: "worker", status: "True", version: "v1.36.2+k3s1", specs: ["Raspberry Pi 4 · 1 GB RAM"] },
 { name: "worker02", role: "worker", status: "True", version: "v1.36.3+k3s1", specs: ["Raspberry Pi 4 · 1 GB RAM"] },
 { name: "worker03", role: "worker", status: "True", version: "v1.36.3+k3s1", specs: ["Raspberry Pi 4 · 2 GB RAM"] },
 ],
 resource_usage: {
     winterfell: { cpu_percent: 14, mem_percent: 41, disk_percent: 39, temp_c: 37, pods: 25, uptime_s: 52546 },
     worker01: { cpu_percent: 9, mem_percent: 33, disk_percent: 49, temp_c: 38, pods: 4, uptime_s: 22005 },
     worker02: { cpu_percent: 22, mem_percent: 58, disk_percent: 49, temp_c: 41, pods: 3, uptime_s: 16094 },
     worker03: { cpu_percent: 76, mem_percent: 26, disk_percent: 51, temp_c: 44, pods: 2, uptime_s: 62551 },
 },
 pods: { total: 47, running: 45, pending: 2 },
 namespaces: 12,
 deployments: 18,
 services: 9,
    };

    function esc(s) {
        return String(s == null ? "" : s).replace(
            /[&<>"']/g,
            function (c) {
                return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
            }
        );
    }

    function num(v) {
        if (v === undefined || v === null) return null;
        var n = parseFloat(String(v).replace("%", ""));
        return isNaN(n) ? null : n;
    }

    function ringClass(p) {
        if (p === null) return "na";
        if (p >= 85) return "crit";
        if (p >= 65) return "warn";
        return "ok";
    }

    /* Temperature: 70°C+ critical, 60°C+ warning */
    function tempClass(t) {
        if (t === null) return "";
        if (t >= 70) return "stat-warn";
        if (t >= 60) return "stat-warn";
        return "";
    }

    /* Seconds -> compact string, German abbreviations matching ago():
     *       "3 Tg. 4 Std." / "14 Std. 36 Min." / "42 Min."
     *       Returns null when the value is unusable. */
    function fmtUptime(sec) {
        if (sec === null || sec < 0) return null;
        var d = Math.floor(sec / 86400);
        var h = Math.floor((sec % 86400) / 3600);
        var m = Math.floor((sec % 3600) / 60);
        if (d > 0) return d + " Tg. " + h + " Std.";
        if (h > 0) return h + " Std. " + m + " Min.";
        return m + " Min.";
    }

    function gauge(p, label) {
        var c = ringClass(p);
        var txt = p === null ? "–" : p.toFixed(0) + "%";
        var pct = p === null ? 0 : Math.max(0, Math.min(100, p));
        return (
            '<div class="gauge-wrap">' +
            '<div class="gauge ' + c + '" style="--pct:' + pct + '"><span>' + txt + '</span></div>' +
            "<small>" + label + "</small>" +
            "</div>"
        );
    }

    function ago(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "–";
        var s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return "gerade eben";
        if (s < 3600) return Math.floor(s / 60) + " Min.";
        if (s < 86400) return Math.floor(s / 3600) + " Std.";
        return d.toLocaleDateString("de-DE");
    }

    function icon(id) {
        return '<span class="ic ic-' + id + '" aria-hidden="true"></span>';
    }

    var SPEC_ICONS = [
        [/ram|memory|arbeitsspeicher/, "cpu"],
        [/ssd|hdd|usb|nvme|disk|festplatte|karte|xfs|ext4|btrfs|storage|speicher/, "disk"],
    ];

    function specIcon(text) {
        var t = String(text).toLowerCase();
        for (var i = 0; i < SPEC_ICONS.length; i++) {
            if (SPEC_ICONS[i][0].test(t)) return SPEC_ICONS[i][1];
        }
        return "tag";
    }

    function specLine(iconId, text, extraClass) {
        return (
            '<div class="node-spec ' + (extraClass || "") + '">' +
            icon(iconId) + "<span>" + esc(text) + "</span></div>"
        );
    }

    function resolveSpecs(n) {
        if (Array.isArray(n.specs) && n.specs.length) {
            return { lines: n.specs, isStatic: false };
        }
        var fb = SPEC_FALLBACK[n.name] || SPEC_FALLBACK["*"];
        if (Array.isArray(fb) && fb.length) {
            return { lines: fb, isStatic: true };
        }
        if (n.arch || n.os) {
            return { lines: [[n.arch, n.os].filter(Boolean).join(" · ")], isStatic: false };
        }
        return { lines: [], isStatic: false };
    }

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
        var resolved = resolveSpecs(n);

        var specHtml = n.version ? specLine("tag", n.version) : "";
        resolved.lines.forEach(function (s) {
            specHtml += specLine(specIcon(s), s);
        });

        /* Live metrics as text lines: temperature and pod count only.
         *           Disk is intentionally NOT listed here — it has its own gauge below,
         *           which handles the warning colour via ringClass(). */
        if (temp !== null) {
            specHtml += specLine("thermometer", "Temp " + temp.toFixed(0) + " °C", tempClass(temp));
        }
        if (pods !== null) {
            specHtml += specLine("server", "Pods " + pods.toFixed(0));
        }

        /* Load average and uptime share one line to keep the card compact on
         *           narrow screens. Split into two specLine() calls if you prefer them
         *           stacked. */
        var vitals = [];
        if (uptime !== null) vitals.push("Uptime " + uptime);
        if (vitals.length) {
            specHtml += specLine("clock", vitals.join(" · "));
        }

        return (
            '<article class="node-card ' + (isReady ? "ready" : "notready") + (isCp ? " cp" : "") + '">' +
            '<div class="node-head">' +
            '<span class="led"></span>' +
            '<span class="node-role">' + icon(isCp ? "crown" : "server") + (isCp ? "Control Plane" : "Worker Node") + "</span>" +
            '<span class="node-status ' + (isReady ? "ready" : "notready") + '">' + icon(isReady ? "check" : "alert") + (isReady ? "Ready" : "NotReady") + "</span>" +
            "</div>" +
            '<div class="node-name">' + esc(n.name) + "</div>" +
            specHtml +
            '<div class="gauges">' + gauge(cpu, "CPU") + gauge(mem, "RAM") + gauge(disk, "DISK") + "</div>" +
            "</article>"
        );
    }

    function render(d, isDemo) {
        var nodes = Array.isArray(d.nodes) ? d.nodes : [];
        var pods = d.pods || {};
        var usage = d.resource_usage || {};
        var ready = nodes.filter(function (n) { return n.status === "True"; }).length;

        document.getElementById("stats").innerHTML =
        '<div class="stat"><div class="k">Nodes ready</div><div class="v">' + ready + "<small> / " + nodes.length + "</small></div></div>" +
        '<div class="stat"><div class="k">Pods running</div><div class="v">' + (pods.running != null ? pods.running : "–") + "<small> / " + (pods.total != null ? pods.total : "–") + "</small></div></div>" +
        '<div class="stat"><div class="k">Namespaces</div><div class="v">' + (d.namespaces != null ? d.namespaces : "–") + "</div></div>" +
        '<div class="stat"><div class="k">Deployments</div><div class="v">' + (d.deployments != null ? d.deployments : "–") + "</div></div>";

        document.getElementById("node-metrics").innerHTML =
        nodes.length ? nodes.map(function (n) { return nodeCard(n, usage); }).join("") : '<p class="loading">Keine Node-Daten im Feed.</p>';

        var info = document.getElementById("refresh-info");
        if (info) info.textContent = "auto-refresh · 5 min · last updated: " + ago(d.timestamp);

        document.getElementById("demo-note").style.display = isDemo ? "block" : "none";
    }

    function load() {
        fetch(SOURCE + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) { render(data, false); })
        .catch(function (err) { console.warn("cluster.json nicht ladbar:", err.message); render(DEMO, true); });
    }

    load();
    setInterval(load, REFRESH_MS);
})();
