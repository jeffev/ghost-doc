import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Ghost Doc",
  description:
    "Your code's black box. Ghost Doc observes how your functions actually behave at runtime and turns that into visual documentation — automatically.",
  base: "/ghost-doc/",

  head: [
    ["link", { rel: "icon", href: "/ghost-doc/favicon.svg", type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#7c3aed" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Ghost Doc" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Observe real code behavior and generate visual documentation automatically.",
      },
    ],
    ["meta", { property: "og:image", content: "https://jeffev.github.io/ghost-doc/og.png" }],
  ],

  themeConfig: {
    logo: { src: "/favicon.svg", width: 24, height: 24 },

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/trace-event" },
      { text: "Live Demo", link: "/demo.html", target: "_blank" },
      { text: "GitHub", link: "https://github.com/jeffev/ghost-doc" },
      {
        text: "npm",
        items: [
          { text: "ghost-doc (Hub + CLI)", link: "https://www.npmjs.com/package/ghost-doc" },
          { text: "@ghost-doc/agent-js", link: "https://www.npmjs.com/package/@ghost-doc/agent-js" },
        ],
      },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/guide/getting-started" },
          { text: "JavaScript / TypeScript", link: "/guide/agent-js" },
          { text: "Python", link: "/guide/agent-python" },
          { text: "Hub & CLI", link: "/guide/hub" },
          { text: "Exporter", link: "/guide/exporter" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "TraceEvent Schema", link: "/api/trace-event" },
          { text: "Hub REST API", link: "/api/hub-rest" },
          { text: "CLI Reference", link: "/api/cli" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/jeffev/ghost-doc" }],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024–present Ghost Doc contributors",
    },

    editLink: {
      pattern: "https://github.com/jeffev/ghost-doc/edit/master/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },
  },
});
