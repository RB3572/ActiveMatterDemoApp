const RAW_BASE = "https://raw.githubusercontent.com/RB3572/ActiveMatterDemoApp/main/docs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function contentType(path) {
  const lower = path.toLowerCase();
  for (const [ext, type] of Object.entries(TYPES)) {
    if (lower.endsWith(ext)) return type;
  }
  return "application/octet-stream";
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.includes("..")) return new Response("Bad request", { status: 400 });
  if (path === "/" || path === "") path = "/index.html";

  const headers = new Headers();
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(RAW_BASE + path, { headers });
  if (upstream.status === 404) return new Response("Not found", { status: 404 });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("content-type", contentType(path));
  responseHeaders.set(
    "cache-control",
    path.endsWith(".html") ? "public, max-age=120" : "public, max-age=86400",
  );
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.delete("content-security-policy");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
