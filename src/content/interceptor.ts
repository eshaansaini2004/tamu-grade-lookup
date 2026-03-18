// Runs in MAIN world — shares window with the page.
// Wraps window.fetch to capture regblocks meeting data, relays via postMessage
// to the ISOLATED world content script (index.ts).

(function () {
  const orig = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const res = await orig(...args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);

    if (url.includes('/regblocks')) {
      res.clone().json().then((data: {
        sections?: { crn: number | string; meetings?: unknown[] }[];
      }) => {
        for (const section of data.sections ?? []) {
          window.postMessage({
            type: '__TRP_MEETINGS__',
            crn: String(section.crn),
            meetings: section.meetings ?? [],
          }, '*');
        }
      }).catch(() => {});
    }

    return res;
  };
})();
