import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vyay",
    short_name: "Vyay",
    description: "Automatic expense tracking from your Gmail transaction emails.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#0071e3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
