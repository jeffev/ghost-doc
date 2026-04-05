import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Ghost Doc",
  description:
    "Your code's black box. Ghost Doc observes how your functions actually behave at runtime and turns that into visual documentation — automatically.",
  base: "/ghost-doc/",

  head: [
    ["link", { rel: "icon", href: "/ghost-doc/logo.png", type: "image/png" }],
    ["meta", { name: "theme-color", content: "#7c3aed" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Ghost Doc" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Observe real code behavior and generate visual documentation automatically.",
      },
    ],
    ["meta", { property: "og:image", content: "https://jeffev.github.io/ghost-doc/logo.png" }],
  ],

  themeConfig: {
    logo: { src: "/logo.png", width: 32, height: 32 },

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/trace-event" },
      { text: "Live Demo", link: "/demo.html", target: "_blank" },
      { text: "GitHub", link: "https://github.com/jeffev/ghost-doc" },
      {
        text: "Packages",
        items: [
          { text: "ghost-doc (Hub + CLI)", link: "https://www.npmjs.com/package/ghost-doc" },
          {
            text: "@ghost-doc/agent-js",
            link: "https://www.npmjs.com/package/@ghost-doc/agent-js",
          },
          { text: "ghost-doc-agent (Python)", link: "https://pypi.org/project/ghost-doc-agent/" },
          {
            text: "agent-java (Maven Central)",
            link: "https://central.sonatype.com/artifact/io.github.jeffev/agent-java",
          },
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
          { text: "Java / Spring Boot", link: "/guide/agent-java" },
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
      {
        text: "Project",
        items: [{ text: "Future Features", link: "/future-features" }],
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
