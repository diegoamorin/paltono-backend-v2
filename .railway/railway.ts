import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "api";
export default defineRailway(() => {
  const api = service("api", {
    // builder from CaC: "RAILPACK"
    build: "pnpm build",
    start: "pnpm start",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    preDeploy: "node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js",
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["api.paltono.com"],
  });

  return project("paltono.com", {
    variables: { managed: false },
    resources: [api],
  });
});
