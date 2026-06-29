import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tareeqah",
    short_name: "Tareeqah",
    description: "Masjid class registration and management portal",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f4f5",
    theme_color: "#8ccbbd",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Classes",
        short_name: "Classes",
        description: "Open your class list",
        url: "/m/assiddiq/portal/classes",
      },
      {
        name: "Inbox",
        short_name: "Inbox",
        description: "Open announcements and notifications",
        url: "/m/assiddiq/portal/announcements",
      },
    ],
  };
}
