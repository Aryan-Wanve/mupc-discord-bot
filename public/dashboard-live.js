const LIVE_POLL_INTERVAL_MS = 4000;
const THEME_STORAGE_KEY = "mupc-dashboard-theme";

const body = document.body;
const livePage = body.dataset.livePage;
const liveSnapshot = body.dataset.liveSnapshot;
const liveEntityId = body.dataset.liveEntityId;
const liveGuildId = body.dataset.liveGuildId;

const themePresets = {
  blue: { primary: "#62e6ff", secondary: "#7c5cff" },
  ember: { primary: "#ff9f43", secondary: "#ff3d71" },
  mint: { primary: "#67f0aa", secondary: "#00c2a8" },
  rose: { primary: "#ff7ab6", secondary: "#9b5cff" }
};

const hexToRgb = (hex) => {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);

  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
};

const applyTheme = ({ primary, secondary }) => {
  document.documentElement.style.setProperty("--accent", primary);
  document.documentElement.style.setProperty("--accent-strong", secondary);
  document.documentElement.style.setProperty("--accent-rgb", hexToRgb(primary));
  document.documentElement.style.setProperty("--accent-strong-rgb", hexToRgb(secondary));
};

const saveTheme = (theme) => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // The picker still works for the current page if browser storage is blocked.
  }
};

const getStoredTheme = () => {
  try {
    return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
};

const getMatchingPreset = (theme) =>
  Object.entries(themePresets).find(
    ([, preset]) => preset.primary === theme.primary && preset.secondary === theme.secondary
  )?.[0] || null;

const setupUtilityMenu = () => {
  const menu = document.querySelector("[data-utility-menu]");
  const toggle = document.querySelector("[data-utility-toggle]");
  const primaryInput = document.querySelector("[data-theme-primary]");
  const secondaryInput = document.querySelector("[data-theme-secondary]");
  const swatches = [...document.querySelectorAll("[data-theme-preset]")];

  if (!menu || !toggle || !primaryInput || !secondaryInput) {
    return;
  }

  const setMenuOpen = (isOpen) => {
    menu.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
  };

  const setSelectedSwatch = (presetName) => {
    swatches.forEach((swatch) => {
      swatch.classList.toggle("is-selected", swatch.dataset.themePreset === presetName);
    });
  };

  const setTheme = (theme, { persist = true } = {}) => {
    applyTheme(theme);
    primaryInput.value = theme.primary;
    secondaryInput.value = theme.secondary;
    setSelectedSwatch(getMatchingPreset(theme));

    if (persist) {
      saveTheme(theme);
    }
  };

  setTheme(getStoredTheme() || themePresets.blue, { persist: false });

  toggle.addEventListener("click", () => {
    setMenuOpen(!menu.classList.contains("is-open"));
  });

  swatches.forEach((swatch) => {
    swatch.addEventListener("click", () => {
      setTheme(themePresets[swatch.dataset.themePreset]);
    });
  });

  [primaryInput, secondaryInput].forEach((input) => {
    input.addEventListener("input", () => {
      setTheme({
        primary: primaryInput.value,
        secondary: secondaryInput.value
      });
    });
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
    }
  });
};

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
};

const setupDurationClocks = () => {
  const clocks = [...document.querySelectorAll("[data-duration-clock]")];

  if (setupDurationClocks.timer) {
    window.clearInterval(setupDurationClocks.timer);
  }

  const updateClocks = () => {
    const now = Date.now();
    let hasActiveClock = false;

    clocks.forEach((clock) => {
      const startedAt = Date.parse(clock.dataset.startedAt || "");
      const endedAt = Date.parse(clock.dataset.endedAt || "");

      if (Number.isNaN(startedAt)) {
        return;
      }

      const isEnded = !Number.isNaN(endedAt);
      const isActive = clock.dataset.status === "active" && !isEnded;
      const endTime = isEnded ? endedAt : now;

      clock.textContent = formatDuration((endTime - startedAt) / 1000);
      hasActiveClock = hasActiveClock || isActive;
    });

    if (!hasActiveClock && setupDurationClocks.timer) {
      window.clearInterval(setupDurationClocks.timer);
      setupDurationClocks.timer = null;
    }
  };

  updateClocks();

  if (clocks.some((clock) => clock.dataset.status === "active" && !clock.dataset.endedAt)) {
    setupDurationClocks.timer = window.setInterval(updateClocks, 1000);
  } else {
    setupDurationClocks.timer = null;
  }
};

setupUtilityMenu();
setupDurationClocks();

if (livePage && liveSnapshot) {
  let currentSnapshot = liveSnapshot;
  let isRefreshing = false;

  const syncToast = document.createElement("div");
  syncToast.className = "live-toast";
  syncToast.setAttribute("aria-live", "polite");
  syncToast.textContent = "Auto-sync is live";
  body.appendChild(syncToast);

  const setToast = (message, state = "idle") => {
    syncToast.textContent = message;
    syncToast.dataset.state = state;
    syncToast.classList.add("is-visible");

    window.clearTimeout(setToast.hideTimer);
    setToast.hideTimer = window.setTimeout(() => {
      syncToast.classList.remove("is-visible");
    }, state === "updated" ? 2800 : 1700);
  };

  const refreshPageContent = async () => {
    if (isRefreshing) {
      return;
    }

    isRefreshing = true;

    try {
      const response = await fetch(window.location.pathname, {
        headers: {
          "X-Requested-With": "dashboard-live"
        },
        cache: "no-store"
      });
      const html = await response.text();
      const nextDocument = new DOMParser().parseFromString(html, "text/html");
      const nextBody = nextDocument.body;
      const nextRegions = new Map(
        [...nextDocument.querySelectorAll("[data-live-region]")]
          .map((region) => [region.dataset.liveRegion, region])
      );
      const currentRegions = [...document.querySelectorAll("[data-live-region]")];
      let updatedRegions = 0;
      const getComparableRegionHtml = (region) => {
        const clone = region.cloneNode(true);
        clone.removeAttribute("data-live-restored");
        return clone.outerHTML;
      };

      if (nextBody && nextRegions.size > 0 && currentRegions.length > 0) {
        currentRegions.forEach((currentRegion) => {
          const nextRegion = nextRegions.get(currentRegion.dataset.liveRegion);

          if (!nextRegion || getComparableRegionHtml(currentRegion) === getComparableRegionHtml(nextRegion)) {
            return;
          }

          nextRegion.dataset.liveRestored = "true";
          currentRegion.replaceWith(nextRegion);
          window.setTimeout(() => {
            nextRegion.removeAttribute("data-live-restored");
          }, 1000);
          updatedRegions += 1;
        });

        setupDurationClocks();
        currentSnapshot = nextBody.dataset.liveSnapshot || currentSnapshot;
        body.dataset.liveSnapshot = currentSnapshot;

        if (updatedRegions > 0) {
          body.classList.add("has-live-update");

          window.setTimeout(() => {
            body.classList.remove("has-live-update");
          }, 800);
        }
      }
    } catch (error) {
      console.error("Dashboard live refresh failed:", error);
      setToast("Auto-sync will retry", "error");
    } finally {
      isRefreshing = false;
    }
  };

  const checkForUpdates = async () => {
    if (document.hidden || isRefreshing) {
      return;
    }

    try {
      const query = new URLSearchParams({ page: livePage });
      if (liveGuildId) {
        query.set("guildId", liveGuildId);
      }
      if (liveEntityId) {
        query.set("id", liveEntityId);
      }

      const response = await fetch(`/api/dashboard-snapshot?${query.toString()}`, {
        cache: "no-store"
      });
      const data = await response.json();

      if (data.snapshot && data.snapshot !== currentSnapshot) {
        await refreshPageContent();
      }
    } catch (error) {
      console.error("Dashboard snapshot poll failed:", error);
    }
  };

  window.setInterval(() => {
    void checkForUpdates();
  }, LIVE_POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void checkForUpdates();
    }
  });

  window.addEventListener("focus", () => {
    void checkForUpdates();
  });
}
