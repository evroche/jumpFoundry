const root = document.documentElement;
const params = new URLSearchParams(window.location.search);

const headlineElement = document.querySelector("[data-font-preview-headline]");
const navElement = document.querySelector("[data-font-preview-nav]");
const navFileElement = document.querySelector("[data-font-preview-nav-file]");
const ctaLabelElement = document.querySelector("[data-font-preview-cta-label]");

const headline = params.get("headline");
if (headline && headlineElement) {
  headlineElement.textContent = headline;
}

const nav = params.get("nav");
if (nav && navElement) {
  const navTokens = nav
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean);

  if (navTokens.length > 0) {
    navElement.replaceChildren(
      ...navTokens.map((token) => {
        const span = document.createElement("span");
        span.textContent = token;
        return span;
      }),
    );
  }
}

const ctaLabel = params.get("ctaLabel");
if (ctaLabel && ctaLabelElement && navFileElement) {
  ctaLabelElement.textContent = ctaLabel;
  navFileElement.textContent = ctaLabel;
}

const backgroundColor = params.get("bg");
if (backgroundColor) {
  root.style.setProperty("--font-preview-background", backgroundColor);
}

const headlineFontFamily = params.get("headlineFont");
if (headlineFontFamily) {
  root.style.setProperty("--font-preview-headline-family", headlineFontFamily);
}

const fontUrl = params.get("fontUrl");
if (fontUrl) {
  void loadPreviewFont(fontUrl, params.get("fontName") || "FontPreviewHeadline");
}

async function loadPreviewFont(fontSource, fontName) {
  try {
    const fontFace = new FontFace(fontName, `url(${fontSource})`);
    await fontFace.load();
    document.fonts.add(fontFace);
    root.style.setProperty("--font-preview-headline-family", `"${fontName}"`);
  } catch (error) {
    console.warn("Unable to load preview font", error);
  }
}
