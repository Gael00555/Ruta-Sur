import { fileURLToPath } from "node:url";

const nextConfig = {
  serverExternalPackages: ["mongodb"],
  // raíz del monorepo (RutaSur), para que Next no tome otra carpeta superior
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
};
export default nextConfig;