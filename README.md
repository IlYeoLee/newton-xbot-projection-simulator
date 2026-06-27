# NEWTON X Bot Projection Stabilizer Simulator

## Local preview

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Build a static bundle:

```bash
npm run build
```

Open `/dist/index.html` to inspect the static build locally.

## GitHub Pages deployment

1. Push this project to a GitHub repository.
2. In GitHub, open `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to the `main` branch.

The workflow at `.github/workflows/deploy.yml` installs dependencies, builds the Vite app, uploads `dist`, and deploys it to GitHub Pages.
