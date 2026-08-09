import { createServer } from "node:net";

function probeLocalPort(host, port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      const address = server.address();
      const selectedPort = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(selectedPort));
    });
  });
}

export async function findAvailableLocalPort({ host = "127.0.0.1", preferredPort, attempts = 40 }) {
  const start = Number(preferredPort);
  if (!Number.isInteger(start) || start < 1 || start > 65535) {
    throw new Error("本机界面端口配置无效");
  }
  for (let offset = 0; offset < attempts && start + offset <= 65535; offset += 1) {
    const available = await probeLocalPort(host, start + offset);
    if (available) return available;
  }
  const fallback = await probeLocalPort(host, 0);
  if (fallback) return fallback;
  throw new Error("没有可用的本机界面端口");
}
