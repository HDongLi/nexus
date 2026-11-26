// Find a free port near the preferred one (charter §11 rule 5: never assume a port is free).
// The same idea lives in tools/dev.ts; the two are kept apart because the page app does not
// import from tools/.
import { createServer } from "node:net";

const ATTEMPTS = 20;

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

export async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + ATTEMPTS; port++) {
    if (await canListen(port)) return port;
  }
  throw new Error(`从 ${preferred} 起试了 ${ATTEMPTS} 个端口都被占着`);
}
