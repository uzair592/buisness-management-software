import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const events: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        events.push(`console ${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => events.push(`pageerror: ${error.message}`));
    await page.addInitScript(() => {
      const timeline: unknown[] = [];
      Object.assign(window, { filterTimeline: timeline });
      function capture(event: string) {
        timeline.push({
          event,
          url: location.href,
          controls: Array.from(
            document.querySelectorAll("input, select"),
            (element) => ({
              label:
                element.getAttribute("aria-label") ??
                element.parentElement?.textContent,
              value: (element as HTMLInputElement).value,
            }),
          ),
        });
        if (timeline.length > 80) timeline.shift();
      }
      for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method].bind(history);
        history[method] = (...args) => {
          original(...args);
          capture(method);
        };
      }
      document.addEventListener("input", () => capture("input"));
      document.addEventListener("change", () => capture("change"));
    });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      const state = await page.evaluate(() => ({
        url: location.href,
        parameters: Object.fromEntries(new URLSearchParams(location.search)),
        controls: Array.from(document.querySelectorAll("input, select")).map(
          (element) => ({
            label:
              element.getAttribute("aria-label") ??
              element.parentElement?.textContent,
            value: (element as HTMLInputElement).value,
          }),
        ),
        rows: Array.from(
          document.querySelectorAll("tbody tr"),
          (row) => row.textContent,
        ),
        focused: document.activeElement?.outerHTML,
        timeline: (window as unknown as { filterTimeline: unknown[] })
          .filterTimeline,
      }));
      const diagnostics = JSON.stringify({ ...state, events }, null, 2);
      console.log(
        "Browser failure diagnostics:\n" +
          JSON.stringify(
            { ...state, timeline: state.timeline.slice(-6), events },
            null,
            2,
          ),
      );
      await testInfo.attach("browser-state.json", {
        body: diagnostics,
        contentType: "application/json",
      });
      await testInfo.attach("accessibility.yml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
    }
  },
});
export { expect };
