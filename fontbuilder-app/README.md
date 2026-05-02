# fontbuilder-app

Phase 1 scaffold for the Glyphseed frontend.

## Local development

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Run:

```bash
npm install
npm run dev
```

The app expects `fontbuilder-service` to be running on `http://localhost:8200` by default.

## Font preview page

Run the Vite app and open `http://localhost:5173/font-preview.html` for the standalone landing-page preview.

The headline font swap target is `.font-preview-headline-copy`. You can also pass quick overrides in the URL:

- `headline=Make%20the%20font%20the%20whole%20point.`
- `headlineFont=Times%20New%20Roman`
- `fontUrl=/path/to/font.woff2&fontName=PreviewFont`
- `bg=%23ff3b3f`
