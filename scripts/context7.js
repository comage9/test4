#!/usr/bin/env node
// Minimal Context7 helper: search libraries and fetch docs via HTTPS API.
// Usage:
//   node scripts/context7.js search "react router"
//   node scripts/context7.js docs /vercel/next.js --tokens 12000 --topic routing

const { argv } = process;

async function main() {
  const [, , cmd, ...rest] = argv;

  if (!cmd || ["search", "docs"].includes(cmd) === false) {
    console.error(
      "Usage: node scripts/context7.js <search|docs> <args> [--tokens N] [--topic STR]"
    );
    process.exit(1);
  }

  if (cmd === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      console.error("Provide a query, e.g. search \"next.js routing\"");
      process.exit(1);
    }
    const url = new URL("https://context7.com/api/v1/search");
    url.searchParams.set("query", query);
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`Search failed: HTTP ${resp.status}`);
      process.exit(2);
    }
    const json = await resp.json();
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  if (cmd === "docs") {
    if (!rest.length) {
      console.error("Provide a library id, e.g. /vercel/next.js or /mongodb/docs");
      process.exit(1);
    }
    // parse args: first token is id; the rest are flags
    const id = rest[0];
    const flags = rest.slice(1);
    let tokens;
    let topic;
    for (let i = 0; i < flags.length; i++) {
      const k = flags[i];
      if (k === "--tokens") {
        tokens = Number(flags[++i]);
      } else if (k === "--topic") {
        topic = String(flags[++i] || "");
      }
    }
    const path = id.startsWith("/") ? id.slice(1) : id;
    const url = new URL(`https://context7.com/api/v1/${path}`);
    url.searchParams.set("type", "txt");
    if (tokens) url.searchParams.set("tokens", String(tokens));
    if (topic) url.searchParams.set("topic", topic);
    const resp = await fetch(url, { headers: { "X-Context7-Source": "helper-script" } });
    if (!resp.ok) {
      console.error(`Docs fetch failed: HTTP ${resp.status}`);
      process.exit(2);
    }
    const text = await resp.text();
    console.log(text);
    return;
  }
}

main().catch((err) => {
  console.error("context7 helper error:", err);
  process.exit(99);
});

