// Drives a running NextAlerts desktop app through Chrome DevTools Protocol, for testing.
//   node test-cdp.js <port> "<js expression>"        (the expression may be async; its JSON result is printed)
// Start the app first with:  NextAlerts.exe --remote-debugging-port=<port>
const [port, expr] = [process.argv[2], process.argv[3]];

(async () => {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
    } catch {}
    if (!target) await new Promise((r) => setTimeout(r, 500));
  }
  if (!target) { console.error("no page to attach to"); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const out = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true } }));
  });
  console.log(JSON.stringify({ url: target.url, result: out.result?.result?.value, error: out.result?.exceptionDetails?.exception?.description }, null, 1));
  ws.close();
})();
