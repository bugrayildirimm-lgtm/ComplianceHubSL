// The single managed-browser integration used by this app: a local headless Chromium driven by
// Playwright (replaces Base44's cloud browser + Stagehand). One browser per call, always closed in
// finally{}. Playwright is loaded lazily so the server runs without it until a capture is requested.
// Environment: BROWSER_EXECUTABLE_PATH (optional), BROWSER_USER_AGENT (optional).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeWhite(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function browserError(message, code, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = Boolean(retryable);
  return error;
}

// handler receives { capture(url, { waitMs }) } and runs inside one browser session.
export async function withBrowser(_base44, handler) {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
    });
  } catch (e) {
    const reason = String(e?.message || 'Browser could not be started');
    const missing = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|Executable doesn't exist/i.test(reason);
    throw browserError(missing ? `Playwright/Chromium is not installed on this server: ${reason}` : reason, 'BROWSER_UNAVAILABLE', false);
  }

  try {
    const context = await browser.newContext({ userAgent: process.env.BROWSER_USER_AGENT || undefined, locale: 'en-GB' });
    const page = await context.newPage();

    const capture = async (url, options = {}) => {
      const waitMs = Number(options.waitMs === undefined ? 2000 : options.waitMs);
      const regionSelectors = Array.isArray(options.regionSelectors) && options.regionSelectors.length
        ? options.regionSelectors
        : ['article', 'main', '[role="main"]', 'body'];
      let navigationError = '';
      const nav = await page
        .goto(String(url), { waitUntil: 'domcontentloaded', timeout: 45000 })
        .catch((e) => {
          navigationError = String(e?.message || 'navigation failed');
          return null;
        });

      let httpStatus = null;
      if (nav && typeof nav.status === 'function') {
        try {
          httpStatus = nav.status();
        } catch (e) {
          httpStatus = null;
        }
      }
      if (waitMs > 0) await sleep(waitMs);

      let finalUrl = String(url);
      try {
        if (typeof page.url === 'function') finalUrl = page.url();
      } catch (e) {
        finalUrl = String(url);
      }

      let title = '';
      try {
        title = normalizeWhite(await page.title());
      } catch (e) {
        title = '';
      }

      let text = '';
      let captureMethod = '';
      try {
        text = normalizeWhite(await page.evaluate(() => (document.body ? document.body.innerText : '')));
        captureMethod = 'document.body.innerText';
      } catch (eDocument) {
        try {
          text = normalizeWhite(await page.innerText('body'));
          captureMethod = 'body innerText';
        } catch (eInner) {
          const html = await page.content();
          text = normalizeWhite(
            String(html)
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
          );
          captureMethod = 'rendered HTML text, tags stripped';
        }
      }

      let links = [];
      try {
        links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'))
            .slice(0, 500)
            .map((a) => ({
              href: String(a.href || ''),
              label: String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            }))
        );
      } catch (eLinks) {
        links = [];
      }

      // Structural snapshot: the page as a document, not a flattened string. Records the main
      // content region, repeated card blocks (listing furniture), pagination/filter controls and
      // the article's own metadata lines, so page type can be decided from structure.
      let structure = null;
      try {
        structure = await page.evaluate((selectors) => {
          const HARD = 'nav, footer, header, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
          const flat = (el) => (el ? String(el.innerText || el.textContent || '').replace(/[ \t]+/g, ' ').trim() : '');
          // Prose is measured with repeated card blocks excluded: teaser headlines are not this
          // page's own content, and counting them made every news index look like an article
          // (found by run CLS-2026-11-05-CA0C99).
          const proseOf = (el, cardEls) => {
            if (!el) return { chars: 0, paragraphs: 0 };
            let chars = 0;
            let paragraphs = 0;
            const nodes = Array.from(el.querySelectorAll('p, li, blockquote'));
            for (const node of nodes) {
              if (node.closest(HARD)) continue;
              if (cardEls && cardEls.some((card) => card !== el && card.contains(node))) continue;
              const value = flat(node);
              if (value.length < 60) continue;
              chars += value.length;
              paragraphs += 1;
            }
            return { chars, paragraphs };
          };

          // The most specific region that actually holds content wins, in selector order
          // (article, main, body); a generic wrapper is only used when nothing specific exists.
          let best = null;
          for (const selector of selectors) {
            let el = null;
            try {
              el = document.querySelector(selector);
            } catch (eSelector) {
              el = null;
            }
            if (!el) continue;
            if (!best) best = { el, selector };
            if (flat(el).length >= 400) {
              best = { el, selector };
              break;
            }
          }
          const region = best ? best.el : document.body;
          const regionSelector = best ? best.selector : 'body';

          const blocks = new Map();
          for (const anchor of Array.from(region.querySelectorAll('a[href]'))) {
            if (anchor.closest(HARD)) continue;
            let node = anchor.parentElement;
            let depth = 0;
            while (node && node !== region && depth < 4) {
              const parent = node.parentElement;
              if (parent) {
                const alike = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
                if (alike.length >= 3 && alike.length <= 300) {
                  for (const sibling of alike) {
                    const anchors = Array.from(sibling.querySelectorAll('a[href]'));
                    if (!anchors.length) continue;
                    blocks.set(sibling, { anchors, chars: flat(sibling).length });
                  }
                  break;
                }
              }
              node = parent;
              depth += 1;
            }
            if (blocks.size > 600) break;
          }

          let cardChars = 0;
          const cardAnchors = new Map();
          const cardEntries = Array.from(blocks.entries()).filter(([, block]) => block.chars >= 40);
          const cardEls = cardEntries.map(([el]) => el);
          const cardBlocks = cardEntries.map(([, block]) => block);
          const regionProse = proseOf(region, cardEls);
          for (const block of cardBlocks) {
            cardChars += block.chars;
            for (const anchor of block.anchors) {
              const href = String(anchor.href || '');
              if (!href) continue;
              if (!cardAnchors.has(href)) {
                cardAnchors.set(href, String(anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180));
              }
            }
          }

          const chromeChars = {};
          for (const name of ['header', 'nav', 'footer', 'aside']) {
            chromeChars[name] = Array.from(document.querySelectorAll(name))
              .reduce((total, el) => total + flat(el).length, 0);
          }

          const collect = (selector, limit) => {
            const out = [];
            for (const el of Array.from(region.querySelectorAll(selector))) {
              const value = flat(el) || String(el.getAttribute('datetime') || '').trim();
              if (!value || out.includes(value)) continue;
              out.push(value.slice(0, 200));
              if (out.length >= limit) break;
            }
            return out;
          };

          return {
            regionSelector,
            regionChars: flat(region).length,
            regionText: flat(region).slice(0, 24000),
            proseChars: regionProse.chars,
            paragraphCount: regionProse.paragraphs,
            bodyChars: flat(document.body).length,
            h1: collect('h1', 2),
            headings: collect('h2, h3', 10),
            cardBlockCount: cardBlocks.length,
            cardChars,
            cardLinks: Array.from(cardAnchors.entries()).slice(0, 200).map(([href, label]) => ({ href, label })),
            hasPagination: Boolean(region.querySelector('nav[aria-label*="pag" i], .pagination, ul.pagination, a[rel="next"]')),
            hasSearchControls: Boolean(region.querySelector('input[type="search"], form[role="search"], select, [class*="filter" i]')),
            times: collect('time', 5),
            meta: collect('dd, [class*="date" i], [class*="publish" i], [class*="meta" i], [class*="author" i]', 8),
            chromeChars,
          };
        }, regionSelectors);
      } catch (eStructure) {
        structure = null;
      }

      const okStatus = httpStatus !== null && httpStatus >= 200 && httpStatus < 400;
      return {
        ok: !navigationError && okStatus && text.length > 0,
        requestedUrl: String(url),
        finalUrl,
        httpStatus,
        title,
        text,
        captureMethod,
        links: Array.isArray(links) ? links : [],
        structure: structure || null,
        capturedAt: new Date().toISOString(),
        navigationError: navigationError || null,
      };
    };

    return await handler({ capture });
  } finally {
    try {
      await browser?.close();
    } catch (e) {
      // cleanup only
    }
  }
}
