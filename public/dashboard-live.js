const LIVE_POLL_INTERVAL_MS = 8000;

const body = document.body;
const livePage = body.dataset.livePage;
const liveSnapshot = body.dataset.liveSnapshot;
const liveEntityId = body.dataset.liveEntityId;

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
    body.classList.add("is-live-refreshing");

    try {
      const response = await fetch(window.location.pathname, {
        headers: {
          "X-Requested-With": "dashboard-live"
        },
        cache: "no-store"
      });
      const html = await response.text();
      const nextDocument = new DOMParser().parseFromString(html, "text/html");
      const nextMain = nextDocument.querySelector("main.page");
      const currentMain = document.querySelector("main.page");
      const nextBody = nextDocument.body;

      if (nextMain && currentMain && nextBody) {
        currentMain.replaceWith(nextMain);
        currentSnapshot = nextBody.dataset.liveSnapshot || currentSnapshot;
        body.dataset.liveSnapshot = currentSnapshot;
        body.classList.add("has-live-update");
        setToast("Dashboard updated", "updated");

        window.setTimeout(() => {
          body.classList.remove("has-live-update");
        }, 1800);
      }
    } catch (error) {
      console.error("Dashboard live refresh failed:", error);
      setToast("Auto-sync will retry", "error");
    } finally {
      body.classList.remove("is-live-refreshing");
      isRefreshing = false;
    }
  };

  const checkForUpdates = async () => {
    if (document.hidden || isRefreshing) {
      return;
    }

    try {
      const query = new URLSearchParams({ page: livePage });
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
}
