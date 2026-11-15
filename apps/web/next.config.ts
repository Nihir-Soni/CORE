import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/login",
        destination: "/?mode=login",
        permanent: false,
      },
      {
        source: "/register",
        destination: "/?mode=register",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
