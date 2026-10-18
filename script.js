/* killedbypenguins — render the graveyard, search, filter by category */

(() => {
  "use strict";

  // First entry is the "all" pseudo-category.
  const CATEGORIES = [
    { key: "all",          label: "all" },
    { key: "distribution", label: "distro" },
    { key: "app",          label: "app" },
    { key: "service",      label: "service" },
    { key: "hardware",     label: "hardware" },
  ];

  // Classic small tombstone, 9 chars wide.
  const TOMBSTONE = [
    "   .--.  ",
    "  |RIP|  ",
    "  |   |  ",
    "  |___|  ",
    "  /   \\  ",
    " /_____\\ ",
    " |     | ",
  ].join("\n");

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  function yearsLine(entry) {
    const born = entry.openDate  ? new Date(entry.openDate).getUTCFullYear() : null;
    const died = entry.deathDate ? new Date(entry.deathDate).getUTCFullYear() : null;
    if (born && died) return `${born}—${died}`;
    if (died) return `d. ${died}`;
    if (born) return `b. ${born}`;
    return "";
  }

  // Rounds to the largest unit that still yields a non-zero value.
  function timeSince(iso) {
    const ms = new Date(iso) - Date.now();
    if (isNaN(ms) || ms >= 0) return null;
    const days = Math.round(-ms / MS_PER_DAY);
    if (days < 7)   return rtf.format(-days, "day");
    if (days < 30)  return rtf.format(-Math.round(days / 7), "week");
    if (days < 365) return rtf.format(-Math.round(days / 30), "month");
    return rtf.format(-Math.round(days / 365), "year");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---- state ----
  let entries = [];
  let activeCategory = "all";
  let query = "";

  // ---- DOM ----
  const $list     = document.getElementById("graveyard");
  const $empty    = document.getElementById("empty");
  const $filters  = document.getElementById("filters");
  const $search   = document.getElementById("search");
  const $counter  = document.getElementById("counter");

  function syncCategoryButtons() {
    for (const b of $filters.children) {
      b.setAttribute("aria-pressed", String(b.dataset.category === activeCategory));
    }
  }

  // Recompute the per-category counts and rewrite the filter button labels.
  // The static HTML may be stale (fewer entries than the loaded JSON), so we
  // can't trust the labels baked in at build time once JS takes over.
  function refreshFilterCounts() {
    const counts = entries.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {});
    counts.all = entries.length;
    for (const b of $filters.children) {
      const key = b.dataset.category;
      const label = CATEGORIES.find(c => c.key === key)?.label || key;
      b.textContent = `[${label}: ${counts[key] || 0}]`;
    }
  }

  function attachFilterHandlers() {
    for (const btn of $filters.children) {
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.category;
        syncCategoryButtons();
        applyFilters();
      });
    }
  }

  // Pure HTML for a single entry. Used by the browser render path AND the
  // static-build script (build.js), so TUI browsers / no-JS clients see the
  // same content.
  function entryHtml(entry) {
    const years = yearsLine(entry);
    const categoryLabel = CATEGORIES.find(c => c.key === entry.category)?.label || entry.category;
    const nameHtml = entry.link
      ? `<a href="${escapeHtml(entry.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.name)}</a>`
      : escapeHtml(entry.name);
    const when = timeSince(entry.deathDate);
    const title = when
      ? `${entry.name} — ${entry.category} (${when})`
      : `${entry.name} — ${entry.category}`;

    return `
      <li class="entry" data-category="${escapeHtml(entry.category || "")}" data-name="${escapeHtml(entry.name.toLowerCase())}" data-desc="${escapeHtml((entry.description || "").toLowerCase())}" title="${escapeHtml(title)}">
        <div class="entry-stone">
          <pre class="tombstone" aria-hidden="true">${TOMBSTONE}</pre>
          ${years ? `<div class="tombstone-years">${escapeHtml(years)}</div>` : ""}
          ${entry.category ? `<div class="tombstone-category">${escapeHtml(categoryLabel)}</div>` : ""}
        </div>
        <div class="entry-inscription">
          <h2 class="entry-name">${nameHtml}</h2>
          <p class="entry-desc">${escapeHtml(entry.description || "")}</p>
        </div>
      </li>
    `;
  }

  function entryElement(entry) {
    const tmp = document.createElement("template");
    tmp.innerHTML = entryHtml(entry).trim();
    return tmp.content.firstElementChild;
  }

  function sortedEntries() {
    return [...entries].sort((a, b) => {
      const ta = a.deathDate ? new Date(a.deathDate).getTime() : Infinity;
      const tb = b.deathDate ? new Date(b.deathDate).getTime() : Infinity;
      return tb - ta;
    });
  }

  function applyFilters() {
    const q = query.trim().toLowerCase();
    let visible = 0;
    for (const li of $list.children) {
      const matchesCat = activeCategory === "all" || li.dataset.category === activeCategory;
      const matchesQuery = !q || li.dataset.name.includes(q) || li.dataset.desc.includes(q);
      const show = matchesCat && matchesQuery;
      if (li.hidden !== !show) li.hidden = !show;
      if (show) visible += 1;
    }
    $empty.hidden = visible !== 0;
  }

  function render() {
    $list.replaceChildren(...sortedEntries().map(entryElement));
    const n = entries.length;
    $counter.textContent = `# ${n} ${n === 1 ? "soul" : "souls"} interred`;
    if (query !== "" || activeCategory !== "all") applyFilters();
  }

  // The static HTML already contains pre-rendered <button>s and <li>s (from
  // build.js). Wire up their handlers and update dynamic bits (counter, tooltips).
  function initFromStatic() {
    for (const li of $list.children) {
      if (!li.classList.contains("entry")) continue;
      const name = li.dataset.name || "";
      // Re-derive dataset.name/desc as title-case (build.js lowercased them for search)
      // and set the live "time since" tooltip.
      const orig = entries.find(e => e.name.toLowerCase() === name);
      if (orig) {
        const when = timeSince(orig.deathDate);
        li.title = when
          ? `${orig.name} — ${orig.category} (${when})`
          : `${orig.name} — ${orig.category}`;
      }
    }
    attachFilterHandlers();
    syncCategoryButtons();
    refreshFilterCounts();
    applyFilters();
  }

  $search.addEventListener("input", (e) => {
    query = e.target.value;
    applyFilters();
  });

  fetch("graveyard.json", { cache: "default" })
    .then(r => {
      if (!r.ok) throw new Error(`failed to load graveyard.json: ${r.status}`);
      return r.json();
    })
    .then(data => {
      entries = Array.isArray(data) ? data : [];
      // If the static HTML already had pre-rendered entries, use them; otherwise
      // do a fresh render. The static count should always match the JSON count.
      const hasStatic = $list.children.length === entries.length;
      if (hasStatic) {
        initFromStatic();
      } else {
        render();
        attachFilterHandlers();
        syncCategoryButtons();
        refreshFilterCounts();
      }
      $counter.textContent = `# ${entries.length} ${entries.length === 1 ? "soul" : "souls"} interred`;
    })
    .catch(err => {
      $list.innerHTML = `<li class="empty">! ${escapeHtml(err.message)}</li>`;
    });
})();
