/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["mysql2"],
  // Hosts allowed to load dev-only resources (HMR, etc.) in `next dev`, e.g. an ngrok tunnel for Telegram Login testing.
  allowedDevOrigins: ["curious-necessarily-hyacinth.ngrok-free.dev"],
};

export default nextConfig;
